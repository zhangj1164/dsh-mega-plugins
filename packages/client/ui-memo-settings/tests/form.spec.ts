/**
 * The memo settings form model, exercised against a stand-in Host form.
 *
 * The model's whole job is to keep two things apart: what the user staged and
 * what the Host accepted. These tests pin the four ways that distinction can
 * leak — a save that writes more than was edited, a refusal that silently
 * discards a draft, a reset that never reaches `unset`, and a draft that
 * survives after the Host has caught up — plus the client-side bounds, which
 * only exist to save a refused round trip.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/tests/form
 */

import { describe, expect, it } from 'vitest'
import { MemoSettingsDraft, type MemoSettingsValues } from '../src/client/form.ts'
import { FakeForm } from './fake-form.ts'

/**
 * Build a draft over a fake form.
 * @param value - the accepted section.
 * @param user - the stored user layer.
 * @returns the form and its draft.
 */
function setup(value: MemoSettingsValues, user: unknown = {}): { form: FakeForm; draft: MemoSettingsDraft } {
  const form = new FakeForm(value, user)
  return { form, draft: new MemoSettingsDraft(form) }
}

describe('MemoSettingsDraft staging', () => {
  it('starts clean with no staged value', () => {
    const { draft } = setup({ repoUrl: 'https://example.test/repo' })
    const view = draft.getSnapshot()
    expect(view.status).toBe('ready')
    expect(view.drafts).toEqual({})
    expect(view.dirty).toEqual([])
    expect(view.notice).toBeNull()
  })

  it('stages an edit without writing, and saves only the edited field', async () => {
    const { form, draft } = setup({ repoUrl: 'https://example.test/repo', sessionSummaryMaxSessions: 5 })
    draft.edit('sessionSummaryMaxSessions', '9')
    expect(form.writes).toEqual([])
    expect(draft.getSnapshot().dirty).toEqual(['sessionSummaryMaxSessions'])

    await draft.save()
    expect(form.writes).toEqual([{ kind: 'set', field: 'sessionSummaryMaxSessions', value: 9 }])
    const view = draft.getSnapshot()
    expect(view.notice).toBe('saved')
    expect(view.dirty).toEqual([])
    expect(view.values?.sessionSummaryMaxSessions).toBe(9)
  })

  it('keeps a blank draft dirty, and saves it as an unset', async () => {
    const { form, draft } = setup({ provider: 'cu', model: 'glm' })
    draft.edit('provider', '')
    expect(draft.getSnapshot().dirty).toEqual(['provider'])
    await draft.save()
    expect(form.writes).toEqual([{ kind: 'unset', field: 'provider' }])
    expect(draft.getSnapshot().values?.provider).toBeUndefined()
  })

  it('treats a reset on an already-empty field as a no-op', async () => {
    const { form, draft } = setup({})
    draft.resetField('model')
    expect(draft.getSnapshot().dirty).toEqual([])
    await draft.save()
    expect(form.writes).toEqual([])
  })

  it('discards every staged value', () => {
    const { draft } = setup({ repoUrl: 'https://example.test/repo' })
    draft.edit('repoUrl', 'https://other.test/repo')
    draft.edit('sessionSummaryPrompt', 'custom')
    draft.discard()
    expect(draft.getSnapshot().drafts).toEqual({})
    expect(draft.getSnapshot().dirty).toEqual([])
  })

  it('reports the fields the user layer overrides', () => {
    const { draft } = setup(
      { repoUrl: 'https://example.test/repo', model: 'glm' },
      { model: 'glm' },
    )
    expect(draft.getSnapshot().overridden).toEqual(['model'])
  })
})

describe('MemoSettingsDraft validation', () => {
  it('rejects text that is not a whole number', () => {
    const { form, draft } = setup({})
    draft.edit('sessionSummaryMaxSessions', 'many')
    expect(draft.getSnapshot().invalid.sessionSummaryMaxSessions).toBe('invalidNumber')
    return draft.save().then(() => { expect(form.writes).toEqual([]) })
  })

  it('rejects a number outside the schema bound', () => {
    const { form, draft } = setup({})
    draft.edit('sessionSummaryMaxSessions', '21')
    expect(draft.getSnapshot().invalid.sessionSummaryMaxSessions).toBe('invalidRange')
    return draft.save().then(() => { expect(form.writes).toEqual([]) })
  })

  it('accepts the inclusive bounds', async () => {
    const { form, draft } = setup({})
    draft.edit('sessionSummaryMaxSessions', '1')
    draft.edit('sessionSummaryMaxChars', '4000')
    expect(draft.getSnapshot().invalid).toEqual({})
    await draft.save()
    expect(form.writes).toEqual([
      { kind: 'set', field: 'sessionSummaryMaxSessions', value: 1 },
      { kind: 'set', field: 'sessionSummaryMaxChars', value: 4000 },
    ])
  })

  it('writes fields in render order, stopping at the first refusal', async () => {
    const { form, draft } = setup({})
    draft.edit('provider', 'cu')
    draft.edit('sessionSummaryMaxSessions', '3')
    form.accept = false
    await draft.save()
    expect(form.writes).toEqual([{ kind: 'set', field: 'provider', value: 'cu' }])
    const view = draft.getSnapshot()
    expect(view.notice).toBe('saveFailed')
    // The draft survives so the value is not silently lost.
    expect(view.drafts.provider).toBe('cu')
    expect(view.dirty).toEqual(['provider', 'sessionSummaryMaxSessions'])
  })

  it('does not write while the deployment is read-only', async () => {
    const { form, draft } = setup({})
    form.setWritable(false)
    draft.edit('repoUrl', 'https://other.test/repo')
    await draft.save()
    expect(form.writes).toEqual([])
  })

  it('treats an unavailable namespace as unsavable', async () => {
    const { form, draft } = setup({})
    form.setStatus('unavailable')
    draft.edit('repoUrl', 'https://other.test/repo')
    await draft.save()
    expect(form.writes).toEqual([])
  })
})

describe('MemoSettingsDraft reconciliation', () => {
  it('drops a draft once the Host accepts the same value', () => {
    const { form, draft } = setup({})
    draft.edit('repoUrl', 'https://other.test/repo')
    form.replace({ repoUrl: 'https://other.test/repo' }, { repoUrl: 'https://other.test/repo' })
    expect(draft.getSnapshot().drafts).toEqual({})
    expect(draft.getSnapshot().dirty).toEqual([])
  })

  it('keeps a newer draft when an older write settles', () => {
    const { form, draft } = setup({})
    draft.edit('repoUrl', 'https://first.test/repo')
    form.replace({ repoUrl: 'https://first.test/repo' }, { repoUrl: 'https://first.test/repo' })
    draft.edit('repoUrl', 'https://second.test/repo')
    expect(draft.getSnapshot().drafts.repoUrl).toBe('https://second.test/repo')
    expect(draft.getSnapshot().dirty).toEqual(['repoUrl'])
  })

  it('notifies subscribers on every change and stops after dispose', () => {
    const { draft } = setup({})
    let calls = 0
    const off = draft.subscribe(() => { calls++ })
    draft.edit('repoUrl', 'x')
    draft.edit('repoUrl', 'y')
    expect(calls).toBe(2)
    off()
    draft.edit('repoUrl', 'z')
    expect(calls).toBe(2)
    draft.dispose()
  })
})
