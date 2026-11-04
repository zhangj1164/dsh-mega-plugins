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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoSettingsDraft, type MemoSettingsView } from '../src/client/form.ts'
import { MemoSettingsSection } from '../src/client/MemoSettingsSection.tsx'
import type { MemoUpdateCheck, MemoUpdateInfo, MemoUpdateInstallResult } from '../src/client/UpdateDialog.tsx'
import { zh, type MemoKey } from '../src/client/locales.ts'
import { FakeForm } from './fake-form.ts'

afterEach(cleanup)

/** The update readers a test hands the page. */
interface UpdateStub {
  readonly readInfo: () => Promise<MemoUpdateInfo | { readonly error: string }>
  readonly checkUpdate: () => Promise<MemoUpdateCheck | { readonly error: string }>
  readonly applyUpdate?: (check: MemoUpdateCheck) => Promise<MemoUpdateInstallResult>
  readonly copyText: (text: string) => Promise<void>
}

/** The running facts every update test starts from. */
const INFO: MemoUpdateInfo = {
  currentVersion: '0.6.1',
  packageName: '@zhangj1164/dsh-memo',
  registryUrl: 'https://registry.npmjs.org/',
  profileName: 'web',
}

/** A registry check offering `0.7.0` on top of the running `0.6.1`. */
const CHECK: MemoUpdateCheck = {
  currentVersion: '0.6.1',
  latestVersion: '0.7.0',
  updateAvailable: true,
  packageName: '@zhangj1164/dsh-memo',
  registryUrl: 'https://registry.npmjs.org/',
  manualCommand: 'dsh plugin --profile web add --save-exact @zhangj1164/dsh-memo@0.7.0 --registry=https://registry.npmjs.org/',
  checkedAt: 1,
}

/**
 * Render the page over a draft, with the shell's hook emulated by
 * `useSyncExternalStore` 鈥?the same subscription contract the injected store
 * gets at runtime.
 * @param form - the Host form the page writes to.
 * @param update - the version/update readers, when the test exercises that card.
 * @returns the rendered page and its draft.
 */
function renderPage(form: FakeForm, update?: UpdateStub) {
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
      {...(update === undefined ? {} : { update })}
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

  it('keeps the update entry dormant until its button is pressed', async () => {
    const checkUpdate = vi.fn(async () => CHECK)
    renderPage(new FakeForm({}), { readInfo: async () => INFO, checkUpdate, copyText: async () => {} })

    // The page costs no registry request: the icon button only opens the dialog.
    expect(checkUpdate).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: zh.updateCheck }))
    await waitFor(() => { expect(screen.getByRole('dialog')).toBeTruthy() })
    expect(screen.getByText(zh.updateTitle)).toBeTruthy()
    expect(screen.getByText(zh.updateIntro)).toBeTruthy()
    await waitFor(() => { expect(checkUpdate).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(screen.getByText(`${zh.updateAvailable}: v0.7.0`)).toBeTruthy() })
  })

  it('reports both versions, the target profile, and a copyable command', async () => {
    const copyText = vi.fn(async () => {})
    renderPage(new FakeForm({}), { readInfo: async () => INFO, checkUpdate: async () => CHECK, copyText })

    fireEvent.click(screen.getByRole('button', { name: zh.updateCheck }))
    await waitFor(() => { expect(screen.getByText('v0.7.0')).toBeTruthy() })
    expect(screen.getByText(zh.updateCurrent)).toBeTruthy()
    expect(screen.getByText('v0.6.1')).toBeTruthy()
    expect(screen.getByText(zh.updateLatest)).toBeTruthy()
    expect(screen.getByText(zh.updateProfile)).toBeTruthy()
    expect(screen.getByText('web')).toBeTruthy()
    expect(screen.getByText(zh.updateManual)).toBeTruthy()
    expect(screen.getByText(zh.updateManualHint)).toBeTruthy()
    expect(screen.getByText(CHECK.manualCommand)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: zh.updateCopy }))
    await waitFor(() => { expect(copyText).toHaveBeenCalledWith(CHECK.manualCommand) })
    await waitFor(() => { expect(screen.getByRole('button', { name: zh.updateCopied })).toBeTruthy() })
  })

  it('offers a recheck that asks the registry again', async () => {
    const checkUpdate = vi.fn(async () => CHECK)
    renderPage(new FakeForm({}), { readInfo: async () => INFO, checkUpdate, copyText: async () => {} })

    fireEvent.click(screen.getByRole('button', { name: zh.updateCheck }))
    await waitFor(() => { expect(checkUpdate).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(screen.getByRole('button', { name: zh.updateRecheck })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh.updateRecheck }))
    await waitFor(() => { expect(checkUpdate).toHaveBeenCalledTimes(2) })
  })

  it('installs the checked version through the plugin manager and says to restart', async () => {
    const applyUpdate = vi.fn(async () => ({ ok: true, version: '0.7.0' }))
    renderPage(new FakeForm({}), {
      readInfo: async () => INFO,
      checkUpdate: async () => CHECK,
      applyUpdate,
      copyText: async () => {},
    })

    fireEvent.click(screen.getByRole('button', { name: zh.updateCheck }))
    const apply = await screen.findByRole('button', { name: zh.updateApply }) as HTMLButtonElement
    expect(apply.disabled).toBe(false)
    fireEvent.click(apply)

    await waitFor(() => { expect(applyUpdate).toHaveBeenCalledWith(CHECK) })
    await waitFor(() => { expect(screen.getByText(`${zh.updateApplied}: v0.7.0 · ${zh.updateNeedsRestart}`)).toBeTruthy() })
  })

  it('disables the automatic update when the version is current', async () => {
    renderPage(new FakeForm({}), {
      readInfo: async () => INFO,
      checkUpdate: async () => ({ ...CHECK, latestVersion: '0.6.1', updateAvailable: false }),
      applyUpdate: async () => ({ ok: true }),
      copyText: async () => {},
    })

    fireEvent.click(screen.getByRole('button', { name: zh.updateCheck }))
    await waitFor(() => { expect(screen.getByText(zh.updateUpToDate)).toBeTruthy() })
    const apply = screen.getByRole('button', { name: zh.updateApply }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
  })

  it('reports a failed install and keeps the manual command reachable', async () => {
    renderPage(new FakeForm({}), {
      readInfo: async () => INFO,
      checkUpdate: async () => CHECK,
      applyUpdate: async () => ({ ok: false, reason: 'pnpm exited with code 1' }),
      copyText: async () => {},
    })

    fireEvent.click(screen.getByRole('button', { name: zh.updateCheck }))
    fireEvent.click(await screen.findByRole('button', { name: zh.updateApply }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('pnpm exited with code 1')
    })
    expect(screen.getByText(CHECK.manualCommand)).toBeTruthy()
  })

  it('reports a cancelled install with the failure label alone', async () => {
    renderPage(new FakeForm({}), {
      readInfo: async () => INFO,
      checkUpdate: async () => CHECK,
      // A cancelled install changed nothing, so the manager has no reason to add.
      applyUpdate: async () => ({ ok: false }),
      copyText: async () => {},
    })

    fireEvent.click(screen.getByRole('button', { name: zh.updateCheck }))
    fireEvent.click(await screen.findByRole('button', { name: zh.updateApply }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(zh.updateInstallFailed)
    })
  })

  it('shows the registry failure without losing the running version', async () => {
    renderPage(new FakeForm({}), {
      readInfo: async () => INFO,
      checkUpdate: async () => ({ error: 'registry responded with HTTP 503' }),
      copyText: async () => {},
    })

    fireEvent.click(screen.getByRole('button', { name: zh.updateCheck }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain('503') })
    expect(screen.getByText('v0.6.1')).toBeTruthy()
  })

  it('puts the save pair at the right edge, save last', () => {
    renderPage(new FakeForm({}), { readInfo: async () => INFO, checkUpdate: async () => CHECK, copyText: async () => {} })

    const update = screen.getByRole('button', { name: zh.updateCheck })
    const discard = screen.getByRole('button', { name: zh.discard })
    const save = screen.getByRole('button', { name: zh.save })
    const footer = save.closest('.dsh-memo-settings-actions') as HTMLElement
    const group = save.closest('.dsh-memo-settings-actionGroup') as HTMLElement

    expect(footer).toBeTruthy()
    // The update entry leads the row; the commit pair trails it in its own group.
    expect(update.closest('.dsh-memo-settings-actionGroup')).toBeNull()
    expect(group.contains(discard)).toBe(true)
    // Save is the last control of the page, so the right edge is the commit.
    expect(discard.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(save.compareDocumentPosition(update) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })
})
