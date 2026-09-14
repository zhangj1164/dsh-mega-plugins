import { describe, expect, it, vi } from 'vitest'
import { MemoController } from '../src/client/controller.ts'
import { createFakeRpc, expectNoModelRouteInRequests, isoWeekId, issueReport } from './fake-rpc.ts'
import type { StorageLike } from '../src/client/logic.ts'

/** In-memory Storage. */
function fakeStorage(seed: Record<string, string> = {}): StorageLike {
  const data = { ...seed }
  return { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value } }
}

/** Build a controller over the fake host. */
async function harness(options: Parameters<typeof createFakeRpc>[0] = {}, storage?: StorageLike) {
  const rpc = createFakeRpc(options)
  const controller = new MemoController({ rpc: wrap(rpc), storage: storage ?? fakeStorage() })
  await controller.refresh()
  return { rpc, controller }
}

/** The controller only needs `call`; wrap it so assertions see the same calls. */
function wrap(rpc: ReturnType<typeof createFakeRpc>) {
  return { call: rpc.call }
}

describe('MemoController loading', () => {
  it('loads weeks, the timeline, and the cards of the current period', async () => {
    const rpc = createFakeRpc({ weeks: { [isoWeekId(new Date())]: { entries: [{ id: 'e1', content: 'hello', createdAt: 5 }] } } })
    const controller = new MemoController({ rpc: wrap(rpc), storage: fakeStorage() })
    await controller.refresh()

    const state = controller.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.totalCards).toBe(1)
    expect(state.cards).toHaveLength(1)
    expect(state.cards[0]?.content).toBe('hello')
    expect(state.selection.period).toBe('week')
    expect(state.selection.label).toBe(isoWeekId(new Date()))
    expect(state.error).toBeNull()
  })

  it('asks the host for the timeline instead of computing periods locally', async () => {
    const { rpc } = await harness()
    const listPeriods = rpc.calls.find(call => call.endpoint === 'memo/listPeriods')
    expect(listPeriods).toBeDefined()
    expect(listPeriods?.request.period).toBe('week')
    expect(typeof listPeriods?.request.limit).toBe('number')
  })

  it('reports a load failure without throwing', async () => {
    const rpc = createFakeRpc({ failWith: { code: 'storage-unavailable', message: 'no storage' } })
    const controller = new MemoController({ rpc: wrap(rpc), storage: fakeStorage() })
    await controller.refresh()

    const state = controller.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('no storage')
  })

  it('surfaces a transport exception as an error state', async () => {
    const rpc = { call: vi.fn(async () => { throw new Error('socket closed') }) }
    const controller = new MemoController({ rpc, storage: fakeStorage() })
    await controller.refresh()
    expect(controller.getSnapshot().error).toBe('socket closed')
  })

  it('restores the last-viewed dimension and label', async () => {
    const label = isoWeekId(new Date())
    const storage = fakeStorage({ 'dsh-memo:period': 'week', 'dsh-memo:label': label })
    const { controller } = await harness({}, storage)
    expect(controller.getSnapshot().selection).toEqual({ period: 'week', label })
  })

  it('loads the dimension it was asked to show instead of the stored one', async () => {
    // Switching dimensions is an explicit action, so it wins over stored
    // state: the stored label belongs to the dimension being left behind.
    const storage = fakeStorage({ 'dsh-memo:period': 'week', 'dsh-memo:label': '2026-W01' })
    const { controller } = await harness({}, storage)
    await controller.selectPeriod('quarter')
    const state = controller.getSnapshot()
    expect(state.selection.period).toBe('quarter')
    expect(state.selection.label).toBe(state.periods[0]?.label)
  })

  it('ignores a stored label that the host does not list', async () => {
    const storage = fakeStorage({ 'dsh-memo:period': 'week', 'dsh-memo:label': '1999-W01' })
    const { controller } = await harness({}, storage)
    expect(controller.getSnapshot().selection.label).toBe(isoWeekId(new Date()))
  })
})

describe('MemoController four-dimension navigation', () => {
  it('switches dimension and keeps the cards consistent with the timeline', async () => {
    const { controller } = await harness()
    const seen: string[] = []
    controller.subscribe(() => { seen.push(controller.getSnapshot().selection.period) })

    await controller.selectPeriod('month')
    expect(controller.getSnapshot().selection.period).toBe('month')

    await controller.selectPeriod('quarter')
    expect(controller.getSnapshot().selection.period).toBe('quarter')

    await controller.selectPeriod('year')
    const state = controller.getSnapshot()
    expect(state.selection.period).toBe('year')
    expect(state.periods[0]?.period).toBe('year')
    expect(seen).toContain('month')
  })

  it('does not reload when the dimension is unchanged', async () => {
    const { rpc, controller } = await harness()
    rpc.clearCalls()
    await controller.selectPeriod('week')
    expect(rpc.calls).toHaveLength(0)
  })

  it('shows only the cards whose week belongs to the selected period', async () => {
    const rpc = createFakeRpc({
      weeks: {
        '2026-W01': { entries: [{ id: 'jan', content: 'january work', createdAt: 1 }] },
        '2026-W37': { entries: [{ id: 'sep', content: 'september work', createdAt: 2 }] },
      },
    })
    const controller = new MemoController({ rpc: wrap(rpc), storage: fakeStorage() })
    await controller.refresh()

    const year = controller.getSnapshot().selection.label // current week label
    const yearLabel = year.slice(0, 4)
    await controller.selectPeriod('year')
    await controller.selectLabel(yearLabel)
    // Both January and September belong to the year; a week selection would
    // have shown only one of them.
    expect(controller.getSnapshot().cards.map(card => card.content).sort()).toEqual(['january work', 'september work'])
  })

  it('selecting a label narrows the board to that period and clears stale results', async () => {
    const { controller } = await harness()
    await controller.analyze('分析')
    expect(controller.getSnapshot().analysis).not.toBeNull()

    const other = controller.getSnapshot().periods[1]
    expect(other).toBeDefined()
    if (other === undefined) return
    await controller.selectLabel(other.label)

    const state = controller.getSnapshot()
    expect(state.selection.label).toBe(other.label)
    expect(state.analysis).toBeNull()
  })

  it('ignores a label identical to the current one', async () => {
    const { controller } = await harness()
    const before = controller.getSnapshot().selection.label
    const listener = vi.fn()
    controller.subscribe(listener)
    await controller.selectLabel(before)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('MemoController card mutations', () => {
  it('adds a card to the current week and refreshes', async () => {
    const { rpc, controller } = await harness()
    const ok = await controller.addCard('  new memo  ')
    expect(ok).toBe(true)
    expect(controller.getSnapshot().cards.map(card => card.content)).toContain('new memo')

    const add = rpc.calls.find(call => call.endpoint === 'memo/addEntry')
    expect(add?.request.weekId).toBe(isoWeekId(new Date()))
    expect(add?.request.type).toBe('text')
    expect(add?.request.content).toBe('new memo')
  })

  it('refuses an empty card', async () => {
    const { rpc, controller } = await harness()
    rpc.clearCalls()
    expect(await controller.addCard('   ')).toBe(false)
    expect(rpc.calls).toHaveLength(0)
  })

  it('adds a card to the selected past period rather than the current week', async () => {
    const { rpc, controller } = await harness()
    await controller.selectPeriod('month')
    const past = controller.getSnapshot().periods[2]
    expect(past).toBeDefined()
    if (past === undefined) return
    await controller.selectLabel(past.label)
    rpc.clearCalls()

    expect(await controller.addCard('backdated')).toBe(true)
    const add = rpc.calls.find(call => call.endpoint === 'memo/addEntry')
    expect(past.weekIds).toContain(String(add?.request.weekId))
  })

  it('updates a card in place', async () => {
    const { rpc, controller } = await harness()
    await controller.addCard('before')
    const card = controller.getSnapshot().cards[0]
    expect(card).toBeDefined()
    if (card === undefined) return

    expect(await controller.updateCard(card, 'after')).toBe(true)
    expect(controller.getSnapshot().cards[0]?.content).toBe('after')

    const update = rpc.calls.find(call => call.endpoint === 'memo/updateEntry')
    expect(update?.request.entryId).toBe(card.id)
    expect(update?.request.force).toBe(true)
  })

  it('deletes a card', async () => {
    const { rpc, controller } = await harness()
    await controller.addCard('doomed')
    const card = controller.getSnapshot().cards[0]
    expect(card).toBeDefined()
    if (card === undefined) return

    expect(await controller.deleteCard(card)).toBe(true)
    expect(controller.getSnapshot().cards).toHaveLength(0)
    expect(rpc.calls.some(call => call.endpoint === 'memo/deleteEntry')).toBe(true)
  })

  it('duplicates a card within the same period and marks the copy', async () => {
    const { controller } = await harness()
    await controller.addCard('original')
    const card = controller.getSnapshot().cards[0]
    expect(card).toBeDefined()
    if (card === undefined) return

    expect(await controller.duplicateCard(card, '(copy)')).toBe(true)
    const contents = controller.getSnapshot().cards.map(item => item.content)
    expect(contents).toHaveLength(2)
    expect(contents).toContain('original')
    expect(contents.some(content => content.includes('(copy)'))).toBe(true)
    // A copy is a distinct card, not an alias of the original.
    const ids = controller.getSnapshot().cards.map(item => item.id)
    expect(new Set(ids).size).toBe(2)
    expect(controller.getSnapshot().cards.every(item => item.weekId === card.weekId)).toBe(true)
  })

  it('reports a mutation failure and keeps the previous cards', async () => {
    const rpc = createFakeRpc({ failOn: { addEntry: { code: 'storage-error', message: 'disk full' } } })
    const controller = new MemoController({ rpc: wrap(rpc), storage: fakeStorage() })
    await controller.refresh()
    expect(await controller.addCard('nope')).toBe(false)
    expect(controller.getSnapshot().error).toBe('disk full')
  })
})

describe('MemoController analysis, export, and issues', () => {
  it('analyzes the selected period and exposes the summary', async () => {
    const { rpc, controller } = await harness()
    await controller.selectPeriod('quarter')
    await controller.analyze('总结')

    expect(controller.getSnapshot().analysis).toBe('analysis:总结')
    const analyze = rpc.calls.find(call => call.endpoint === 'memo/analyze')
    expect(analyze?.request.period).toBe('quarter')
    expect(analyze?.request.analysisType).toBe('总结')
    expect(analyze?.request.periodLabel).toBe(controller.getSnapshot().selection.label)
  })

  it('reports an analysis failure', async () => {
    const rpc = createFakeRpc({ failOn: { analyze: { code: 'llm-failure', message: 'NO_ADAPTER' } } })
    const controller = new MemoController({ rpc: wrap(rpc), storage: fakeStorage() })
    await controller.refresh()
    await controller.analyze('分析')
    expect(controller.getSnapshot().error).toBe('NO_ADAPTER')
    expect(controller.getSnapshot().analysis).toBeNull()
  })

  it('exports a report for the selected period', async () => {
    const { rpc, controller } = await harness()
    const report = await controller.exportReport()
    expect(typeof report).toBe('string')
    expect(report).toContain(controller.getSnapshot().selection.label)
    expect(rpc.calls.some(call => call.endpoint === 'memo/exportReport')).toBe(true)
  })

  it('reports an export failure', async () => {
    const rpc = createFakeRpc({ failOn: { exportReport: { code: 'no-entries', message: 'period is empty' } } })
    const controller = new MemoController({ rpc: wrap(rpc), storage: fakeStorage() })
    await controller.refresh()
    expect(await controller.exportReport()).toBeUndefined()
    expect(controller.getSnapshot().error).toBe('period is empty')
  })

  it('optimizes an issue description through the githubIssue service', async () => {
    const { rpc, controller } = await harness({ issueReport: issueReport() })
    await controller.optimizeIssue('  the analyze button crashes  ')
    expect(controller.getSnapshot().issueReport?.title).toBe('crash on analyze')
    const call = rpc.calls.find(entry => entry.endpoint === 'githubIssue/optimizeIssue')
    expect(call?.request.description).toBe('the analyze button crashes')
  })

  it('ignores an empty issue description', async () => {
    const { rpc, controller } = await harness({ issueReport: issueReport() })
    rpc.clearCalls()
    await controller.optimizeIssue('   ')
    expect(rpc.calls).toHaveLength(0)
  })

  it('collects the log-analysis report and its prefill URL', async () => {
    const { controller } = await harness({
      logAnalysis: { report: issueReport({ title: 'telemetry report' }), issueUrl: 'https://example.test/issues/new' },
    })
    await controller.analyzeLogs()
    expect(controller.getSnapshot().logAnalysis?.issueUrl).toBe('https://example.test/issues/new')
  })

  it('reports when there are no recorded failures', async () => {
    const { controller } = await harness()
    await controller.analyzeLogs()
    expect(controller.getSnapshot().error).toBe('no failures recorded')
    expect(controller.getSnapshot().logAnalysis).toBeNull()
  })

  it('clears the last error on request', async () => {
    const { controller } = await harness()
    await controller.analyzeLogs()
    expect(controller.getSnapshot().error).not.toBeNull()
    controller.clearError()
    expect(controller.getSnapshot().error).toBeNull()
  })
})

describe('MemoController publishes no model route', () => {
  it('never sends provider or model on any request', async () => {
    // The original defect: the browser hardcoded provider "custom", which no
    // deployment registers, so every AI call failed with NO_ADAPTER and was
    // reported as "the model produced no output".
    const { rpc, controller } = await harness({ issueReport: issueReport() })
    await controller.addCard('work')
    await controller.analyze('梳理')
    await controller.exportReport()
    await controller.analyzeLogs()
    await controller.optimizeIssue('something broke')
    expectNoModelRouteInRequests(rpc.calls)
  })
})

describe('MemoController lifecycle', () => {
  it('stops notifying subscribers after dispose', async () => {
    const { controller } = await harness()
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.dispose()
    await controller.addCard('after dispose')
    expect(listener).not.toHaveBeenCalled()
  })

  it('publishes an immutable snapshot reference that changes only on update', async () => {
    const { controller } = await harness()
    const first = controller.getSnapshot()
    await controller.selectLabel(controller.getSnapshot().periods[1]?.label ?? '')
    expect(controller.getSnapshot()).not.toBe(first)
  })
})
