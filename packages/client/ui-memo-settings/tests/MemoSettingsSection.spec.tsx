// @vitest-environment jsdom
/**
 * The memo settings page as the Settings shell renders it.
 *
 * The page is pure presentation over the model, so these tests focus on what a
 * user can actually reach: every field is labelled and editable, a staged edit
 * survives until it is saved, an overridden field offers its reset, and a
 * read-only or unavailable deployment disables the controls instead of
 * pretending they write.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/tests/MemoSettingsSection
 */

import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoSettingsDraft, type MemoSettingsView } from '../src/client/form.ts'
import { MemoSettingsSection } from '../src/client/MemoSettingsSection.tsx'
import { zh, type MemoKey } from '../src/client/locales.ts'
import { FakeForm } from './fake-form.ts'

afterEach(cleanup)

/**
 * Render the page over a draft, with the shell's hook emulated by
 * `useSyncExternalStore` — the same subscription contract the injected store
 * gets at runtime.
 * @param form - the Host form the page writes to.
 * @returns the rendered page and its draft.
 */
function renderPage(form: FakeForm) {
  const draft = new MemoSettingsDraft(form)
  const t = (key: MemoKey): string => zh[key]

  function useMemoSettings<T>(selector: (view: MemoSettingsView) => T): T {
    return React.useSyncExternalStore(
      React.useCallback((onChange: () => void) => draft.subscribe(onChange), [draft]),
      () => selector(draft.getSnapshot()),
    )
  }

  const view = render(
    <MemoSettingsSection
      t={t}
      useMemoSettings={useMemoSettings}
      edit={(field, text) => { draft.edit(field, text) }}
      resetField={field => { draft.resetField(field) }}
      save={() => { void draft.save() }}
      discard={() => { draft.discard() }}
      close={() => {}}
    />,
  )
  return { view, draft }
}

/** @returns the provider text input. */
function providerInput(): HTMLInputElement {
  return screen.getByLabelText(zh.providerLabel) as HTMLInputElement
}

describe('MemoSettingsSection', () => {
  it('renders every group and field with the accepted value', () => {
    const form = new FakeForm({
      repoUrl: 'https://example.test/repo',
      sessionSummaryLanguage: 'en',
      sessionSummaryMaxSessions: 5,
    })
    renderPage(form)

    for (const key of ['groupAi', 'groupSummary', 'groupProse', 'groupRepo'] as const) {
      expect(screen.getByText(zh[key])).toBeTruthy()
    }
    expect(providerInput().value).toBe('')
    expect((screen.getByLabelText(zh.repoLabel) as HTMLInputElement).value).toBe('https://example.test/repo')
    expect((screen.getByLabelText(zh.languageLabel) as HTMLSelectElement).value).toBe('en')
    expect((screen.getByLabelText(zh.maxSessionsLabel) as HTMLInputElement).value).toBe('5')
  })

  it('keeps Save disabled until something is staged', () => {
    renderPage(new FakeForm({}))
    const save = screen.getByRole('button', { name: zh.save }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(providerInput(), { target: { value: 'cu' } })
    expect(providerInput().value).toBe('cu')
    expect(save.disabled).toBe(false)
  })

  it('writes the staged value and reports success', async () => {
    const form = new FakeForm({})
    renderPage(form)
    fireEvent.change(providerInput(), { target: { value: 'cu' } })
    fireEvent.click(screen.getByRole('button', { name: zh.save }))

    await waitFor(() => { expect(form.writes).toEqual([{ kind: 'set', field: 'provider', value: 'cu' }]) })
    await waitFor(() => { expect(screen.getByText(zh.saved)).toBeTruthy() })
    expect((screen.getByRole('button', { name: zh.save }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers a reset for an overridden field and saves it as an unset', async () => {
    const form = new FakeForm({ model: 'glm' }, { model: 'glm' })
    renderPage(form)

    expect(screen.getByText(zh.overridden)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.reset }))
    fireEvent.click(screen.getByRole('button', { name: zh.save }))

    await waitFor(() => { expect(form.writes).toEqual([{ kind: 'unset', field: 'model' }]) })
  })

  it('blocks the save and explains a malformed number', () => {
    const form = new FakeForm({})
    renderPage(form)
    fireEvent.change(screen.getByLabelText(zh.maxSessionsLabel), { target: { value: '0' } })

    expect(screen.getByRole('alert').textContent).toBe(zh.invalidRange)
    expect((screen.getByRole('button', { name: zh.save }) as HTMLButtonElement).disabled).toBe(true)
    expect(form.writes).toEqual([])
  })

  it('discards a draft back to the accepted value', () => {
    const form = new FakeForm({ repoUrl: 'https://example.test/repo' })
    renderPage(form)
    fireEvent.change(screen.getByLabelText(zh.repoLabel), { target: { value: 'https://other.test/repo' } })
    fireEvent.click(screen.getByRole('button', { name: zh.discard }))

    expect((screen.getByLabelText(zh.repoLabel) as HTMLInputElement).value).toBe('https://example.test/repo')
    expect((screen.getByRole('button', { name: zh.save }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables every control on a read-only deployment', () => {
    const form = new FakeForm({ repoUrl: 'https://example.test/repo' })
    form.setWritable(false)
    renderPage(form)

    expect(screen.getByText(zh.readOnly)).toBeTruthy()
    expect(providerInput().disabled).toBe(true)
    expect((screen.getByLabelText(zh.repoLabel) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: zh.save }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders the mirror state instead of an empty form', () => {
    const loading = new FakeForm({})
    loading.setStatus('loading')
    renderPage(loading)
    expect(screen.getByText(zh.loading)).toBeTruthy()
    expect(screen.queryByLabelText(zh.providerLabel)).toBeNull()
    cleanup()

    const unavailable = new FakeForm({})
    unavailable.setStatus('unavailable')
    renderPage(unavailable)
    expect(screen.getByText(zh.unavailable)).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh.save })).toBeNull()
  })

  it('says the save failed and keeps the draft when the Host refuses', async () => {
    const form = new FakeForm({})
    form.accept = false
    renderPage(form)
    fireEvent.change(providerInput(), { target: { value: 'cu' } })
    fireEvent.click(screen.getByRole('button', { name: zh.save }))

    await waitFor(() => { expect(screen.getByText(zh.saveFailed)).toBeTruthy() })
    expect(providerInput().value).toBe('cu')
  })

  it('keeps the summary placeholders visible in the hints', () => {
    renderPage(new FakeForm({}))
    expect(screen.getByText(zh.sourceTemplateHint)).toBeTruthy()
    expect(screen.getByText(zh.promptHint)).toBeTruthy()
    expect(zh.sourceTemplateHint).toContain('{sessionId}')
    expect(zh.promptHint).toContain('{maxChars}')
  })
})
