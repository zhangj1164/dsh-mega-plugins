/**
 * The memo settings page.
 *
 * One section per group, one row per field. The page owns no value: it renders
 * the accepted Host snapshot plus the staged draft, and every write goes back
 * through `save` on the model. That split is what makes "Overridden" and
 * "Reset to default" honest — both are read from the Host document's own user
 * layer, not inferred from a value comparison.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/client/MemoSettingsSection
 */

import * as React from 'react'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  MEMO_SETTINGS_FIELDS,
  MEMO_SETTINGS_GROUPS,
  type FieldSpec,
  type MemoSettingField,
  type MemoSettingsView,
} from './form.ts'
import type { MemoKey } from './locales.ts'

/** Dictionary keys for the three summary languages, in the picker's order. */
const LANGUAGE_LABELS: Readonly<Record<string, MemoKey>> = Object.freeze({
  auto: 'languageAuto',
  zh: 'languageZh',
  en: 'languageEn',
})

/** Props the settings shell hands this section: owner copy plus the injected face. */
export interface MemoSettingsSectionProps extends SettingsSectionOwnerProps {
  /** Locale reader bound to this page's dictionary. */
  readonly t: (key: MemoKey) => string
  /** The shell's hook over the injected model store. */
  readonly useMemoSettings: <T>(selector: (view: MemoSettingsView) => T) => T
  /** Stage one field's text. */
  readonly edit: (field: MemoSettingField, text: string) => void
  /** Stage one field's reset to the deployment default. */
  readonly resetField: (field: MemoSettingField) => void
  /** Commit every staged field. */
  readonly save: () => void
  /** Drop every staged field. */
  readonly discard: () => void
}

/** The DOM id a field's label points at. */
function controlId(field: MemoSettingField): string {
  return `dsh-memo-setting-${field}`
}

/**
 * Render one field's control.
 * @param props - the section props.
 * @param spec - the field being rendered.
 * @param view - the current page state.
 * @returns the control element.
 */
function control(
  props: MemoSettingsSectionProps,
  spec: FieldSpec,
  view: MemoSettingsView,
): React.ReactElement {
  const id = controlId(spec.field)
  // `drafts` holds only staged fields, so an absent entry means "show the accepted value".
  const value = view.drafts[spec.field] ?? String(view.values?.[spec.field] ?? '')
  const disabled = !view.writable || view.busy
  const invalid = view.invalid[spec.field] !== undefined
  const shared = {
    id,
    value,
    disabled,
    'aria-invalid': invalid || undefined,
    'aria-describedby': `${id}-hint`,
    className: 'dsh-memo-settings-input',
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      props.edit(spec.field, event.target.value)
    },
  }

  if (spec.kind === 'select') {
    return (
      <select {...shared} className="dsh-memo-settings-select">
        {(spec.options ?? []).map(option => (
          <option key={option} value={option}>{props.t(LANGUAGE_LABELS[option] ?? spec.label)}</option>
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
function row(
  props: MemoSettingsSectionProps,
  spec: FieldSpec,
  view: MemoSettingsView,
): React.ReactElement {
  const id = controlId(spec.field)
  const invalid = view.invalid[spec.field]
  const overridden = view.overridden.includes(spec.field)
  return (
    <div className="dsh-memo-settings-row" key={spec.field}>
      <div className="dsh-memo-settings-copy">
        <div className="dsh-memo-settings-titleLine">
          <label className="dsh-memo-settings-label" htmlFor={id}>{props.t(spec.label)}</label>
          {overridden && <span className="dsh-memo-settings-badge">{props.t('overridden')}</span>}
        </div>
        <p className="dsh-memo-settings-hint" id={`${id}-hint`}>{props.t(spec.hint)}</p>
        {invalid !== undefined && (
          <p className="dsh-memo-settings-error" role="alert">{props.t(invalid)}</p>
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
            {props.t('reset')}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Render the memo settings page.
 * @param props - the shell's owner props, locale copy, and the injected model.
 * @returns the page.
 */
export function MemoSettingsSection(props: MemoSettingsSectionProps): React.ReactElement {
  const view = props.useMemoSettings(snapshot => snapshot)
  const busy = view.busy
  const writable = view.writable && view.status === 'ready'
  const dirty = view.dirty.length > 0
  const hasInvalid = Object.keys(view.invalid).length > 0

  return (
    <div className="dsh-memo-settings">
      <header className="dsh-memo-settings-header">
        <h2 className="dsh-memo-settings-heading">{props.t('title')}</h2>
        <p className="dsh-memo-settings-description">{props.t('description')}</p>
      </header>

      {view.status === 'loading' && <p className="dsh-memo-settings-muted">{props.t('loading')}</p>}
      {view.status === 'unavailable' && <p className="dsh-memo-settings-muted">{props.t('unavailable')}</p>}
      {view.status === 'ready' && !view.writable && (
        <p className="dsh-memo-settings-muted" role="status">{props.t('readOnly')}</p>
      )}

      {view.status === 'ready' && MEMO_SETTINGS_GROUPS.map(group => (
        <section className="dsh-memo-settings-group" key={group.group}>
          <h3 className="dsh-memo-settings-groupTitle">{props.t(group.title)}</h3>
          {MEMO_SETTINGS_FIELDS
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
            {busy ? props.t('saving') : props.t('save')}
          </button>
          <button
            type="button"
            className="dsh-memo-settings-discard"
            disabled={busy || !dirty}
            onClick={() => { props.discard() }}
          >
            {props.t('discard')}
          </button>
          {view.notice !== null && (
            <span
              className={view.notice === 'saved' ? 'dsh-memo-settings-notice' : 'dsh-memo-settings-error'}
              role="status"
            >
              {props.t(view.notice)}
            </span>
          )}
        </footer>
      )}
    </div>
  )
}
