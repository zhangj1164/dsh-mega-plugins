/**
 * The GitHub-intake settings page.
 *
 * A thin wrapper over the shared {@link SettingsSection}: it resolves the
 * intake dictionary into page copy, supplies the intake field and group specs,
 * and forwards the shell's injected model hook.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/client/IntakeSettingsSection
 */

import * as React from 'react'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  INTAKE_SETTINGS_FIELDS,
  INTAKE_SETTINGS_GROUPS,
  type IntakeSettingField,
  type IntakeSettingsView,
} from './intake-form.ts'
import { SettingsSection, type SettingsCopy } from './SettingsSection.tsx'
import type { IntakeKey } from './locales.ts'

/** Props the settings shell hands this section: owner copy plus the injected face. */
export interface IntakeSettingsSectionProps extends SettingsSectionOwnerProps {
  /** Locale reader bound to this page's dictionary. */
  readonly t: (key: IntakeKey) => string
  /** The shell's hook over the injected model store. */
  readonly useIntakeSettings: <T>(selector: (view: IntakeSettingsView) => T) => T
  /** Stage one field's text. */
  readonly edit: (field: IntakeSettingField, text: string) => void
  /** Stage one field's reset to the deployment default. */
  readonly resetField: (field: IntakeSettingField) => void
  /** Commit every staged field. */
  readonly save: () => void
  /** Drop every staged field. */
  readonly discard: () => void
}

/**
 * Render the GitHub-intake settings page.
 * @param props - the shell's owner props, locale copy, and the injected model.
 * @returns the page.
 */
export function IntakeSettingsSection(props: IntakeSettingsSectionProps): React.ReactElement {
  const { t, useIntakeSettings, ...injected } = props
  const copy: SettingsCopy<IntakeKey> = {
    title: t('intakeTitle'),
    description: t('intakeDescription'),
    unavailable: t('intakeUnavailable'),
    save: t('save'),
    saving: t('saving'),
    saved: t('saved'),
    saveFailed: t('saveFailed'),
    discard: t('discard'),
    reset: t('reset'),
    overridden: t('overridden'),
    loading: t('loading'),
    readOnly: t('readOnly'),
    label: key => t(key),
    hint: key => t(key),
    group: key => t(key),
    invalid: key => t(key),
  }
  return (
    <SettingsSection
      {...injected}
      copy={copy}
      fields={INTAKE_SETTINGS_FIELDS}
      groups={INTAKE_SETTINGS_GROUPS}
      useView={useIntakeSettings}
    />
  )
}
