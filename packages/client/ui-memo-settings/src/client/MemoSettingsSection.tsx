/**
 * The memo settings page.
 *
 * A thin wrapper over the shared {@link SettingsSection}: it resolves the memo
 * dictionary into page copy, supplies the memo field and group specs, and
 * forwards the shell's injected model hook.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/client/MemoSettingsSection
 */

import * as React from 'react'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  MEMO_SETTINGS_FIELDS,
  MEMO_SETTINGS_GROUPS,
  type MemoSettingField,
  type MemoSettingsView,
} from './form.ts'
import { SettingsSection, type SettingsCopy } from './SettingsSection.tsx'
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

/**
 * Render the memo settings page.
 * @param props - the shell's owner props, locale copy, and the injected model.
 * @returns the page.
 */
export function MemoSettingsSection(props: MemoSettingsSectionProps): React.ReactElement {
  const { t, useMemoSettings, ...injected } = props
  const copy: SettingsCopy<MemoKey> = {
    title: t('title'),
    description: t('description'),
    unavailable: t('unavailable'),
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
  const selectLabels = Object.fromEntries(
    Object.entries(LANGUAGE_LABELS).map(([option, key]) => [option, t(key)]),
  )
  return (
    <SettingsSection
      {...injected}
      copy={copy}
      fields={MEMO_SETTINGS_FIELDS}
      groups={MEMO_SETTINGS_GROUPS}
      selectLabels={selectLabels}
      useView={useMemoSettings}
    />
  )
}
