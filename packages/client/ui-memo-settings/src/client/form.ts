/**
 * The memo settings form model.
 *
 * The Host owns both the values and the write transport: this page stages what
 * the user types, then commits field by field through `ctx.configForms`, which
 * fences every write with the namespace revision the snapshot carried. Nothing
 * here caches a Host value as truth — the accepted snapshot stays the single
 * source, and a draft is dropped as soon as the Host agrees with it.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/client/form
 */

import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MemoKey } from './locales.ts'

/**
 * The memo `Config` fields this page edits.
 *
 * Deliberately a subset of the host's fields: the deployment-level knobs
 * (`storageWriteRetries`, `storageWriteRetryDelayMs`, `logAnalysisPlugins`) and
 * the cap that bounds another surface's length control
 * (`sessionSummaryMaxCharsLimit`) stay in `cordis.yml`.
 */
export type MemoSettingField =
  | 'provider'
  | 'model'
  | 'sessionSummaryLanguage'
  | 'sessionSummaryMaxSessions'
  | 'sessionSummaryTranscriptMaxChars'
  | 'sessionSummaryMaxChars'
  | 'sessionSummarySourceTemplate'
  | 'sessionSummaryPrompt'
  | 'repoUrl'

/** The shape of the memo namespace section this page reads and writes. */
export interface MemoSettingsValues {
  readonly provider?: string
  readonly model?: string
  readonly sessionSummaryLanguage?: 'auto' | 'zh' | 'en'
  readonly sessionSummaryMaxSessions?: number
  readonly sessionSummaryTranscriptMaxChars?: number
  readonly sessionSummaryMaxChars?: number
  readonly sessionSummarySourceTemplate?: string
  readonly sessionSummaryPrompt?: string
  readonly repoUrl?: string
}

/** The page's groups, in render order. */
export type MemoSettingGroup = 'ai' | 'summary' | 'prose' | 'repo'

/** The control a field renders. */
export type MemoSettingKind = 'text' | 'number' | 'select' | 'multiline'

/** One editable field, with the copy keys and bounds its control needs. */
export interface FieldSpec {
  /** The memo `Config` field name. */
  readonly field: MemoSettingField
  /** Group the field renders into. */
  readonly group: MemoSettingGroup
  /** Control to render. */
  readonly kind: MemoSettingKind
  /** Dictionary key of the field's label. */
  readonly label: MemoKey
  /** Dictionary key of the field's hint. */
  readonly hint: MemoKey
  /** Smallest accepted number, for `number` fields. */
  readonly min?: number
  /** Largest accepted number, for `number` fields. */
  readonly max?: number
  /** Accepted values, for `select` fields. */
  readonly options?: readonly string[]
}

/** One rendered group of fields. */
export interface GroupSpec {
  /** The group id the field specs point at. */
  readonly group: MemoSettingGroup
  /** Dictionary key of the group's title. */
  readonly title: MemoKey
}

/**
 * The memo schema's own bounds, mirrored for the browser.
 *
 * The Host validates every write and refuses an out-of-range value, so these
 * bounds exist to stop a round trip, not to decide truth. They are the only
 * place this package restates a host rule; `memo`'s `Config` schema is the one
 * source of them.
 */
const SESSION_SUMMARY_MAX_SESSIONS = { min: 1, max: 20 } as const
const SESSION_SUMMARY_TRANSCRIPT_MAX_CHARS = { min: 1_000, max: 200_000 } as const
const SESSION_SUMMARY_MAX_CHARS = { min: 100, max: 4_000 } as const

/** The languages the memo host accepts for a generated summary. */
export const SUMMARY_LANGUAGES: readonly string[] = Object.freeze(['auto', 'zh', 'en'])

/** Every group the page renders, in order. */
export const MEMO_SETTINGS_GROUPS: readonly GroupSpec[] = Object.freeze([
  { group: 'ai', title: 'groupAi' },
  { group: 'summary', title: 'groupSummary' },
  { group: 'prose', title: 'groupProse' },
  { group: 'repo', title: 'groupRepo' },
])

/** Every field the page edits, in render order. */
export const MEMO_SETTINGS_FIELDS: readonly FieldSpec[] = Object.freeze([
  { field: 'provider', group: 'ai', kind: 'text', label: 'providerLabel', hint: 'providerHint' },
  { field: 'model', group: 'ai', kind: 'text', label: 'modelLabel', hint: 'modelHint' },
  {
    field: 'sessionSummaryLanguage',
    group: 'summary',
    kind: 'select',
    label: 'languageLabel',
    hint: 'languageHint',
    options: SUMMARY_LANGUAGES,
  },
  {
    field: 'sessionSummaryMaxSessions',
    group: 'summary',
    kind: 'number',
    label: 'maxSessionsLabel',
    hint: 'maxSessionsHint',
    ...SESSION_SUMMARY_MAX_SESSIONS,
  },
  {
    field: 'sessionSummaryTranscriptMaxChars',
    group: 'summary',
    kind: 'number',
    label: 'transcriptCharsLabel',
    hint: 'transcriptCharsHint',
    ...SESSION_SUMMARY_TRANSCRIPT_MAX_CHARS,
  },
  {
    field: 'sessionSummaryMaxChars',
    group: 'summary',
    kind: 'number',
    label: 'maxCharsLabel',
    hint: 'maxCharsHint',
    ...SESSION_SUMMARY_MAX_CHARS,
  },
  { field: 'sessionSummarySourceTemplate', group: 'prose', kind: 'multiline', label: 'sourceTemplateLabel', hint: 'sourceTemplateHint' },
  { field: 'sessionSummaryPrompt', group: 'prose', kind: 'multiline', label: 'promptLabel', hint: 'promptHint' },
  { field: 'repoUrl', group: 'repo', kind: 'text', label: 'repoLabel', hint: 'repoHint' },
])

/** A field's staged text, keyed by field name; absent means "not staged". */
type DraftMap = Partial<Record<MemoSettingField, string>>

/** The page's rendering state; a new object per change, never mutated in place. */
export interface MemoSettingsView {
  /** Host mirror state: `loading` until the first accepted section arrives. */
  readonly status: ConfigFormSnapshot<MemoSettingsValues>['status']
  /** Whether the Host document accepts writes. */
  readonly writable: boolean
  /** Accepted values, undefined before the first acceptance. */
  readonly values: MemoSettingsValues | undefined
  /** Fields the user layer currently overrides. */
  readonly overridden: readonly MemoSettingField[]
  /** Staged text per edited field. */
  readonly drafts: Readonly<DraftMap>
  /** Fields whose staged text differs from the accepted value. */
  readonly dirty: readonly MemoSettingField[]
  /** Fields whose staged text cannot be saved, with the reason key. */
  readonly invalid: Readonly<Partial<Record<MemoSettingField, MemoKey>>>
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
function acceptedText(values: MemoSettingsValues | undefined, field: MemoSettingField): string {
  const value = values?.[field]
  return value === undefined ? '' : String(value)
}

/**
 * Validate one staged value without touching the Host.
 * @param spec - the field's spec.
 * @param text - the staged text.
 * @returns the reason key, or undefined when the value may be saved.
 */
function validateDraft(spec: FieldSpec, text: string): MemoKey | undefined {
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
 * The staged form over the `memo` settings namespace.
 *
 * `getSnapshot`/`subscribe` are the surface the slot system turns into the
 * page's `useMemoSettings` hook, so this class is both the model and its own
 * store.
 */
export class MemoSettingsDraft {
  private readonly form: ConfigForm<MemoSettingsValues>
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private drafts: DraftMap = {}
  private busy = false
  private notice: MemoSettingsView['notice'] = null
  private view: MemoSettingsView

  /**
   * @param form - the Host configuration form for the `memo` entry.
   */
  constructor(form: ConfigForm<MemoSettingsValues>) {
    this.form = form
    this.view = this.project()
    this.unsubscribe = form.subscribe(() => { this.onHostChange() })
  }

  /** @returns the current page state, stable until the next change. */
  getSnapshot(): MemoSettingsView {
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
  edit(field: MemoSettingField, text: string): void {
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
  resetField(field: MemoSettingField): void {
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

    const writes: { readonly spec: FieldSpec; readonly value?: string | number }[] = []
    for (const spec of MEMO_SETTINGS_FIELDS) {
      if (!view.dirty.includes(spec.field)) continue
      const text = (this.drafts[spec.field] ?? '').trim()
      if (text === '') {
        writes.push({ spec })
        continue
      }
      writes.push({ spec, value: spec.kind === 'number' ? Number(text) : text })
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
    for (const spec of MEMO_SETTINGS_FIELDS) {
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
  private project(): MemoSettingsView {
    const snapshot = this.form.getSnapshot()
    const values = snapshot.value
    const user = snapshot.user as Record<string, unknown> | undefined
    const overridden: MemoSettingField[] = []
    const drafts: DraftMap = {}
    const invalid: Partial<Record<MemoSettingField, MemoKey>> = {}
    const dirty: MemoSettingField[] = []
    for (const spec of MEMO_SETTINGS_FIELDS) {
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
