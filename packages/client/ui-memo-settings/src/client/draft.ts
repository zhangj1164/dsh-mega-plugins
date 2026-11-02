/**
 * The shared settings draft model.
 *
 * One state machine serves every namespace this page edits: it stages what the
 * user types, compares it with the Host's accepted section, validates locally,
 * and commits field by field through `ctx.configForms`. The Host owns the
 * values and the write transport; the draft caches nothing as truth, and a
 * draft is dropped as soon as the Host agrees with it. A namespace supplies its
 * own field and group specs, so the page and the model stay the same shape.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/client/draft
 */

import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

/** The control a field renders. */
export type FieldKind = 'text' | 'number' | 'select' | 'multiline' | 'toggle'

/** One editable field, with the copy keys and bounds its control needs. */
export interface FieldSpec<F extends string = string, K extends string = string> {
  /** The namespace's `Config` field name. */
  readonly field: F
  /** Group the field renders into. */
  readonly group: string
  /** Control to render. */
  readonly kind: FieldKind
  /** Dictionary key of the field's label. */
  readonly label: K
  /** Dictionary key of the field's hint. */
  readonly hint: K
  /** Smallest accepted number, for `number` fields. */
  readonly min?: number
  /** Largest accepted number, for `number` fields. */
  readonly max?: number
  /** Accepted values, for `select` fields. */
  readonly options?: readonly string[]
}

/** One rendered group of fields. */
export interface GroupSpec<G extends string = string, K extends string = string> {
  /** The group id the field specs point at. */
  readonly group: G
  /** Dictionary key of the group's title. */
  readonly title: K
}

/** The reason a staged value cannot be saved. */
export type ValidationKey = 'invalidNumber' | 'invalidRange'

/** A field's staged text, keyed by field name; absent means "not staged". */
export type DraftMap<F extends string> = Partial<Record<F, string>>

/** The page's rendering state; a new object per change, never mutated in place. */
export interface SettingsView<F extends string, V> {
  /** Host mirror state: `loading` until the first accepted section arrives. */
  readonly status: ConfigFormSnapshot<V>['status']
  /** Whether the Host document accepts writes. */
  readonly writable: boolean
  /** Accepted values, undefined before the first acceptance. */
  readonly values: V | undefined
  /** Fields the user layer currently overrides. */
  readonly overridden: readonly F[]
  /** Staged text per edited field. */
  readonly drafts: Readonly<DraftMap<F>>
  /** Fields whose staged text differs from the accepted value. */
  readonly dirty: readonly F[]
  /** Fields whose staged text cannot be saved, with the reason key. */
  readonly invalid: Readonly<Partial<Record<F, ValidationKey>>>
  /** A save is crossing the wire. */
  readonly busy: boolean
  /** Outcome of the last save, cleared by the next edit. */
  readonly notice: 'saved' | 'saveFailed' | null
}

/**
 * The accepted text of one field, which is what a draft is compared against.
 * @param values - the accepted section, when one has arrived.
 * @param field - the field to read.
 * @returns the accepted value as text; empty when the field is unset.
 */
export function acceptedText<V>(values: V | undefined, field: string): string {
  const value = (values as Record<string, unknown> | undefined)?.[field]
  return value === undefined ? '' : String(value)
}

/**
 * Validate one staged value without touching the Host.
 * @param spec - the field's spec.
 * @param text - the staged text.
 * @returns the reason key, or undefined when the value may be saved.
 */
export function validateDraft(spec: FieldSpec<string, string>, text: string): ValidationKey | undefined {
  const trimmed = text.trim()
  if (spec.kind === 'number' && trimmed !== '') {
    if (!/^-?\d+$/u.test(trimmed)) return 'invalidNumber'
    const value = Number(trimmed)
    if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) {
      return 'invalidRange'
    }
  }
  if (spec.kind === 'select' && trimmed !== '' && spec.options !== undefined && !spec.options.includes(trimmed)) {
    return 'invalidRange'
  }
  return undefined
}

/**
 * The staged form over one settings namespace.
 *
 * `getSnapshot`/`subscribe` are the surface the slot system turns into the
 * page's hook, so this class is both the model and its own store. A subclass
 * binds one namespace's field specs and value shape.
 */
export class SettingsDraft<F extends string, V extends object> {
  private readonly form: ConfigForm<V>
  private readonly fields: readonly FieldSpec<F, string>[]
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private drafts: DraftMap<F> = {}
  private busy = false
  private notice: SettingsView<F, V>['notice'] = null
  private view: SettingsView<F, V>

  /**
   * @param form - the Host configuration form for one namespace.
   * @param fields - every field the page edits, in render order.
   */
  constructor(form: ConfigForm<V>, fields: readonly FieldSpec<F, string>[]) {
    this.form = form
    this.fields = fields
    this.view = this.project()
    this.unsubscribe = form.subscribe(() => { this.onHostChange() })
  }

  /** @returns the current page state, stable until the next change. */
  getSnapshot(): SettingsView<F, V> {
    return this.view
  }

  /**
   * Observe state replacements.
   * @param listener - invoked after each replacement.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Stage one field's text.
   * @param field - the field being edited.
   * @param text - the text the user typed.
   */
  edit(field: F, text: string): void {
    this.drafts = { ...this.drafts, [field]: text }
    this.notice = null
    this.publish()
  }

  /**
   * Stage one field's reset to the deployment default.
   *
   * Staged rather than written so the page has one commit path: the empty
   * draft is what the save step turns into `form.unset(field)`.
   * @param field - the field to reset.
   */
  resetField(field: F): void {
    this.drafts = { ...this.drafts, [field]: '' }
    this.notice = null
    this.publish()
  }

  /** Drop every staged value. */
  discard(): void {
    this.drafts = {}
    this.notice = null
    this.publish()
  }

  /**
   * Write every staged field to the Host.
   *
   * Fields are committed one at a time in render order: each `set`/`unset`
   * carries the latest revision, so a refusal stops the run and leaves the
   * remaining drafts staged for the user to correct.
   * @returns settlement after the writes finish.
   */
  async save(): Promise<void> {
    const view = this.view
    if (view.status !== 'ready' || !view.writable || this.busy) return
    if (view.dirty.length === 0 || Object.keys(view.invalid).length > 0) return

    const writes: { readonly spec: FieldSpec<F, string>; readonly value?: string | number | boolean }[] = []
    for (const spec of this.fields) {
      if (!view.dirty.includes(spec.field)) continue
      const text = (this.drafts[spec.field] ?? '').trim()
      if (text === '') {
        writes.push({ spec })
        continue
      }
      const value = spec.kind === 'number'
        ? Number(text)
        : spec.kind === 'toggle' ? text === 'true' : text
      writes.push({ spec, value })
    }

    this.busy = true
    this.notice = null
    this.publish()
    let accepted = true
    try {
      for (const write of writes) {
        const staged = this.drafts[write.spec.field]
        accepted = write.value === undefined
          ? await this.form.unset(write.spec.field)
          : await this.form.set(write.spec.field, write.value)
        // A field edited while the queue ran keeps its newer draft.
        if (accepted && staged !== undefined && this.drafts[write.spec.field] === staged) {
          const { [write.spec.field]: _committed, ...rest } = this.drafts
          this.drafts = rest
        }
        if (!accepted) break
      }
    } catch {
      accepted = false
    }
    this.busy = false
    this.notice = accepted ? 'saved' : 'saveFailed'
    this.publish()
  }

  /** Release the Host subscription; the owning effect calls this on teardown. */
  dispose(): void {
    this.unsubscribe()
    this.listeners.clear()
  }

  /** A Host change replaces the accepted values; drop drafts it has caught up with. */
  private onHostChange(): void {
    const values = this.form.getSnapshot().value
    for (const spec of this.fields) {
      const staged = this.drafts[spec.field]
      if (staged !== undefined && staged === acceptedText(values, spec.field)) {
        const { [spec.field]: _caughtUp, ...rest } = this.drafts
        this.drafts = rest
      }
    }
    this.publish()
  }

  /** Rebuild and publish the view. */
  private publish(): void {
    this.view = this.project()
    for (const listener of [...this.listeners]) listener()
  }

  /** @returns the view derived from the Host snapshot and the staged drafts. */
  private project(): SettingsView<F, V> {
    const snapshot = this.form.getSnapshot()
    const values = snapshot.value
    const user = snapshot.user as Record<string, unknown> | undefined
    const overridden: F[] = []
    const drafts: DraftMap<F> = {}
    const invalid: Partial<Record<F, ValidationKey>> = {}
    const dirty: F[] = []
    for (const spec of this.fields) {
      if (user !== undefined && Object.prototype.hasOwnProperty.call(user, spec.field)) {
        overridden.push(spec.field)
      }
      const staged = this.drafts[spec.field]
      if (staged === undefined) continue
      drafts[spec.field] = staged
      if (staged !== acceptedText(values, spec.field)) dirty.push(spec.field)
      const reason = validateDraft(spec, staged)
      if (reason !== undefined) invalid[spec.field] = reason
    }
    return {
      status: snapshot.status,
      writable: snapshot.writable,
      values,
      overridden,
      drafts,
      dirty,
      invalid,
      busy: this.busy,
      notice: this.notice,
    }
  }
}
