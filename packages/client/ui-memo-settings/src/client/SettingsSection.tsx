/**
 * The shared settings page.
 *
 * One section per group, one row per field. The page owns no value: it renders
 * the accepted Host snapshot plus the staged draft, and every write goes back
 * through `save` on the model. That split is what makes "Overridden" and
 * "Reset to default" honest — both are read from the Host document's own user
 * layer, not inferred from a value comparison.
 *
 * A namespace wrapper resolves its dictionary into {@link SettingsCopy} and
 * supplies its field specs, so the memo page and the GitHub-intake page render
 * through the same component.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/client/SettingsSection
 */

import * as React from 'react'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { FieldSpec, GroupSpec, SettingsView, ValidationKey } from './draft.ts'

/** Every page-level string, already resolved from the owning dictionary. */
export interface SettingsCopy<K extends string> {
  /** Page heading. */
  readonly title: string
  /** Page description. */
  readonly description: string
  /** Shown when the Host does not serve this namespace. */
  readonly unavailable: string
  /** Save action. */
  readonly save: string
  /** Save action while a write is in flight. */
  readonly saving: string
  /** Save succeeded. */
  readonly saved: string
  /** Save was refused. */
  readonly saveFailed: string
  /** Discard action. */
  readonly discard: string
  /** Reset-to-default action. */
  readonly reset: string
  /** Overridden badge. */
  readonly overridden: string
  /** Shown while the first snapshot is loading. */
  readonly loading: string
  /** Shown when the Host document is read-only. */
  readonly readOnly: string
  /** Field label copy. */
  readonly label: (key: K) => string
  /** Field hint copy. */
  readonly hint: (key: K) => string
  /** Group title copy. */
  readonly group: (key: K) => string
  /** Validation message copy. */
  readonly invalid: (key: ValidationKey) => string
}

/** Props the settings shell hands a section: owner copy plus the injected face. */
export interface SettingsSectionProps<F extends string, K extends string, V> extends SettingsSectionOwnerProps {
  /** Every page-level string and accessor for this namespace. */
  readonly copy: SettingsCopy<K>
  /** Every field the page edits, in render order. */
  readonly fields: readonly FieldSpec<F, K>[]
  /** Every group the page renders, in order. */
  readonly groups: readonly GroupSpec<string, K>[]
  /** Resolved labels for `select` options, when their copy differs from the field label. */
  readonly selectLabels?: Readonly<Record<string, string>>
  /** The shell's hook over the injected model store. */
  readonly useView: <T>(selector: (view: SettingsView<F, V>) => T) => T
  /** Stage one field's text. */
  readonly edit: (field: F, text: string) => void
  /** Stage one field's reset to the deployment default. */
  readonly resetField: (field: F) => void
  /** Commit every staged field. */
  readonly save: () => void
  /** Drop every staged field. */
  readonly discard: () => void
  /** Extra page content rendered inside the page container, after the form. */
  readonly children?: React.ReactNode
}

/** The DOM id a field's label points at. */
function controlId(field: string): string {
  return `dsh-memo-setting-${field}`
}

/**
 * Render one field's control.
 * @param props - the section props.
 * @param spec - the field being rendered.
 * @param view - the current page state.
 * @returns the control element.
 */
function control<F extends string, K extends string, V>(
  props: SettingsSectionProps<F, K, V>,
  spec: FieldSpec<F, K>,
  view: SettingsView<F, V>,
): React.ReactElement {
  const id = controlId(spec.field)
  // `drafts` holds only staged fields, so an absent entry means "show the accepted value".
  const value = view.drafts[spec.field] ?? String((view.values as Record<string, unknown> | undefined)?.[spec.field] ?? '')
  const disabled = !view.writable || view.busy
  const invalid = view.invalid[spec.field] !== undefined
  const hintId = `${id}-hint`

  if (spec.kind === 'toggle') {
    return (
      <input
        id={id}
        type="checkbox"
        className="dsh-memo-settings-toggle"
        checked={value === 'true'}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={hintId}
        onChange={(event) => { props.edit(spec.field, event.target.checked ? 'true' : 'false') }}
      />
    )
  }

  const shared = {
    id,
    value,
    disabled,
    'aria-invalid': invalid || undefined,
    'aria-describedby': hintId,
    className: 'dsh-memo-settings-input',
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      props.edit(spec.field, event.target.value)
    },
  }

  if (spec.kind === 'select') {
    return (
      <select {...shared} className="dsh-memo-settings-select">
        {(spec.options ?? []).map(option => (
          <option key={option} value={option}>{props.selectLabels?.[option] ?? props.copy.label(spec.label)}</option>
        ))}
      </select>
    )
  }
  if (spec.kind === 'multiline') {
    return <textarea {...shared} className="dsh-memo-settings-textarea" rows={4} />
  }
  if (spec.kind === 'number') {
    return (
      <input
        {...shared}
        type="number"
        inputMode="numeric"
        min={spec.min}
        max={spec.max}
        step={1}
      />
    )
  }
  return <input {...shared} type="text" />
}

/**
 * Render one field row: copy, control, override badge, reset action, error.
 * @param props - the section props.
 * @param spec - the field being rendered.
 * @param view - the current page state.
 * @returns the row element.
 */
function row<F extends string, K extends string, V>(
  props: SettingsSectionProps<F, K, V>,
  spec: FieldSpec<F, K>,
  view: SettingsView<F, V>,
): React.ReactElement {
  const id = controlId(spec.field)
  const invalid = view.invalid[spec.field]
  const overridden = view.overridden.includes(spec.field)
  return (
    <div className="dsh-memo-settings-row" key={spec.field}>
      <div className="dsh-memo-settings-copy">
        <div className="dsh-memo-settings-titleLine">
          <label className="dsh-memo-settings-label" htmlFor={id}>{props.copy.label(spec.label)}</label>
          {overridden && <span className="dsh-memo-settings-badge">{props.copy.overridden}</span>}
        </div>
        <p className="dsh-memo-settings-hint" id={`${id}-hint`}>{props.copy.hint(spec.hint)}</p>
        {invalid !== undefined && (
          <p className="dsh-memo-settings-error" role="alert">{props.copy.invalid(invalid)}</p>
        )}
      </div>
      <div className="dsh-memo-settings-control">
        {control(props, spec, view)}
        {overridden && (
          <button
            type="button"
            className="dsh-memo-settings-reset"
            disabled={!view.writable || view.busy}
            onClick={() => { props.resetField(spec.field) }}
          >
            {props.copy.reset}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Render one settings page.
 * @param props - the shell's owner props, copy, and the injected model.
 * @returns the page.
 */
export function SettingsSection<F extends string, K extends string, V>(
  props: SettingsSectionProps<F, K, V>,
): React.ReactElement {
  const view = props.useView(snapshot => snapshot)
  const busy = view.busy
  const writable = view.writable && view.status === 'ready'
  const dirty = view.dirty.length > 0
  const hasInvalid = Object.keys(view.invalid).length > 0

  return (
    <div className="dsh-memo-settings">
      <header className="dsh-memo-settings-header">
        <h2 className="dsh-memo-settings-heading">{props.copy.title}</h2>
        <p className="dsh-memo-settings-description">{props.copy.description}</p>
      </header>

      {view.status === 'loading' && <p className="dsh-memo-settings-muted">{props.copy.loading}</p>}
      {view.status === 'unavailable' && <p className="dsh-memo-settings-muted">{props.copy.unavailable}</p>}
      {view.status === 'ready' && !view.writable && (
        <p className="dsh-memo-settings-muted" role="status">{props.copy.readOnly}</p>
      )}

      {view.status === 'ready' && props.groups.map(group => (
        <section className="dsh-memo-settings-group" key={group.group}>
          <h3 className="dsh-memo-settings-groupTitle">{props.copy.group(group.title)}</h3>
          {props.fields
            .filter(spec => spec.group === group.group)
            .map(spec => row(props, spec, view))}
        </section>
      ))}

      {view.status === 'ready' && (
        <footer className="dsh-memo-settings-actions">
          <button
            type="button"
            className="dsh-memo-settings-save"
            disabled={!writable || busy || !dirty || hasInvalid}
            onClick={() => { props.save() }}
          >
            {busy ? props.copy.saving : props.copy.save}
          </button>
          <button
            type="button"
            className="dsh-memo-settings-discard"
            disabled={busy || !dirty}
            onClick={() => { props.discard() }}
          >
            {props.copy.discard}
          </button>
          {view.notice !== null && (
            <span
              className={view.notice === 'saved' ? 'dsh-memo-settings-notice' : 'dsh-memo-settings-error'}
              role="status"
            >
              {view.notice === 'saved' ? props.copy.saved : props.copy.saveFailed}
            </span>
          )}
        </footer>
      )}

      {props.children}
    </div>
  )
}
