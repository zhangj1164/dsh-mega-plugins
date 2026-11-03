/**
 * The GitHub-intake settings form model.
 *
 * A second namespace on the same Settings page: the values belong to the
 * `github-issue` Host entry, and saving them writes the profile's user layer
 * while the running service reads the new values on its next call.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/client/intake-form
 */

import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsDraft, type FieldSpec, type GroupSpec, type SettingsView } from './draft.ts'
import type { IntakeKey } from './locales.ts'

/** The `github-issue` `Config` fields this page edits. */
export type IntakeSettingField =
  | 'repoUrl'
  | 'claimLabel'
  | 'maxIssuesPerRun'
  | 'autopilotEnabled'
  | 'autopilotCwd'
  | 'autopilotPreset'
  | 'autopilotTimeZone'
  | 'autopilotPrompt'

/** The shape of the `github-issue` namespace section this page reads and writes. */
export interface IntakeSettingsValues {
  readonly repoUrl?: string
  readonly claimLabel?: string
  readonly maxIssuesPerRun?: number
  readonly autopilotEnabled?: boolean
  readonly autopilotCwd?: string
  readonly autopilotPreset?: string
  readonly autopilotTimeZone?: string
  readonly autopilotPrompt?: string
}

/** The page's groups, in render order. */
export type IntakeSettingGroup = 'intake' | 'autopilot' | 'prompt'

/** The intake page's rendering state. */
export type IntakeSettingsView = SettingsView<IntakeSettingField, IntakeSettingsValues>

/**
 * The `github-issue` schema's dispatch bound, mirrored for the browser.
 *
 * The Host refuses an out-of-range write; this only stops a round trip.
 */
const MAX_ISSUES_PER_RUN = { min: 1, max: 20 } as const

/** Every group the page renders, in order. */
export const INTAKE_SETTINGS_GROUPS: readonly GroupSpec<IntakeSettingGroup, IntakeKey>[] = Object.freeze([
  { group: 'intake', title: 'intakeGroupIntake' },
  { group: 'autopilot', title: 'intakeGroupAutopilot' },
  { group: 'prompt', title: 'intakeGroupPrompt' },
])

/** Every field the page edits, in render order. */
export const INTAKE_SETTINGS_FIELDS: readonly FieldSpec<IntakeSettingField, IntakeKey>[] = Object.freeze([
  {
    field: 'repoUrl',
    group: 'intake',
    kind: 'text',
    label: 'intakeRepoLabel',
    hint: 'intakeRepoHint',
  },
  {
    field: 'claimLabel',
    group: 'intake',
    kind: 'text',
    label: 'claimLabelLabel',
    hint: 'claimLabelHint',
  },
  {
    field: 'maxIssuesPerRun',
    group: 'intake',
    kind: 'number',
    label: 'maxIssuesLabel',
    hint: 'maxIssuesHint',
    ...MAX_ISSUES_PER_RUN,
  },
  {
    field: 'autopilotEnabled',
    group: 'autopilot',
    kind: 'toggle',
    label: 'autopilotEnabledLabel',
    hint: 'autopilotEnabledHint',
  },
  { field: 'autopilotCwd', group: 'autopilot', kind: 'text', label: 'autopilotCwdLabel', hint: 'autopilotCwdHint' },
  { field: 'autopilotPreset', group: 'autopilot', kind: 'text', label: 'autopilotPresetLabel', hint: 'autopilotPresetHint' },
  { field: 'autopilotTimeZone', group: 'autopilot', kind: 'text', label: 'autopilotTimeZoneLabel', hint: 'autopilotTimeZoneHint' },
  {
    field: 'autopilotPrompt',
    group: 'prompt',
    kind: 'multiline',
    label: 'autopilotPromptLabel',
    hint: 'autopilotPromptHint',
  },
])

/**
 * The staged form over the `github-issue` settings namespace.
 *
 * `getSnapshot`/`subscribe` are the surface the slot system turns into the
 * page's `useIntakeSettings` hook.
 */
export class IntakeSettingsDraft extends SettingsDraft<IntakeSettingField, IntakeSettingsValues> {
  /**
   * @param form - the Host configuration form for the `github-issue` entry.
   */
  constructor(form: ConfigForm<IntakeSettingsValues>) {
    super(form, INTAKE_SETTINGS_FIELDS)
  }
}
