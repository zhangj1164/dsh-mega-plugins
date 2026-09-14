// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apply, inject, MEMO_SECTION_ID, MEMO_SECTION_ORDER } from '../src/client/index.ts'
import { createFakeRpc, isoWeekId } from './fake-rpc.ts'
import { zh, en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  document.querySelectorAll('style[data-dsh-plugin]').forEach(node => node.remove())
})

/** What one registered section looks like to the shell. */
interface RegisteredSection {
  name: string
  id: string
  order?: number
  label: string | (() => string)
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
  const registered: RegisteredSection[] = []
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
      inject(key: string, callback: () => void): void {
        expect(key).toBe('settings.section')
        callback()
      },
      register(section: RegisteredSection, component: (props: { close: () => void }) => React.ReactElement): void {
        registered.push(section)
        element = component({ close: vi.fn() })
      },
    },
  }

  apply(ctx as never, { repoUrl: 'https://example.test/repo' })
  return { rpc, registered, effects, listeners, element: element as React.ReactElement | null, dictionaries }
}

describe('ui-memo client entry point', () => {
  it('declares exactly the services it reads', () => {
    expect(inject).toEqual(['slots', 'locale', 'theme', 'connection'])
  })

  it('registers one settings section at the documented position', () => {
    const { registered } = applyPlugin()
    expect(registered).toHaveLength(1)
    const section = registered[0]!
    expect(section.name).toBe('settings.section')
    expect(section.id).toBe(MEMO_SECTION_ID)
    expect(section.order).toBe(MEMO_SECTION_ORDER)
    expect(typeof section.label).toBe('function')
  })

  it('labels the section through the locale service', () => {
    const { registered } = applyPlugin()
    expect((registered[0]!.label as () => string)()).toBe(zh.nav)
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

  it('registers the section component as an element, not a bare call', () => {
    // Regression: the entry point used to call `MemoBoard({...})` directly, so
    // the component's hooks ran outside a render and React threw
    // "Invalid hook call" as soon as the section opened.
    const { element } = applyPlugin()
    expect(React.isValidElement(element)).toBe(true)
    expect(typeof element).toBe('object')
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
    expect(open).toHaveBeenCalledOnce()
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
