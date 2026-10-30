// @vitest-environment jsdom
/**
 * The browser half's wiring, exercised through the entry point the shell calls.
 *
 * What matters here is not the page — its own suite covers that — but the three
 * things the entry point decides: which services it requires, that it registers
 * exactly one `settings.section` with the memo page's nav identity, and that it
 * registers nothing at all while the Host does not serve the `memo` namespace.
 * That last one is why a deployment without memo never shows an empty page.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/tests/entry
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  inject,
  MEMO_SETTINGS_NAMESPACE,
  MEMO_SETTINGS_SECTION_ID,
  MEMO_SETTINGS_SECTION_ORDER,
} from '../src/client/index.ts'
import type { MemoSettingsView } from '../src/client/form.ts'
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

/** The injected face, as the page receives it. */
interface InjectedFace {
  readonly hooks: { readonly memoSettings: { getSnapshot(): MemoSettingsView } }
  readonly edit: (field: string, text: string) => void
  readonly resetField: (field: string) => void
  readonly save: () => void
  readonly discard: () => void
}

/**
 * Apply the browser half against a stand-in for the client context.
 * @param options - whether the namespace is served and whether slots resolve.
 * @returns what the entry point registered, plus a disposer.
 */
function applyPlugin(options: { served?: boolean; slots?: boolean } = {}) {
  const sections: RegisteredSection[] = []
  const dictionaries: Record<string, Record<string, Record<string, string>>> = {}
  const effects: (() => void)[] = []
  const served: string[][] = []
  const form = new FakeForm({ repoUrl: 'https://example.test/repo' })

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
      get: (id: string): FakeForm => form,
      whileServed(namespaces: readonly string[], register: () => () => void): () => void {
        served.push([...namespaces])
        return register()
      },
    },
  }

  apply(ctx as never)
  return { sections, dictionaries, effects, served, form }
}

describe('ui-memo-settings client entry point', () => {
  it('declares exactly the services it reads', () => {
    expect(inject).toEqual(['slots', 'locale', 'configForms'])
  })

  it('waits for the memo namespace before registering', () => {
    const { served } = applyPlugin()
    expect(served).toEqual([[MEMO_SETTINGS_NAMESPACE]])
    expect(MEMO_SETTINGS_NAMESPACE).toBe('memo')
  })

  it('registers one settings section with the memo page identity', () => {
    const { sections } = applyPlugin()
    expect(sections).toHaveLength(1)
    const section = sections[0]!
    expect(section.name).toBe('settings.section')
    expect(section.id).toBe(MEMO_SETTINGS_SECTION_ID)
    expect(section.order).toBe(MEMO_SETTINGS_SECTION_ORDER)
    expect(section.locale).toBe('memo.settings')
    expect((section.label as () => string)()).toBe('备忘')
    expect(MEMO_SETTINGS_SECTION_ORDER).toBeGreaterThan(15)
  })

  it('registers nothing while the namespace is not served', () => {
    const { sections } = applyPlugin({ served: false })
    expect(sections).toEqual([])
  })

  it('publishes both dictionaries under its own namespace', () => {
    const { dictionaries } = applyPlugin()
    expect(Object.keys(dictionaries)).toEqual(['memo.settings'])
    expect(dictionaries['memo.settings']?.zh?.title).toBe('备忘设置')
    expect(dictionaries['memo.settings']?.en?.title).toBe('Memo settings')
  })

  it('hands the page a store over the memo form and the four actions', async () => {
    const { sections, form } = applyPlugin()
    const face = (sections[0]!.inject as () => InjectedFace)()
    const draft = face.hooks.memoSettings
    expect(draft.getSnapshot().status).toBe('ready')

    face.edit('provider', 'cu')
    expect(draft.getSnapshot().dirty).toEqual(['provider'])
    await new Promise(resolve => setTimeout(resolve, 0))
    face.save()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(form.writes).toEqual([{ kind: 'set', field: 'provider', value: 'cu' }])

    face.discard()
    expect(draft.getSnapshot().drafts).toEqual({})
  })

  it('disposes the draft when the plugin unloads', () => {
    const { effects } = applyPlugin()
    // styles, dictionaries (no disposer), draft, page
    expect(effects.length).toBeGreaterThanOrEqual(2)
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
