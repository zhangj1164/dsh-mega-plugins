// @vitest-environment jsdom
/**
 * The GitHub-intake settings page as the Settings shell renders it.
 *
 * These tests reach what a user can actually do: read the configured values,
 * flip the first-startup toggle, and see a blank required field refused before
 * it can be saved.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/tests/IntakeSettingsSection
 */

import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  IntakeSettingsDraft,
  type IntakeSettingsValues,
  type IntakeSettingsView,
} from '../src/client/intake-form.ts'
import { IntakeSettingsSection } from '../src/client/IntakeSettingsSection.tsx'
import { zh, type IntakeKey } from '../src/client/locales.ts'
import { FakeForm } from './fake-form.ts'

afterEach(cleanup)

/** The accepted section every render starts from. */
const VALUES: IntakeSettingsValues = {
  repoUrl: 'https://github.com/test/repo',
  claimLabel: 'ready-for-agent',
  maxIssuesPerRun: 3,
  autopilotEnabled: false,
  autopilotCwd: 'E:/repo',
  autopilotPreset: 'standard',
  autopilotTimeZone: 'Asia/Shanghai',
  autopilotPrompt: 'TASK {number}',
}

/**
 * Render the page over a draft, with the shell's hook emulated by
 * `useSyncExternalStore`.
 * @param form - the Host form the page writes to.
 * @returns the rendered page and its draft.
 */
function renderPage(form: FakeForm<IntakeSettingsValues> = new FakeForm<IntakeSettingsValues>(VALUES)) {
  const draft = new IntakeSettingsDraft(form)
  const t = (key: IntakeKey): string => zh[key]

  function useIntakeSettings<T>(selector: (view: IntakeSettingsView) => T): T {
    return React.useSyncExternalStore(
      React.useCallback((onChange: () => void) => draft.subscribe(onChange), [draft]),
      () => selector(draft.getSnapshot()),
    )
  }

  render(
    <IntakeSettingsSection
      t={t}
      useIntakeSettings={useIntakeSettings}
      edit={(field, text) => { draft.edit(field, text) }}
      resetField={field => { draft.resetField(field) }}
      save={() => { void draft.save() }}
      discard={() => { draft.discard() }}
      close={() => {}}
    />,
  )
  return { form, draft }
}

describe('IntakeSettingsSection', () => {
  it('renders the heading, every group, and the accepted values', () => {
    renderPage()
    expect(screen.getByText(zh.intakeTitle)).toBeTruthy()
    for (const key of ['intakeGroupIntake', 'intakeGroupAutopilot', 'intakeGroupPrompt'] as const) {
      expect(screen.getByText(zh[key])).toBeTruthy()
    }
    expect((screen.getByLabelText(zh.intakeRepoLabel) as HTMLInputElement).value).toBe('https://github.com/test/repo')
    expect((screen.getByLabelText(zh.claimLabelLabel) as HTMLInputElement).value).toBe('ready-for-agent')
    expect((screen.getByLabelText(zh.maxIssuesLabel) as HTMLInputElement).value).toBe('3')
    expect((screen.getByLabelText(zh.autopilotEnabledLabel) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText(zh.autopilotPromptLabel) as HTMLTextAreaElement).value).toBe('TASK {number}')
  })

  it('saves a flipped toggle as a boolean', async () => {
    const { form } = renderPage()
    const toggle = screen.getByLabelText(zh.autopilotEnabledLabel) as HTMLInputElement
    fireEvent.click(toggle)
    expect(toggle.checked).toBe(true)
    const save = screen.getByRole('button', { name: zh.save }) as HTMLButtonElement
    fireEvent.click(save)
    await screen.findByText(zh.saved)
    expect(form.writes).toEqual([{ kind: 'set', field: 'autopilotEnabled', value: true }])
  })

  it('treats a blank repository as a reset and stays saveable', async () => {
    const { form } = renderPage()
    const repo = screen.getByLabelText(zh.intakeRepoLabel) as HTMLInputElement
    fireEvent.change(repo, { target: { value: '   ' } })
    const save = screen.getByRole('button', { name: zh.save }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await screen.findByText(zh.saved)
    expect(form.writes).toEqual([{ kind: 'unset', field: 'repoUrl' }])
  })
})
