/**
 * The memo settings form model.
 *
 * The Host owns both the values and the write transport: this page stages what
 * the user types, then commits field by field through `ctx.configForms`, which
 * fences every write with the namespace revision the snapshot carried. Nothing
 * here caches a Host value as truth — the accepted snapshot stays the single
 * source, and a draft is dropped as soon as the Host agrees with it.
 *
 * The state machine is shared with every other namespace this plugin edits; this
 * module only names the memo fields, their groups, and their bounds.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/client/form
 */

import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsDraft, type FieldKind, type FieldSpec, type GroupSpec, type SettingsView } from './draft.ts'
import type { MemoKey } from './locales.ts'

export type { FieldSpec, GroupSpec, SettingsView } from './draft.ts'

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

/** The control a memo field renders. */
export type MemoSettingKind = FieldKind

/** The memo page's rendering state. */
export type MemoSettingsView = SettingsView<MemoSettingField, MemoSettingsValues>

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
export const MEMO_SETTINGS_GROUPS: readonly GroupSpec<MemoSettingGroup, MemoKey>[] = Object.freeze([
  { group: 'ai', title: 'groupAi' },
  { group: 'summary', title: 'groupSummary' },
  { group: 'prose', title: 'groupProse' },
  { group: 'repo', title: 'groupRepo' },
])

/** Every field the page edits, in render order. */
export const MEMO_SETTINGS_FIELDS: readonly FieldSpec<MemoSettingField, MemoKey>[] = Object.freeze([
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

/**
 * The staged form over the `memo` settings namespace.
 *
 * `getSnapshot`/`subscribe` are the surface the slot system turns into the
 * page's `useMemoSettings` hook, so this class is both the model and its own
 * store.
 */
export class MemoSettingsDraft extends SettingsDraft<MemoSettingField, MemoSettingsValues> {
  /**
   * @param form - the Host configuration form for the `memo` entry.
   */
  constructor(form: ConfigForm<MemoSettingsValues>) {
    super(form, MEMO_SETTINGS_FIELDS)
  }
}
