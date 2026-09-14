// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoBoard } from '../src/client/MemoBoard.tsx'
import { MemoController } from '../src/client/controller.ts'
import { zh, type MemoKey } from '../src/client/locales.ts'
import { createFakeRpc, isoWeekId, issueReport, type FakeRpcOptions } from './fake-rpc.ts'
import type { StorageLike } from '../src/client/logic.ts'

afterEach(cleanup)

const REPO_URL = 'https://example.test/repo'

/** In-memory Storage. */
function fakeStorage(): StorageLike {
  const data: Record<string, string> = {}
  return { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value } }
}

/** Build the board props for one render. */
function boardProps(controller: MemoController) {
  return {
    controller,
    t: (key: MemoKey): string => zh[key],
    close: vi.fn(),
    openUrl: vi.fn(),
    copyText: vi.fn(async () => undefined),
  }
}

/**
 * Render the board and wait for its first load to settle.
 *
 * The element goes through `React.createElement`: calling the component
 * directly would run its hooks outside a render and throw "Invalid hook call".
 */
async function renderBoard(options: FakeRpcOptions = {}) {
  const rpc = createFakeRpc(options)
  // The board sends issues to the repository the controller is configured with,
  // and the controller hands it to the github-issue service.
  const controller = new MemoController({ rpc: { call: rpc.call }, repoUrl: REPO_URL, storage: fakeStorage() })
  const props = boardProps(controller)
  render(React.createElement(MemoBoard, props))
  await waitFor(() => { expect(controller.getSnapshot().status).toBe('ready') })
  return { rpc, controller, openUrl: props.openUrl, close: props.close, copyText: props.copyText }
}

/** The rendered memo cards. Result panels are sections, so they cannot leak in. */
function cards(): HTMLElement[] {
  return screen.queryAllByRole('article')
}

/** The four dimension tabs, in display order. */
function dimensionTabs(): HTMLElement[] {
  return screen.getAllByRole('tab').filter(tab => ['周', '月', '季度', '年'].includes(tab.textContent ?? ''))
}

/** The history chips of the active dimension. */
function historyChips(pattern: RegExp): HTMLElement[] {
  return screen.getAllByRole('tab').filter(tab => pattern.test(tab.textContent ?? ''))
}

/**
 * Whether a button is disabled.
 *
 * Asserted through the DOM property rather than a jest-dom matcher so the
 * suite needs no extra dependency, and so a disabled attribute that React
 * never removed is caught.
 * @param element - the element to inspect.
 * @returns true when the element is a disabled button.
 */
function isDisabled(element: HTMLElement | null): boolean {
  return element instanceof HTMLButtonElement && element.disabled
}

/** The composer's creator button. */
function creatorButton(): HTMLElement {
  const button = document.querySelector('.dsh-memo-creator')
  if (!(button instanceof HTMLButtonElement)) throw new Error('creator button not rendered')
  return button
}

/** Seed one week holding the given memo texts. */
function seedWeek(contents: string[]): FakeRpcOptions {
  const week = isoWeekId(new Date())
  return {
    weeks: {
      [week]: {
        entries: contents.map((content, index) => ({ id: `entry-${String(index)}`, content, createdAt: 10 - index })),
      },
    },
  }
}

/** The ISO week id `days` days before now, so a test can place a memo in the past. */
function weekIdDaysAgo(days: number): string {
  return isoWeekId(new Date(Date.now() - days * 24 * 60 * 60 * 1000))
}

/** Seed several weeks at once, which is what gives the history more than one tag. */
function seedWeeks(weeks: Record<string, string[]>): FakeRpcOptions {
  return {
    weeks: Object.fromEntries(Object.entries(weeks).map(([weekId, contents]) => [weekId, {
      entries: contents.map((content, index) => ({ id: `${weekId}-${String(index)}`, content, createdAt: 10 - index })),
    }])),
  }
}

describe('MemoBoard header', () => {
  it('renders the section title', async () => {
    await renderBoard()
    expect(screen.getByRole('heading', { name: zh.panelTitle })).toBeTruthy()
  })

  it('orders Add Issue, Analyze Logs, Close in the header, each with an icon and a label', async () => {
    const { close } = await renderBoard()
    const addIssue = screen.getByRole('button', { name: zh.addIssue })
    const analyzeLogs = screen.getByRole('button', { name: zh.analyzeLogs })
    const closeButton = screen.getByRole('button', { name: zh.close })

    // The requirement is positional: all three sit together in the header, each
    // carrying an icon and its label, and Close stays rightmost. DOM order is
    // what a reader perceives, so assert it.
    const order = [addIssue, analyzeLogs, closeButton]
    for (let index = 0; index < order.length - 1; index += 1) {
      const current = order[index]!
      expect(current.compareDocumentPosition(order[index + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    for (const button of order) {
      expect(button.querySelector('svg')).not.toBeNull()
      // The label is visible text now, not a tooltip: the accessible name comes
      // from the button's own contents.
      expect(button.textContent?.trim().length).toBeGreaterThan(0)
    }

    fireEvent.click(closeButton)
    expect(close).toHaveBeenCalledOnce()
  })

  it('offers log analysis from the header rather than from the tools row', async () => {
    const { rpc } = await renderBoard({ logAnalysis: { report: issueReport(), issueUrl: 'https://example.test/i' } })
    const header = screen.getByRole('heading', { name: zh.panelTitle }).closest('header')
    const analyzeLogs = screen.getByRole('button', { name: zh.analyzeLogs })

    expect(header?.contains(analyzeLogs)).toBe(true)
    fireEvent.click(analyzeLogs)
    await waitFor(() => { expect(rpc.calls.some(call => call.endpoint === 'memo/analyzeLogs')).toBe(true) })
  })

  it('toggles the issue editor from the header button', async () => {
    await renderBoard()
    expect(screen.queryByText(zh.issueEditorTitle)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.addIssue }))
    expect(screen.getByText(zh.issueEditorTitle)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.addIssue }))
    expect(screen.queryByText(zh.issueEditorTitle)).toBeNull()
  })
})

describe('MemoBoard four-dimension navigation', () => {
  it('offers all four dimensions and marks the active one', async () => {
    const { controller } = await renderBoard()
    const tabs = dimensionTabs()
    expect(tabs.map(tab => tab.textContent)).toEqual(['周', '月', '季度', '年'])
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(tabs[0]?.hasAttribute('data-active')).toBe(true)

    fireEvent.click(tabs[2]!)
    await waitFor(() => { expect(controller.getSnapshot().selection.period).toBe('quarter') })
    expect(controller.getSnapshot().selection.label).toMatch(/^\d{4}-Q[1-4]$/u)
  })

  it('switches the history chips with the dimension', async () => {
    const { controller } = await renderBoard(seedWeeks({ [weekIdDaysAgo(0)]: ['now'], [weekIdDaysAgo(7)]: ['then'] }))
    // Two weeks hold a memo, so the week dimension offers both.
    expect(historyChips(/^W\d{2}$/u)).toHaveLength(2)

    fireEvent.click(screen.getByRole('tab', { name: '月' }))
    await waitFor(() => { expect(controller.getSnapshot().selection.period).toBe('month') })
    // The chips are re-rendered for the new dimension's own label format.
    expect(historyChips(/^W\d{2}$/u)).toHaveLength(0)
    expect(historyChips(/^\d{4}-\d{2}$/u).length).toBeGreaterThanOrEqual(1)
  })

  it('marks the current period so history and now are distinguishable', async () => {
    const { controller } = await renderBoard()
    const currentLabel = controller.getSnapshot().selection.label
    const chip = screen.getAllByRole('tab').find(tab => tab.textContent === currentLabel.slice(5))
    expect(chip?.hasAttribute('data-current')).toBe(true)
    expect(chip?.getAttribute('aria-selected')).toBe('true')
  })

  it('lists only the cards of the selected history period', async () => {
    const { controller } = await renderBoard(seedWeeks({ [weekIdDaysAgo(0)]: ['this week work'], [weekIdDaysAgo(7)]: ['last week work'] }))
    expect(cards()).toHaveLength(1)
    expect(screen.getByText('this week work')).toBeTruthy()

    const chips = historyChips(/^W\d{2}$/u)
    fireEvent.click(chips[chips.length - 1]!)
    await waitFor(() => { expect(controller.getSnapshot().cards).toHaveLength(1) })
    expect(screen.getByText('last week work')).toBeTruthy()
    expect(screen.queryByText('this week work')).toBeNull()
  })

  it('shows only periods holding a memo, plus the current one', async () => {
    // One memo last week; the other ~398 weeks the host returns are empty and
    // must not become tags.
    const { controller } = await renderBoard(seedWeeks({ [weekIdDaysAgo(7)]: ['last week work'] }))

    expect(historyChips(/^W\d{2}$/u)).toHaveLength(2)
    expect(historyChips(/^W\d{2}$/u).some(chip => chip.hasAttribute('data-current'))).toBe(true)
    expect(controller.getSnapshot().visiblePeriods.length).toBeLessThan(controller.getSnapshot().periods.length)
  })

  it('fetches the host’s full timeline so older years stay reachable', async () => {
    const { rpc } = await renderBoard()
    const call = rpc.calls.find(entry => entry.endpoint === 'memo/listPeriods')
    expect(call?.request.limit).toBe(400)
  })

  it('switches the year and shows that year’s tags and cards', async () => {
    const thisYear = String(new Date().getFullYear())
    const { controller } = await renderBoard(seedWeeks({ [weekIdDaysAgo(0)]: ['now'], [weekIdDaysAgo(400)]: ['then'] }))

    const select = screen.getByRole('combobox', { name: zh.yearFilter })
    const options = Array.from(select.querySelectorAll('option')).map(option => option.value)
    // Years that hold a tag, newest first, with the current year always present.
    expect(options[0]).toBe(thisYear)
    const olderYear = options[options.length - 1]!
    expect(olderYear).not.toBe(thisYear)

    fireEvent.change(select, { target: { value: olderYear } })
    expect(controller.getSnapshot().year).toBe(olderYear)
    await waitFor(() => { expect(controller.getSnapshot().selection.label.slice(0, 4)).toBe(olderYear) })
    // The board moved to that year's period and its memo.
    expect(screen.getByText('then')).toBeTruthy()
    expect(screen.queryByText('now')).toBeNull()
  })

  it('keeps the current year reachable when nothing is stored', async () => {
    await renderBoard()
    const select = screen.getByRole('combobox', { name: zh.yearFilter })
    const options = Array.from(select.querySelectorAll('option')).map(option => option.value)
    expect(options).toEqual([String(new Date().getFullYear())])
  })

  it('keeps every card of a week that holds several', async () => {
    // One week may hold many cards; the board must not collapse them.
    await renderBoard(seedWeek(['memo one', 'memo two', 'memo three']))
    expect(cards()).toHaveLength(3)
  })
})

describe('MemoBoard cards', () => {
  it('lists cards with their content', async () => {
    await renderBoard(seedWeek(['first memo', 'second memo']))
    expect(cards()).toHaveLength(2)
    expect(screen.getByText('first memo')).toBeTruthy()
    expect(screen.getByText('second memo')).toBeTruthy()
  })

  it('shows the empty state when nothing is stored at all', async () => {
    await renderBoard()
    expect(screen.getByText(zh.noEntries)).toBeTruthy()
  })

  it('exposes view, edit, duplicate, and delete on every card', async () => {
    await renderBoard(seedWeek(['memo']))
    const card = cards()[0]!
    for (const label of [zh.viewCard, zh.editEntry, zh.duplicateEntry, zh.deleteEntry]) {
      expect(within(card).getAllByRole('button', { name: label }).length, label).toBeGreaterThan(0)
    }
  })

  it('opens a read-only detail dialog from the card action', async () => {
    const week = isoWeekId(new Date())
    await renderBoard(seedWeek(['detail me']))

    fireEvent.click(within(cards()[0]!).getAllByRole('button', { name: zh.viewCard })[0]!)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('detail me')).toBeTruthy()
    // The week label is shown so a card is always attributable to a period.
    expect(within(dialog).getByText(week.slice(5))).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: zh.close }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the detail dialog when the backdrop is clicked', async () => {
    await renderBoard(seedWeek(['detail me']))
    fireEvent.click(within(cards()[0]!).getAllByRole('button', { name: zh.viewCard })[0]!)
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog.parentElement!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('edits a card through the dialog', async () => {
    const { controller } = await renderBoard(seedWeek(['before']))

    fireEvent.click(within(cards()[0]!).getByRole('button', { name: zh.editEntry }))
    fireEvent.change(screen.getByRole('textbox', { name: zh.editEntry }), { target: { value: 'after' } })
    fireEvent.click(screen.getByRole('button', { name: zh.confirm }))

    await waitFor(() => { expect(controller.getSnapshot().cards[0]?.content).toBe('after') })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cancels an edit without changing the card', async () => {
    const { controller } = await renderBoard(seedWeek(['before']))

    fireEvent.click(within(cards()[0]!).getByRole('button', { name: zh.editEntry }))
    fireEvent.change(screen.getByRole('textbox', { name: zh.editEntry }), { target: { value: 'discarded' } })
    fireEvent.click(screen.getByRole('button', { name: zh.cancel }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(controller.getSnapshot().cards[0]?.content).toBe('before')
  })

  it('duplicates a card into the same period as a distinct card', async () => {
    const week = isoWeekId(new Date())
    const { controller } = await renderBoard(seedWeek(['original']))

    fireEvent.click(within(cards()[0]!).getByRole('button', { name: zh.duplicateEntry }))
    await waitFor(() => { expect(controller.getSnapshot().cards).toHaveLength(2) })

    const stored = controller.getSnapshot().cards
    expect(new Set(stored.map(card => card.id)).size).toBe(2)
    expect(stored.every(card => card.weekId === week)).toBe(true)
    expect(stored.some(card => card.content.includes(zh.copySuffix))).toBe(true)
  })

  it('asks for confirmation before deleting, and deletes on confirm', async () => {
    const { controller } = await renderBoard(seedWeek(['doomed']))

    fireEvent.click(within(cards()[0]!).getByRole('button', { name: zh.deleteEntry }))
    const confirmDialog = screen.getByRole('alertdialog')
    expect(within(confirmDialog).getByText(zh.confirmDeleteText)).toBeTruthy()

    fireEvent.click(within(confirmDialog).getByRole('button', { name: zh.deleteEntry }))
    await waitFor(() => { expect(controller.getSnapshot().cards).toHaveLength(0) })
  })

  it('cancels a delete', async () => {
    const { controller } = await renderBoard(seedWeek(['safe']))

    fireEvent.click(within(cards()[0]!).getByRole('button', { name: zh.deleteEntry }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: zh.cancel }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(controller.getSnapshot().cards).toHaveLength(1)
  })
})

describe('MemoBoard creating cards', () => {
  it('adds a card from the composer', async () => {
    const { controller } = await renderBoard()
    const input = screen.getByRole('textbox', { name: zh.addPlaceholder })
    expect(isDisabled(creatorButton())).toBe(true)

    fireEvent.change(input, { target: { value: 'brand new memo' } })
    expect(isDisabled(creatorButton())).toBe(false)
    fireEvent.click(creatorButton())

    await waitFor(() => { expect(controller.getSnapshot().cards).toHaveLength(1) })
    expect(controller.getSnapshot().cards[0]?.content).toBe('brand new memo')
  })

  it('refuses whitespace-only input', async () => {
    const { controller } = await renderBoard()
    fireEvent.change(screen.getByRole('textbox', { name: zh.addPlaceholder }), { target: { value: '   ' } })
    expect(isDisabled(creatorButton())).toBe(true)
    expect(controller.getSnapshot().cards).toHaveLength(0)
  })
})

describe('MemoBoard analysis and reporting', () => {
  it('analyzes with the default analysis type and shows the result', async () => {
    const { controller, rpc } = await renderBoard()
    fireEvent.click(screen.getByRole('button', { name: zh.analyze }))
    await waitFor(() => { expect(controller.getSnapshot().analysis).not.toBeNull() })
    expect(screen.getByText(zh.analysisResult)).toBeTruthy()
    expect(rpc.calls.find(call => call.endpoint === 'memo/analyze')?.request.analysisType).toBe(zh.organize)
  })

  it('switches the analysis type before analyzing', async () => {
    const { rpc } = await renderBoard()
    const typeGroup = screen.getByRole('group', { name: zh.analyze })
    fireEvent.click(within(typeGroup).getByRole('button', { name: zh.summarize }))
    fireEvent.click(screen.getByRole('button', { name: zh.analyze }))
    await waitFor(() => { expect(rpc.calls.some(call => call.endpoint === 'memo/analyze')).toBe(true) })
    expect(rpc.calls.find(call => call.endpoint === 'memo/analyze')?.request.analysisType).toBe(zh.summarize)
  })

  it('sends no model route with an analysis request', async () => {
    // Regression: the browser used to pin provider "custom", which no
    // deployment registers, turning every analysis into an opaque failure.
    const { rpc } = await renderBoard()
    fireEvent.click(screen.getByRole('button', { name: zh.analyze }))
    await waitFor(() => { expect(rpc.calls.some(call => call.endpoint === 'memo/analyze')).toBe(true) })
    const analyze = rpc.calls.find(call => call.endpoint === 'memo/analyze')
    expect(analyze?.request.provider).toBeUndefined()
    expect(analyze?.request.model).toBeUndefined()
  })

  it('exports a report for the selected period', async () => {
    const { controller } = await renderBoard()
    fireEvent.click(screen.getByRole('button', { name: zh.exportReport }))
    await waitFor(() => { expect(controller.getSnapshot().report).not.toBeNull() })
    expect(screen.getByText(zh.reportResult)).toBeTruthy()
  })

  it('offers a refresh action', async () => {
    const { rpc } = await renderBoard()
    rpc.clearCalls()
    fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
    await waitFor(() => { expect(rpc.calls.some(call => call.endpoint === 'memo/listWeeks')).toBe(true) })
  })

  it('shows the analysis failure reason instead of a generic message', async () => {
    const rpc = createFakeRpc({ failOn: { analyze: { code: 'llm-failure', message: 'NO_ADAPTER: no adapter registered for provider "custom"' } } })
    const controller = new MemoController({ rpc: { call: rpc.call }, storage: fakeStorage() })
    render(React.createElement(MemoBoard, boardProps(controller)))
    await waitFor(() => { expect(controller.getSnapshot().status).toBe('ready') })

    fireEvent.click(screen.getByRole('button', { name: zh.analyze }))
    await waitFor(() => { expect(screen.getByRole('alert')).toBeTruthy() })
    expect(screen.getByRole('alert').textContent).toContain('NO_ADAPTER')
  })

  it('clears the error banner on request', async () => {
    const rpc = createFakeRpc({ failOn: { analyze: { code: 'llm-failure', message: 'boom' } } })
    const controller = new MemoController({ rpc: { call: rpc.call }, storage: fakeStorage() })
    render(React.createElement(MemoBoard, boardProps(controller)))
    await waitFor(() => { expect(controller.getSnapshot().status).toBe('ready') })

    fireEvent.click(screen.getByRole('button', { name: zh.analyze }))
    await waitFor(() => { expect(screen.getByRole('alert')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh.dismiss }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  })
})

describe('MemoBoard quarter archive', () => {
  /** Render one memo in the current week, then archive the current quarter. */
  async function archivedBoard() {
    const rendered = await renderBoard(seedWeek(['archived memo']))
    fireEvent.click(screen.getByRole('tab', { name: '季度' }))
    await waitFor(() => { expect(rendered.controller.getSnapshot().selection.period).toBe('quarter') })
    fireEvent.click(screen.getByRole('button', { name: zh.archiveQuarter }))
    await waitFor(() => { expect(rendered.controller.getSnapshot().archivedQuarters).toHaveLength(1) })
    return rendered
  }

  it('offers the archive action only where a quarter label is unambiguous', async () => {
    await renderBoard(seedWeek(['memo']))
    // On the week dimension there is no single quarter the label could name.
    expect(screen.queryByRole('button', { name: zh.archiveQuarter })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '季度' }))
    await waitFor(() => { expect(screen.getByRole('button', { name: zh.archiveQuarter })).toBeTruthy() })
  })

  it('marks the archived quarter’s cards read-only', async () => {
    await archivedBoard()
    const card = cards()[0]!

    expect(card.hasAttribute('data-archived')).toBe(true)
    expect(within(card).getByText(zh.archivedTag)).toBeTruthy()
    // Editing, duplicating and deleting would all change a closed quarter.
    expect(within(card).queryByRole('button', { name: zh.editEntry })).toBeNull()
    expect(within(card).queryByRole('button', { name: zh.duplicateEntry })).toBeNull()
    expect(within(card).queryByRole('button', { name: zh.deleteEntry })).toBeNull()
    // The edit slot became the way out of the archive; reading still works.
    const foot = card.querySelector('.dsh-memo-cardFoot') as HTMLElement
    // Exactly the two that cannot change the quarter: read it, or reopen it.
    expect(foot.querySelectorAll('button')).toHaveLength(2)
    expect(within(foot).getByRole('button', { name: zh.unarchiveQuarter })).toBeTruthy()
    expect(within(foot).getByRole('button', { name: zh.viewCard })).toBeTruthy()
  })

  it('keeps the same cards read-only in every other dimension', async () => {
    // The acceptance criterion: archiving is a property of the quarter, not of
    // the dimension the user happened to archive from.
    const { controller } = await archivedBoard()
    for (const dimension of ['周', '月', '年']) {
      fireEvent.click(screen.getByRole('tab', { name: dimension }))
      await waitFor(() => { expect(controller.getSnapshot().cards).toHaveLength(1) })
      const card = cards()[0]!
      expect(card.hasAttribute('data-archived')).toBe(true)
      expect(within(card).queryByRole('button', { name: zh.editEntry })).toBeNull()
      expect(within(card).getByRole('button', { name: zh.unarchiveQuarter })).toBeTruthy()
    }
  })

  it('restores editing when the quarter is unarchived', async () => {
    const { controller } = await archivedBoard()
    fireEvent.click(within(cards()[0]!).getByRole('button', { name: zh.unarchiveQuarter }))
    await waitFor(() => { expect(controller.getSnapshot().archivedQuarters).toHaveLength(0) })

    const card = cards()[0]!
    expect(card.hasAttribute('data-archived')).toBe(false)
    expect(within(card).queryByText(zh.archivedTag)).toBeNull()
    expect(within(card).getByRole('button', { name: zh.editEntry })).toBeTruthy()
    expect(within(card).getByRole('button', { name: zh.deleteEntry })).toBeTruthy()
  })

  it('leaves a card outside the archived quarter editable', async () => {
    // 200 days back is always a different quarter, so the archive must not
    // reach it — including when that quarter sits in another year.
    const olderWeek = weekIdDaysAgo(200)
    const { controller } = await renderBoard(seedWeeks({ [weekIdDaysAgo(0)]: ['now'], [olderWeek]: ['earlier'] }))
    fireEvent.click(screen.getByRole('tab', { name: '季度' }))
    await waitFor(() => { expect(controller.getSnapshot().selection.period).toBe('quarter') })
    fireEvent.click(screen.getByRole('button', { name: zh.archiveQuarter }))
    await waitFor(() => { expect(controller.getSnapshot().archivedQuarters).toHaveLength(1) })
    expect(controller.getSnapshot().archivedWeekIds.has(olderWeek)).toBe(false)

    fireEvent.click(screen.getByRole('tab', { name: '周' }))
    await waitFor(() => { expect(controller.getSnapshot().selection.period).toBe('week') })
    const olderYear = olderWeek.slice(0, 4)
    if (controller.getSnapshot().year !== olderYear) {
      fireEvent.change(screen.getByRole('combobox', { name: zh.yearFilter }), { target: { value: olderYear } })
      await waitFor(() => { expect(controller.getSnapshot().year).toBe(olderYear) })
    }
    fireEvent.click(screen.getByRole('tab', { name: `W${olderWeek.slice(6)}` }))
    await waitFor(() => { expect(controller.getSnapshot().selection.label).toBe(olderWeek) })

    expect(screen.getByText('earlier')).toBeTruthy()
    const card = cards()[0]!
    expect(card.hasAttribute('data-archived')).toBe(false)
    expect(within(card).getByRole('button', { name: zh.editEntry })).toBeTruthy()
    expect(within(card).queryByRole('button', { name: zh.unarchiveQuarter })).toBeNull()
  })
})

describe('MemoBoard result cards', () => {
  /** Run the default analysis and return the card it rendered into. */
  async function analysisCard() {
    const rendered = await renderBoard()
    fireEvent.click(screen.getByRole('button', { name: zh.analyze }))
    await waitFor(() => { expect(screen.getByText(zh.analysisResult)).toBeTruthy() })
    const card = screen.getByText(zh.analysisResult).closest('section')
    expect(card).not.toBeNull()
    return { ...rendered, card: card! }
  }

  it('collapses and expands a result card from its own header icon', async () => {
    const { card } = await analysisCard()
    const toggle = within(card).getByRole('button', { name: zh.collapse })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(card.querySelector('.dsh-memo-pre')).not.toBeNull()

    fireEvent.click(toggle)
    expect(card.querySelector('.dsh-memo-pre')).toBeNull()
    // The same affordance now offers to bring the body back.
    const expand = within(card).getByRole('button', { name: zh.expand })
    expect(expand.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(expand)
    expect(card.querySelector('.dsh-memo-pre')).not.toBeNull()
  })

  it('removes a result card from its own close icon', async () => {
    const { card, controller } = await analysisCard()
    fireEvent.click(within(card).getByRole('button', { name: zh.closeResult }))
    await waitFor(() => { expect(controller.getSnapshot().analysis).toBeNull() })
    expect(screen.queryByText(zh.analysisResult)).toBeNull()
  })

  it('removes the report and the log analysis the same way', async () => {
    const { controller } = await renderBoard({
      logAnalysis: { report: issueReport({ title: 'crash', body: 'details', labels: [] }), issueUrl: 'https://example.test/i' },
    })

    fireEvent.click(screen.getByRole('button', { name: zh.exportReport }))
    await waitFor(() => { expect(screen.getByText(zh.reportResult)).toBeTruthy() })
    const reportCard = screen.getByText(zh.reportResult).closest('section')!
    fireEvent.click(within(reportCard).getByRole('button', { name: zh.closeResult }))
    await waitFor(() => { expect(controller.getSnapshot().report).toBeNull() })

    fireEvent.click(screen.getByRole('button', { name: zh.analyzeLogs }))
    await waitFor(() => { expect(screen.getByText(zh.logAnalysisTitle)).toBeTruthy() })
    // The card's own action survives the new header controls.
    expect(screen.getByRole('button', { name: zh.openPrefilledIssue })).toBeTruthy()
    const logCard = screen.getByText(zh.logAnalysisTitle).closest('section')!
    fireEvent.click(within(logCard).getByRole('button', { name: zh.closeResult }))
    await waitFor(() => { expect(controller.getSnapshot().logAnalysis).toBeNull() })
  })

  it('collapses each card independently', async () => {
    await renderBoard()
    fireEvent.click(screen.getByRole('button', { name: zh.analyze }))
    await waitFor(() => { expect(screen.getByText(zh.analysisResult)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh.exportReport }))
    await waitFor(() => { expect(screen.getByText(zh.reportResult)).toBeTruthy() })

    const analysisSection = screen.getByText(zh.analysisResult).closest('section')!
    const reportSection = screen.getByText(zh.reportResult).closest('section')!

    fireEvent.click(within(analysisSection).getByRole('button', { name: zh.collapse }))
    expect(analysisSection.querySelector('.dsh-memo-pre')).toBeNull()
    // Collapsing one card must not touch the other.
    expect(reportSection.querySelector('.dsh-memo-pre')).not.toBeNull()
  })
})

describe('MemoBoard issue editor', () => {
  it('optimizes a description and opens the prefilled issue on the configured repository', async () => {
    const { rpc, controller, openUrl } = await renderBoard({ issueReport: issueReport({ title: 'crash', body: 'details', labels: ['bug'] }) })
    fireEvent.click(screen.getByRole('button', { name: zh.addIssue }))

    fireEvent.change(screen.getByRole('textbox', { name: zh.issuePlaceholder }), { target: { value: 'it crashes' } })
    fireEvent.click(screen.getByRole('button', { name: zh.optimizeIssue }))

    await waitFor(() => { expect(controller.getSnapshot().issueReport?.title).toBe('crash') })

    const open = screen.getByText(zh.openGithub).closest('button')
    expect(isDisabled(open)).toBe(false)
    fireEvent.click(open!)

    await waitFor(() => { expect(openUrl).toHaveBeenCalledOnce() })
    const url = String(openUrl.mock.calls[0]?.[0])
    // The URL comes from the github-issue service, which owns the length limit,
    // so the board must forward its configured repository rather than compose
    // the URL itself.
    const prefillCall = rpc.calls.find(call => call.endpoint === 'githubIssue/prefilledIssueUrl')
    expect(prefillCall?.request.repoUrl).toBe(REPO_URL)
    expect(url.startsWith(`${REPO_URL}/issues/new?`)).toBe(true)
    expect(url).toContain('title=crash')
    expect(url).toContain('labels=bug')
  })

  it('copies the untruncated report body for a body the URL had to shorten', async () => {
    const report = issueReport({ title: 'crash', body: 'x'.repeat(50), labels: ['bug'] })
    const { copyText } = await renderBoard({ issueReport: report })
    fireEvent.click(screen.getByRole('button', { name: zh.addIssue }))
    fireEvent.change(screen.getByRole('textbox', { name: zh.issuePlaceholder }), { target: { value: 'it crashes' } })
    fireEvent.click(screen.getByRole('button', { name: zh.optimizeIssue }))
    await waitFor(() => { expect(screen.getByText(zh.copyIssueBody)).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: zh.copyIssueBody }))
    await waitFor(() => { expect(copyText).toHaveBeenCalledOnce() })
    // The full body, not the URL-shortened one, so a reader can still paste it.
    expect(copyText).toHaveBeenCalledWith(`crash\n\n${'x'.repeat(50)}`)
    await waitFor(() => { expect(screen.getByText(zh.copied)).toBeTruthy() })
  })

  it('refuses to optimize an empty description', async () => {
    const { rpc } = await renderBoard({ issueReport: issueReport() })
    fireEvent.click(screen.getByRole('button', { name: zh.addIssue }))
    expect(isDisabled(screen.getByText(zh.optimizeIssue).closest('button'))).toBe(true)
    expect(rpc.calls.some(call => call.endpoint === 'githubIssue/optimizeIssue')).toBe(false)
  })

  it('clears the issue editor', async () => {
    await renderBoard({ issueReport: issueReport() })
    fireEvent.click(screen.getByRole('button', { name: zh.addIssue }))
    fireEvent.change(screen.getByRole('textbox', { name: zh.issuePlaceholder }), { target: { value: 'draft' } })
    fireEvent.click(screen.getByRole('button', { name: zh.clearIssue }))
    expect(screen.queryByText(zh.issueEditorTitle)).toBeNull()
  })

  it('reports a telemetry log analysis with its prefill URL', async () => {
    const { openUrl } = await renderBoard({
      logAnalysis: { report: issueReport({ title: 'telemetry', body: 'failures' }), issueUrl: 'https://github.test/prefill' },
    })
    fireEvent.click(screen.getByRole('button', { name: zh.analyzeLogs }))
    await waitFor(() => { expect(screen.getByText(zh.logAnalysisTitle)).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: zh.openPrefilledIssue }))
    expect(openUrl).toHaveBeenCalledWith('https://github.test/prefill')
  })
})

describe('MemoBoard initial frame', () => {
  it('renders the loading frame and keeps the header usable', async () => {
    const rpc = createFakeRpc()
    const controller = new MemoController({ rpc: { call: rpc.call }, storage: fakeStorage() })
    render(React.createElement(MemoBoard, boardProps(controller)))
    // The board loads itself on mount; the frame must already be usable.
    expect(screen.getByText(zh.loading)).toBeTruthy()
    // The close affordance is the escape hatch; it must never wait on a load.
    expect(isDisabled(screen.getByRole('button', { name: zh.close }))).toBe(false)
    await waitFor(() => { expect(controller.getSnapshot().status).toBe('ready') })
    expect(screen.queryByText(zh.loading)).toBeNull()
  })
})
