// @vitest-environment jsdom
/**
 * The browser half's wiring, exercised through the entry point the shell calls.
 *
 * What matters here is not the pages — their own suites cover those — but the
 * decisions the entry point makes: which services it requires, that it
 * registers one `settings.section` per namespace with that page's nav identity,
 * and that it registers nothing for a namespace the Host does not serve. That
 * last one is why a deployment without memo or without github-issue never shows
 * an empty page.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/tests/entry
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  INTAKE_SETTINGS_NAMESPACE,
  INTAKE_SETTINGS_SECTION_ID,
  INTAKE_SETTINGS_SECTION_ORDER,
  inject,
  MEMO_SETTINGS_NAMESPACE,
  MEMO_SETTINGS_SECTION_ID,
  MEMO_SETTINGS_SECTION_ORDER,
} from '../src/client/index.ts'
import type { MemoSettingsView } from '../src/client/form.ts'
import type { IntakeSettingsView } from '../src/client/intake-form.ts'
import { FakeForm } from './fake-form.ts'

afterEach(() => {
  document.querySelectorAll('style[data-dsh-plugin]').forEach(node => node.remove())
})

/** One contribution as the shell would receive it. */
interface RegisteredSection {
  readonly name: string
  readonly id?: string
  readonly order?: number
  readonly label?: string | (() => string)
  readonly locale?: string
  readonly inject?: () => unknown
  readonly component: (props: never) => unknown
}

/** The memo page's injected face, as the page receives it. */
interface MemoFace {
  readonly hooks: { readonly memoSettings: { getSnapshot(): MemoSettingsView } }
  readonly edit: (field: string, text: string) => void
  readonly resetField: (field: string) => void
  readonly save: () => void
  readonly discard: () => void
}

/** The intake page's injected face, as the page receives it. */
interface IntakeFace {
  readonly hooks: { readonly intakeSettings: { getSnapshot(): IntakeSettingsView } }
  readonly edit: (field: string, text: string) => void
  readonly resetField: (field: string) => void
  readonly save: () => void
  readonly discard: () => void
}

/**
 * Apply the browser half against a stand-in for the client context.
 * @param options - whether the namespaces are served and whether slots resolve.
 * @returns what the entry point registered, plus the two forms and a disposer.
 */
function applyPlugin(
  options: { served?: boolean; slots?: boolean; connection?: boolean; installReply?: unknown } = {},
) {
  const sections: RegisteredSection[] = []
  const dictionaries: Record<string, Record<string, Record<string, string>>> = {}
  const effects: (() => void)[] = []
  const served: string[][] = []
  const rpcCalls: { readonly endpoint: string }[] = []
  const memoForm = new FakeForm({ repoUrl: 'https://example.test/repo' })
  const intakeForm = new FakeForm({
    repoUrl: 'https://example.test/repo',
    claimLabel: 'ready-for-agent',
    maxIssuesPerRun: 3,
    autopilotEnabled: false,
  })

  const slots = {
    inject(_key: string, callback: () => () => void): () => void {
      if (options.served === false) return () => {}
      return callback()
    },
    register(slot: RegisteredSection, component: (props: never) => unknown): () => void {
      sections.push({ ...slot, component })
      return () => {}
    },
  }

  const ctx = {
    effect(callback: () => void | (() => void)): void {
      const disposer = callback()
      if (typeof disposer === 'function') effects.push(disposer)
    },
    slots: options.slots === false ? undefined : slots,
    connection: options.connection === false ? undefined : {
      rpc: {
        async call(_channel: string, endpoint: string, payload?: unknown): Promise<unknown> {
          rpcCalls.push({ endpoint, payload })
          if (endpoint === 'pluginManager/installBundle') {
            // The plugin manager answers with its ChangeResult directly, unlike a
            // memo Remote that wraps its own business result.
            return options.installReply ?? {
              ok: true,
              value: { changed: true, application: 'restart-required', stage: 'install', target: 'memo', version: '0.7.0' },
            }
          }
          const value = endpoint === 'memo/pluginInfo'
            ? { currentVersion: '0.6.1', packageName: '@zhangj1164/dsh-memo', registryUrl: 'https://registry.npmjs.org/', profileName: 'web' }
            : {
                currentVersion: '0.6.1',
                latestVersion: '0.7.0',
                updateAvailable: true,
                packageName: '@zhangj1164/dsh-memo',
                registryUrl: 'https://registry.npmjs.org/',
                manualCommand: 'dsh plugin --profile web add --save-exact @zhangj1164/dsh-memo@0.7.0 --registry=https://registry.npmjs.org/',
                checkedAt: 1,
              }
          return { ok: true, value: { ok: true, value } }
        },
      },
    },
    get(name: string): unknown {
      if (name !== 'slots' || options.slots === false) return undefined
      return slots
    },
    locale: {
      register(namespace: string, value: Record<string, Record<string, string>>): void {
        dictionaries[namespace] = value
      },
      bind: (namespace: string) => (key: string): string => dictionaries[namespace]?.zh?.[key] ?? key,
    },
    configForms: {
      get: (id: string): FakeForm => (id === 'memo' ? memoForm : intakeForm),
      whileServed(namespaces: readonly string[], register: () => () => void): () => void {
        served.push([...namespaces])
        return register()
      },
    },
  }

  apply(ctx as never)
  return { sections, dictionaries, effects, served, memoForm, intakeForm, rpcCalls }
}

describe('ui-memo-settings client entry point', () => {
  it('declares exactly the services it reads', () => {
    expect(inject).toEqual(['slots', 'locale', 'configForms', 'connection'])
  })

  it('waits for each namespace before registering its page', () => {
    const { served } = applyPlugin()
    expect(served).toEqual([[MEMO_SETTINGS_NAMESPACE], [INTAKE_SETTINGS_NAMESPACE]])
    expect(MEMO_SETTINGS_NAMESPACE).toBe('memo')
    expect(INTAKE_SETTINGS_NAMESPACE).toBe('github-issue')
  })

  it('registers one settings section per page', () => {
    const { sections } = applyPlugin()
    expect(sections).toHaveLength(2)
    const memoSection = sections[0]!
    expect(memoSection.name).toBe('settings.section')
    expect(memoSection.id).toBe(MEMO_SETTINGS_SECTION_ID)
    expect(memoSection.order).toBe(MEMO_SETTINGS_SECTION_ORDER)
    expect(memoSection.locale).toBe('memo.settings')
    expect((memoSection.label as () => string)()).toBe('备忘')
    const intakeSection = sections[1]!
    expect(intakeSection.id).toBe(INTAKE_SETTINGS_SECTION_ID)
    expect(intakeSection.order).toBe(INTAKE_SETTINGS_SECTION_ORDER)
    expect(intakeSection.order).toBeGreaterThan(MEMO_SETTINGS_SECTION_ORDER)
    expect((intakeSection.label as () => string)()).toBe('GitHub 接单')
    expect(MEMO_SETTINGS_SECTION_ORDER).toBeGreaterThan(15)
  })

  it('registers nothing while the namespaces are not served', () => {
    const { sections } = applyPlugin({ served: false })
    expect(sections).toEqual([])
  })

  it('publishes both dictionaries under its own namespace', () => {
    const { dictionaries } = applyPlugin()
    expect(Object.keys(dictionaries)).toEqual(['memo.settings'])
    expect(dictionaries['memo.settings']?.zh?.title).toBe('备忘设置')
    expect(dictionaries['memo.settings']?.en?.title).toBe('Memo settings')
    expect(dictionaries['memo.settings']?.zh?.intakeNav).toBe('GitHub 接单')
  })

  it('hands the memo page a store over the memo form and the four actions', async () => {
    const { sections, memoForm } = applyPlugin()
    const face = (sections[0]!.inject as () => MemoFace)()
    const draft = face.hooks.memoSettings
    expect(draft.getSnapshot().status).toBe('ready')

    face.edit('provider', 'cu')
    expect(draft.getSnapshot().dirty).toEqual(['provider'])
    await new Promise(resolve => setTimeout(resolve, 0))
    face.save()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(memoForm.writes).toEqual([{ kind: 'set', field: 'provider', value: 'cu' }])

    face.discard()
    expect(draft.getSnapshot().drafts).toEqual({})
  })

  it('routes the update entry through the memo Remote methods', async () => {
    const { sections, rpcCalls } = applyPlugin()
    const face = (sections[0]!.inject as () => {
      readonly update?: {
        readInfo(): Promise<unknown>
        checkUpdate(): Promise<unknown>
        applyUpdate?: (check: unknown) => Promise<unknown>
      }
    })()
    expect(face.update).toBeDefined()

    await face.update!.readInfo()
    expect(rpcCalls.map(call => call.endpoint)).toEqual(['memo/pluginInfo'])
    const checked = await face.update!.checkUpdate() as { readonly latestVersion: string }
    expect(checked.latestVersion).toBe('0.7.0')
    expect(rpcCalls.map(call => call.endpoint)).toEqual(['memo/pluginInfo', 'memo/checkUpdate'])
  })

  it('installs the checked version through the plugin manager', async () => {
    const { sections, rpcCalls } = applyPlugin()
    const face = (sections[0]!.inject as () => {
      readonly update: {
        checkUpdate(): Promise<Record<string, unknown>>
        applyUpdate(check: unknown): Promise<unknown>
      }
    })()
    const checked = await face.update.checkUpdate()
    const result = await face.update.applyUpdate(checked)

    expect(result).toEqual({ ok: true, version: '0.7.0' })
    expect(rpcCalls.map(call => call.endpoint)).toEqual(['memo/checkUpdate', 'pluginManager/installBundle'])
    // The spec is the pinned version the check resolved, and the registry is the
    // one that answered, so the automatic path installs exactly what was offered.
    expect(rpcCalls[1]?.payload).toEqual({
      args: {
        spec: '@zhangj1164/dsh-memo@0.7.0',
        options: { saveExact: true, registry: 'https://registry.npmjs.org/' },
      },
    })
  })

  it('reports the manager reason when the install fails', async () => {
    const { sections } = applyPlugin({
      installReply: {
        ok: true,
        value: {
          changed: false,
          application: 'failed',
          stage: 'install',
          target: 'memo',
          error: { message: 'profile is read-only' },
        },
      },
    })
    const face = (sections[0]!.inject as () => {
      readonly update: {
        checkUpdate(): Promise<unknown>
        applyUpdate(check: unknown): Promise<unknown>
      }
    })()
    const checked = await face.update.checkUpdate()
    expect(await face.update.applyUpdate(checked)).toEqual({ ok: false, reason: 'profile is read-only' })
  })

  it('treats a cancelled install as a failure with nothing else to report', async () => {
    const { sections } = applyPlugin({
      installReply: {
        ok: true,
        value: { changed: false, application: 'cancelled', stage: 'install', target: 'memo' },
      },
    })
    const face = (sections[0]!.inject as () => {
      readonly update: {
        checkUpdate(): Promise<unknown>
        applyUpdate(check: unknown): Promise<unknown>
      }
    })()
    const checked = await face.update.checkUpdate()
    expect(await face.update.applyUpdate(checked)).toEqual({ ok: false })
  })

  it('hands the intake page a store over the github-issue form', async () => {
    const { sections, intakeForm } = applyPlugin()
    const face = (sections[1]!.inject as () => IntakeFace)()
    const draft = face.hooks.intakeSettings
    expect(draft.getSnapshot().status).toBe('ready')

    face.edit('maxIssuesPerRun', '5')
    await new Promise(resolve => setTimeout(resolve, 0))
    face.save()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(intakeForm.writes).toEqual([{ kind: 'set', field: 'maxIssuesPerRun', value: 5 }])
  })

  it('disposes both drafts when the plugin unloads', () => {
    const { effects } = applyPlugin()
    // styles, dictionaries (no disposer), memo draft, memo page, intake page
    expect(effects.length).toBeGreaterThanOrEqual(3)
    expect(() => { for (const dispose of effects) dispose() }).not.toThrow()
  })

  it('reports a missing slots service instead of throwing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => { applyPlugin({ slots: false }) }).not.toThrow()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('adds its stylesheet and removes it on unload', () => {
    const { effects } = applyPlugin()
    const style = document.head.querySelector('style[data-dsh-plugin="memo.settings"]')
    expect(style?.textContent).toContain('.dsh-memo-settings')
    for (const dispose of effects) dispose()
    expect(document.head.querySelector('style[data-dsh-plugin="memo.settings"]')).toBeNull()
  })
})
