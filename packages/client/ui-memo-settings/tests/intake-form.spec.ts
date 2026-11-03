/**
 * The GitHub-intake draft model.
 *
 * The page is only as honest as this model: it must stage without writing,
 * convert a number and a toggle into the types the Host schema declares, refuse
 * a blank field the service cannot run without, and turn a reset into an
 * `unset` rather than an empty string.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/tests/intake-form
 */

import { afterEach, describe, expect, it } from 'vitest'
import { IntakeSettingsDraft, type IntakeSettingsValues } from '../src/client/intake-form.ts'
import { FakeForm } from './fake-form.ts'

const drafts: IntakeSettingsDraft[] = []

afterEach(() => {
  for (const draft of drafts.splice(0)) draft.dispose()
})

/**
 * Build a draft over a seeded form.
 * @param values - the accepted section.
 * @param user - the user layer, which marks overrides.
 * @returns the form and its draft.
 */
function setup(values: IntakeSettingsValues = {}, user: unknown = {}): {
  readonly form: FakeForm<IntakeSettingsValues>
  readonly draft: IntakeSettingsDraft
} {
  const form = new FakeForm<IntakeSettingsValues>(values, user)
  const draft = new IntakeSettingsDraft(form)
  drafts.push(draft)
  return { form, draft }
}

describe('IntakeSettingsDraft', () => {
  it('stages an edit without writing to the Host', () => {
    const { form, draft } = setup()
    draft.edit('claimLabel', 'agent-take')
    expect(form.writes).toEqual([])
    expect(draft.getSnapshot().dirty).toEqual(['claimLabel'])
  })

  it('saves a number as a number and a toggle as a boolean', async () => {
    const { form, draft } = setup()
    draft.edit('maxIssuesPerRun', '5')
    draft.edit('autopilotEnabled', 'true')
    await draft.save()
    expect(form.writes).toEqual([
      { kind: 'set', field: 'maxIssuesPerRun', value: 5 },
      { kind: 'set', field: 'autopilotEnabled', value: true },
    ])
    expect(draft.getSnapshot().notice).toBe('saved')
  })

  it('treats a blank field as a reset to the deployment default', async () => {
    const { form, draft } = setup()
    draft.edit('repoUrl', '   ')
    expect(draft.getSnapshot().invalid.repoUrl).toBeUndefined()
    await draft.save()
    expect(form.writes).toEqual([{ kind: 'unset', field: 'repoUrl' }])
  })

  it('refuses a dispatch count outside the schema bounds', () => {
    const { draft } = setup()
    draft.edit('maxIssuesPerRun', '0')
    expect(draft.getSnapshot().invalid.maxIssuesPerRun).toBe('invalidRange')
    draft.edit('maxIssuesPerRun', '21')
    expect(draft.getSnapshot().invalid.maxIssuesPerRun).toBe('invalidRange')
    draft.edit('maxIssuesPerRun', '3')
    expect(draft.getSnapshot().invalid.maxIssuesPerRun).toBeUndefined()
  })

  it('turns a reset into an unset', async () => {
    const { form, draft } = setup(
      { claimLabel: 'agent-take' },
      { claimLabel: 'agent-take' },
    )
    expect(draft.getSnapshot().overridden).toEqual(['claimLabel'])
    draft.resetField('claimLabel')
    await draft.save()
    expect(form.writes).toEqual([{ kind: 'unset', field: 'claimLabel' }])
  })
})
