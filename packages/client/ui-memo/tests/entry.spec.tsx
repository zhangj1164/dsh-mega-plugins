// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apply, inject, MEMO_PANEL_ID, MEMO_PANEL_ORDER } from '../src/client/index.ts'
import { createFakeRpc, isoWeekId } from './fake-rpc.ts'
import { zh, en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  document.querySelectorAll('style[data-dsh-plugin]').forEach(node => node.remove())
})

/** What one registered slot looks like to the shell. */
interface RegisteredSlot {
  name: string
  id?: string
  key?: string
  order?: number
  label?: string | (() => string)
}

/** Props the sidebar hands a panel-list glyph. */
interface GlyphProps {
  readonly size: number
}

/**
 * Apply the real browser half against a minimal stand-in for the client
 * context.
 *
 * This is the wiring the shell performs at runtime. The entry point is where
 * the earlier "Invalid hook call" defect lived — it passed the component in
 * rather than an element — so the entry point itself has to be exercised, not
 * just the component it renders.
 */
function applyPlugin(options: Parameters<typeof createFakeRpc>[0] = {}) {
  const rpc = createFakeRpc(options)
  const dictionaries: Record<string, unknown> = {}
  const effects: (() => void)[] = []
  const listeners: Record<string, (() => void)[]> = {}
  const registered: RegisteredSlot[] = []
  const selectedPanels: (string | null)[] = []
  let glyph: ((props: GlyphProps) => React.ReactElement) | null = null
  let element: React.ReactElement | null = null

  const ctx = {
    effect(callback: () => void | (() => void)): void {
      const disposer = callback()
      if (typeof disposer === 'function') effects.push(disposer)
    },
    on(event: string, handler: () => void): void {
      listeners[event] = [...(listeners[event] ?? []), handler]
    },
    get(name: string): unknown {
      if (name !== 'connection') return undefined
      return { rpc: { call: rpc.call } }
    },
    layout: {
      selectPanel(panelId: string | null): void {
        selectedPanels.push(panelId)
      },
    },
    locale: {
      register(namespace: string, value: unknown): void {
        dictionaries[namespace] = value
      },
      bind: (namespace: string) => (key: string): string => {
        const table = dictionaries[namespace] as Record<string, Record<string, string>> | undefined
        return table?.['zh']?.[key] ?? key
      },
    },
    slots: {
      inject(_key: string, callback: () => void): void {
        callback()
      },
      register(slot: RegisteredSlot, component: (props: never) => React.ReactElement): void {
        registered.push(slot)
        if (slot.name === 'sidebar.panellist') {
          glyph = component as unknown as (props: GlyphProps) => React.ReactElement
          return
        }
        // A keyed main entry receives no owner props.
        element = (component as unknown as () => React.ReactElement)()
      },
    },
  }

  apply(ctx as never, { repoUrl: 'https://example.test/repo' })
  return {
    rpc,
    registered,
    effects,
    listeners,
    element: element as React.ReactElement | null,
    dictionaries,
    selectedPanels,
    glyph: glyph as ((props: GlyphProps) => React.ReactElement) | null,
  }
}

describe('ui-memo client entry point', () => {
  it('declares exactly the services it reads', () => {
    expect(inject).toEqual(['slots', 'layout', 'locale', 'theme', 'connection'])
  })

  it('registers one sidebar entry and one main panel, sharing the panel id', () => {
    const { registered } = applyPlugin()
    expect(registered).toHaveLength(2)

    const entry = registered.find(slot => slot.name === 'sidebar.panellist')
    expect(entry?.id).toBe(MEMO_PANEL_ID)
    expect(entry?.order).toBe(MEMO_PANEL_ORDER)
    expect(typeof entry?.label).toBe('function')

    // The main slot is keyed by the sidebar entry id, which is how the layout
    // knows which panel a sidebar button opens.
    const panel = registered.find(slot => slot.name === 'main')
    expect(panel?.key).toBe(MEMO_PANEL_ID)
  })

  it('registers no settings section any more', () => {
    // A single entry point: two live registrations would render one controller
    // in two places.
    const { registered } = applyPlugin()
    expect(registered.some(slot => slot.name === 'settings.section')).toBe(false)
  })

  it('draws the sidebar glyph at the size the sidebar asks for', () => {
    const { glyph } = applyPlugin()
    expect(glyph).not.toBeNull()
    const { container } = render(React.createElement(glyph!, { size: 18 }))
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('18')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  it('labels the sidebar entry through the locale service', () => {
    const { registered } = applyPlugin()
    const entry = registered.find(slot => slot.name === 'sidebar.panellist')
    expect((entry!.label as () => string)()).toBe(zh.nav)
  })

  it('registers both dictionaries under its own namespace', () => {
    const { dictionaries } = applyPlugin()
    expect(dictionaries.memo).toEqual({ zh, en })
  })

  it('injects its stylesheet and removes it on disposal', () => {
    const { effects } = applyPlugin()
    const style = document.querySelector('style[data-dsh-plugin="memo"]')
    expect(style).not.toBeNull()
    expect(style?.textContent).toContain('.dsh-memo')
    for (const dispose of effects) dispose()
    expect(document.querySelector('style[data-dsh-plugin="memo"]')).toBeNull()
  })

  it('registers the panel component as an element, not a bare call', () => {
    // Regression: the entry point used to call `MemoBoard({...})` directly, so
    // the component's hooks ran outside a render and React threw
    // "Invalid hook call" as soon as the section opened.
    const { element } = applyPlugin()
    expect(React.isValidElement(element)).toBe(true)
    expect(typeof element).toBe('object')
  })

  it('returns to the conversation panel when the board closes', async () => {
    const { element, selectedPanels } = applyPlugin()
    render(element)
    await waitFor(() => { expect(screen.getByRole('button', { name: zh.close })).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: zh.close }))
    // Closing is a navigation, not local component state: the layout owns which
    // panel is selected.
    expect(selectedPanels).toEqual(['conversation'])
  })

  it('renders the board into the shell so every feature is reachable', async () => {
    const week = isoWeekId(new Date())
    const { element, rpc } = applyPlugin({ weeks: { [week]: { entries: [{ id: 'a', content: 'from the shell', createdAt: 1 }] } } })
    render(element)

    await waitFor(() => { expect(screen.getByText('from the shell')).toBeTruthy() })
    // The dimension switch, the composer, and the header actions all survive
    // the shell's own registration path.
    expect(screen.getAllByRole('tab').some(tab => tab.textContent === '季度')).toBe(true)
    expect(screen.getByRole('textbox', { name: zh.addPlaceholder })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.addIssue })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.close })).toBeTruthy()
    expect(rpc.calls.some(call => call.endpoint === 'memo/listPeriods')).toBe(true)
  })

  it('reloads when the connection resets', async () => {
    const { rpc, listeners, element } = applyPlugin()
    // The board loads on mount; that first load has to settle before its calls
    // can be discounted, or the reload assertion would be satisfied by it.
    render(element)
    await waitFor(() => { expect(rpc.calls.some(call => call.endpoint === 'memo/listPeriods')).toBe(true) })
    rpc.clearCalls()

    expect(listeners['connection/reset']).toHaveLength(1)
    listeners['connection/reset']![0]!()
    await waitFor(() => { expect(rpc.calls.some(call => call.endpoint === 'memo/listWeeks')).toBe(true) })
  })

  it('opens an external URL in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { element } = applyPlugin({ issueReport: { title: 't', body: 'b', labels: [] } as never })
    render(element)
    await waitFor(() => { expect(screen.getByRole('button', { name: zh.addIssue })).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: zh.addIssue }))
    fireEvent.change(screen.getByRole('textbox', { name: zh.issuePlaceholder }), { target: { value: 'broken' } })
    fireEvent.click(screen.getByRole('button', { name: zh.optimizeIssue }))
    await waitFor(() => { expect(screen.getByText(zh.openGithub)).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: zh.openGithub }))
    // Opening is asynchronous now: the URL is requested from the github-issue
    // service, which owns the length limit.
    await waitFor(() => { expect(open).toHaveBeenCalledOnce() })
    expect(String(open.mock.calls[0]?.[0])).toContain('https://example.test/repo/issues/new?')
    expect(open.mock.calls[0]?.[2]).toContain('noopener')
    open.mockRestore()
  })

  it('reports a missing connection instead of throwing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ctx = {
      effect: () => undefined,
      on: () => undefined,
      get: () => undefined,
      locale: { register: () => undefined, bind: () => () => '' },
      slots: { inject: () => undefined, register: () => undefined },
    }
    expect(() => { apply(ctx as never, { repoUrl: 'https://example.test/repo' }) }).not.toThrow()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
