// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  apply,
  inject,
  OPENWIKI_ENTRY_ORDER,
  OPENWIKI_TAB_ID,
  OPENWIKI_TAB_KIND,
} from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'
import type { OpenWikiResult } from '../src/types.ts'

afterEach(() => {
  cleanup()
  document.querySelectorAll('style[data-dsh-plugin]').forEach(node => node.remove())
})

/** One slot registration as the fake shell saw it. */
interface RegisteredSlot {
  readonly name: string
  readonly id?: string
  readonly key?: string
  readonly order?: number
  readonly locale?: string
  readonly render: () => React.ReactElement
}

/** One tab type as the fake tab registry saw it. */
interface TabDefinition {
  readonly id: string
  readonly kind: string
  readonly multiple?: boolean
  readonly title: (address: string) => string
}

/** One `openTab` call. */
interface OpenTabCall {
  readonly kind: string
  readonly options?: { readonly params?: Record<string, unknown> }
}

/** The environment report a healthy machine produces. */
const HEALTHY_ENVIRONMENT = {
  ok: true,
  openwiki: {
    found: true,
    version: '0.7.2',
    meetsMinimum: true,
    minimumVersion: '0.7.2',
    source: 'openwiki',
  },
  dsh: {
    version: '0.1.5-rc.1',
    minimumVersion: '0.1.5-rc.1',
    meetsMinimum: true,
    source: '@deepseek-ai/dsh-base',
  },
  node: 'v24.19.0',
  platform: 'win32',
}

/** The workspace report a workspace that has an openwiki produces. */
const WIKI_WORKSPACE = {
  hasWiki: true,
  wikiPath: '/repo/openwiki',
  workspacePath: '/repo',
  pageCount: 7,
  marker: 'index',
}

/** Answer table defaults, overridable per test. */
function table(overrides: Record<string, OpenWikiResult<unknown>> = {}): Record<string, OpenWikiResult<unknown>> {
  return {
    [`openwikiVisualize/environment`]: { ok: true, value: HEALTHY_ENVIRONMENT },
    [`openwikiVisualize/workspace`]: { ok: true, value: WIKI_WORKSPACE },
    [`openwikiVisualize/status`]: { ok: true, value: { running: false } },
    [`openwikiVisualize/start`]: {
      ok: true,
      value: { running: true, port: 4321, url: 'http://127.0.0.1:4321' },
    },
    ...overrides,
  }
}

/**
 * Apply the real browser half against a minimal stand-in for the client context.
 *
 * This is the wiring the shell performs at runtime, and the entry point is where
 * a registration mistake would hide: a wrong seat, a wrong key, or a wrong order
 * all still typecheck, and only the wiring test catches them.
 */
function applyPlugin(
  answers: Record<string, OpenWikiResult<unknown>> = table(),
  expandedColumn = true,
): {
  readonly slots: RegisteredSlot[]
  readonly tabTypes: TabDefinition[]
  readonly openTabs: OpenTabCall[]
  readonly dictionaries: Record<string, unknown>
  readonly effects: (() => void)[]
  readonly reveals: () => number
} {
  const slots: RegisteredSlot[] = []
  const tabTypes: TabDefinition[] = []
  const openTabs: OpenTabCall[] = []
  const dictionaries: Record<string, unknown> = {}
  const effects: (() => void)[] = []
  let expanded = expandedColumn
  let reveals = 0

  const ctx = {
    effect(callback: () => void | (() => void)): void {
      const disposer = callback()
      if (typeof disposer === 'function') effects.push(disposer)
    },
    on(): void {},
    inject(_names: string[], callback: (scoped: unknown) => void): void {
      // The shell runs the callback once the named services exist. The fake runs
      // it at once, which is the ordering a satisfied injection produces.
      callback(ctx)
    },
    get(name: string): unknown {
      if (name === 'connection') {
        return {
          rpc: {
            async call(_channel: string, endpoint: string): Promise<unknown> {
              const answer = answers[endpoint]
              if (answer === undefined) {
                return { ok: false, error: { code: 'not-found', message: endpoint } }
              }
              return { ok: true, value: answer }
            },
          },
        }
      }
      if (name === 'sidebarRightTabs') {
        return {
          register(definition: TabDefinition): () => void {
            tabTypes.push(definition)
            return () => undefined
          },
        }
      }
      if (name === 'sidebarRight') {
        return {
          openTab(kind: string, options?: OpenTabCall['options']): void {
            openTabs.push({ kind, ...(options === undefined ? {} : { options }) })
          },
          isExpanded: (): boolean => expanded,
          toggleExpanded: (): void => { expanded = !expanded; reveals += 1 },
        }
      }
      return undefined
    },
    locale: {
      register(namespace: string, value: unknown): () => void {
        dictionaries[namespace] = value
        return () => undefined
      },
      bind: (namespace: string) => (key: string, vars?: Record<string, string | number>): string => {
        const tables = dictionaries[namespace] as Record<string, Record<string, string>> | undefined
        const template = tables?.['zh']?.[key] ?? key
        if (vars === undefined) return template
        return Object.entries(vars).reduce(
          (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'gu'), String(value)),
          template,
        )
      },
    },
    slots: {
      inject(_name: string, callback: () => () => void): () => void {
        callback()
        return () => undefined
      },
      register(config: Record<string, unknown>, component: unknown): () => void {
        slots.push({ ...config, render: component as () => React.ReactElement })
        return () => undefined
      },
    },
  }

  apply(ctx as never)
  return { slots, tabTypes, openTabs, dictionaries, effects, reveals: () => reveals }
}

describe('ui-openwiki-visualize client entry', () => {
  it('requires the services its three registrations depend on', () => {
    expect([...inject].sort()).toEqual(['connection', 'locale', 'slots'])
  })

  it('injects its own stylesheet once', () => {
    applyPlugin()
    expect(document.querySelectorAll('style[data-dsh-plugin="openwiki"]')).toHaveLength(1)
  })

  it('registers both locale dictionaries under one namespace', () => {
    const { dictionaries } = applyPlugin()
    expect(dictionaries['openwiki']).toEqual({ zh, en })
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('registers the tab type under the package name so the registry id is unique', () => {
    const { tabTypes } = applyPlugin()
    expect(tabTypes).toHaveLength(1)
    expect(tabTypes[0]?.kind).toBe(OPENWIKI_TAB_KIND)
    expect(tabTypes[0]?.id).toBe(OPENWIKI_TAB_ID)
    expect(tabTypes[0]?.multiple).toBe(false)
    expect(tabTypes[0]?.title('/')).toBe('OpenWiki')
  })

  it('keys the pane body by the definition id, not the kind', () => {
    const { slots } = applyPlugin()
    const pane = slots.find(slot => slot.name === 'sidebar.right.pane.tab')
    expect(pane?.key).toBe(OPENWIKI_TAB_ID)
  })

  it('places the header entry to the left of open-in-app, which holds order -10', () => {
    const { slots } = applyPlugin()
    const entry = slots.find(slot => slot.name === 'conversation.session.header.utilities')
    expect(entry?.id).toBe('openwiki-visualize')
    expect(entry?.order).toBe(OPENWIKI_ENTRY_ORDER)
    expect(entry?.order ?? 0).toBeLessThan(-10)
  })

  it('starts the visualizer and opens the preview tab with the port it bound', async () => {
    const { slots, openTabs } = applyPlugin()
    const entry = slots.find(slot => slot.name === 'conversation.session.header.utilities')
    render(entry!.render())

    const button = await screen.findByRole('button')
    await waitFor(() => { expect((button as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(button)

    await waitFor(() => { expect(openTabs).toHaveLength(1) })
    expect(openTabs[0]?.kind).toBe(OPENWIKI_TAB_KIND)
    expect(openTabs[0]?.options?.params).toEqual({ port: 4321 })
  })

  it('reveals a collapsed column, and leaves an expanded one alone', async () => {
    const collapsed = applyPlugin(table(), false)
    const collapsedEntry = collapsed.slots.find(slot => slot.name === 'conversation.session.header.utilities')
    render(collapsedEntry!.render())
    const collapsedButton = await screen.findByRole('button')
    await waitFor(() => { expect((collapsedButton as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(collapsedButton)
    // A tab placed in a collapsed column shows nothing, so it must be revealed.
    await waitFor(() => { expect(collapsed.reveals()).toBe(1) })

    cleanup()
    const expanded = applyPlugin(table(), true)
    const expandedEntry = expanded.slots.find(slot => slot.name === 'conversation.session.header.utilities')
    render(expandedEntry!.render())
    const expandedButton = await screen.findByRole('button')
    await waitFor(() => { expect((expandedButton as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(expandedButton)
    await waitFor(() => { expect(expanded.openTabs).toHaveLength(1) })
    // Toggling here would have collapsed the column the user already had open.
    expect(expanded.reveals()).toBe(0)
  })

  it('disables the entry, with a reason, when the workspace has no wiki', async () => {
    const { slots } = applyPlugin(table({
      [`openwikiVisualize/workspace`]: {
        ok: true,
        value: { hasWiki: false, wikiPath: '/repo/openwiki', workspacePath: '/repo' },
      },
    }))
    const entry = slots.find(slot => slot.name === 'conversation.session.header.utilities')
    render(entry!.render())

    const button = await screen.findByRole('button')
    await waitFor(() => { expect((button as HTMLButtonElement).disabled).toBe(true) })
    expect(button.getAttribute('aria-label')).toBe(zh['nav.disabled.noWiki'])
  })

  it('disables the entry when openwiki is not installed at all', async () => {
    const { slots } = applyPlugin(table({
      [`openwikiVisualize/environment`]: {
        ok: true,
        value: {
          ...HEALTHY_ENVIRONMENT,
          ok: false,
          openwiki: { found: false, meetsMinimum: false, minimumVersion: '0.7.2', source: 'openwiki' },
        },
      },
    }))
    const entry = slots.find(slot => slot.name === 'conversation.session.header.utilities')
    render(entry!.render())

    const button = await screen.findByRole('button')
    await waitFor(() => { expect((button as HTMLButtonElement).disabled).toBe(true) })
    expect(button.getAttribute('aria-label')).toBe(zh['nav.disabled.noTool'])
  })

  it('reports the minimum when openwiki is too old, naming the floor', async () => {
    const { slots } = applyPlugin(table({
      [`openwikiVisualize/environment`]: {
        ok: true,
        value: {
          ...HEALTHY_ENVIRONMENT,
          ok: false,
          openwiki: {
            found: true,
            version: '0.6.0',
            meetsMinimum: false,
            minimumVersion: '0.7.2',
            source: 'openwiki',
          },
        },
      },
    }))
    const entry = slots.find(slot => slot.name === 'conversation.session.header.utilities')
    render(entry!.render())

    const button = await screen.findByRole('button')
    await waitFor(() => { expect((button as HTMLButtonElement).disabled).toBe(true) })
    expect(button.getAttribute('aria-label')).toContain('0.7.2')
  })

  it('embeds the served reader in the pane once the visualizer is running', async () => {
    const { slots } = applyPlugin(table({
      [`openwikiVisualize/status`]: {
        ok: true,
        value: { running: true, port: 4321, url: 'http://127.0.0.1:4321' },
      },
    }))
    const pane = slots.find(slot => slot.name === 'sidebar.right.pane.tab')
    render(pane!.render())

    const frame = await screen.findByTitle('OpenWiki')
    expect(frame.getAttribute('src')).toBe('http://127.0.0.1:4321')
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts')
    expect(frame.getAttribute('sandbox')).toContain('allow-same-origin')
  })

  it('offers a start control instead of an empty frame when nothing is running', async () => {
    const { slots } = applyPlugin()
    const pane = slots.find(slot => slot.name === 'sidebar.right.pane.tab')
    render(pane!.render())

    await waitFor(() => { expect(screen.queryByTitle('OpenWiki')).toBeNull() })
    expect(await screen.findByText(zh['empty.retry'])).toBeTruthy()
  })

  it('degrades gracefully when the profile composes no right Sidebar', () => {
    const slots: RegisteredSlot[] = []
    const ctx = {
      effect(callback: () => void | (() => void)): void { callback() },
      on(): void {},
      // The registry never appears, so the scoped injection runs its callback
      // with nothing to register into.
      inject(_names: string[], callback: (scoped: unknown) => void): void { callback(ctx) },
      get(name: string): unknown {
        if (name === 'connection') return { rpc: { call: async () => ({ ok: true, value: { ok: true, value: {} } }) } }
        return undefined
      },
      locale: {
        register: () => () => undefined,
        bind: () => (key: string) => key,
      },
      slots: {
        inject: (_name: string, callback: () => () => void) => { callback(); return () => undefined },
        register: (config: Record<string, unknown>, component: unknown) => {
          slots.push({ ...config, render: component as () => React.ReactElement })
          return () => undefined
        },
      },
    }
    expect(() => { apply(ctx as never) }).not.toThrow()
    // The pane body and the header entry are still contributed — the environment
    // report and the workspace probe stay useful — and only the tab type, which
    // needs the registry, is absent.
    expect(slots.map(slot => slot.name).sort()).toEqual([
      'conversation.session.header.utilities',
      'sidebar.right.pane.tab',
    ])
  })

  it('registers the tab type when the registry arrives after apply', () => {
    // The right Sidebar's own plugin can materialize after this one, so the tab
    // type must not depend on reading its registry at apply time. This shell
    // hands the callback over and provides the service only afterwards, which is
    // exactly the ordering the live shell can produce.
    const tabTypes: TabDefinition[] = []
    let registry: unknown
    let pending: ((scoped: unknown) => void) | undefined
    const slots: RegisteredSlot[] = []
    const ctx = {
      effect(callback: () => void | (() => void)): void { callback() },
      on(): void {},
      inject(_names: string[], callback: (scoped: unknown) => void): void { pending = callback },
      get(name: string): unknown {
        if (name === 'connection') return { rpc: { call: async () => ({ ok: true, value: { ok: true, value: {} } }) } }
        if (name === 'sidebarRightTabs') return registry
        return undefined
      },
      locale: {
        register: () => () => undefined,
        bind: () => (key: string) => key,
      },
      slots: {
        inject: (_name: string, callback: () => () => void) => { callback(); return () => undefined },
        register: (config: Record<string, unknown>, component: unknown) => {
          slots.push({ ...config, render: component as () => React.ReactElement })
          return () => undefined
        },
      },
    }
    apply(ctx as never)
    // Nothing to register into yet, but apply itself must still have succeeded.
    expect(tabTypes).toHaveLength(0)
    expect(typeof pending).toBe('function')

    registry = {
      register(definition: TabDefinition): () => void {
        tabTypes.push(definition)
        return () => undefined
      },
    }
    pending?.(ctx)

    expect(tabTypes).toHaveLength(1)
    expect(tabTypes[0]?.kind).toBe(OPENWIKI_TAB_KIND)
    expect(tabTypes[0]?.id).toBe(OPENWIKI_TAB_ID)
  })
})
