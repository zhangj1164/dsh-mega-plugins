import { afterEach, describe, expect, it } from 'vitest'
import { memoWeekSchema } from '../src/spec.ts'
import type { TestHarness } from './harness.ts'
import { setupHarness, TEST_ROUTE } from './harness.ts'

const harnesses: TestHarness[] = []

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(h => h.dispose()))
})

async function harness(options: Parameters<typeof setupHarness>[0] = {}): Promise<TestHarness> {
  const h = await setupHarness(options)
  harnesses.push(h)
  return h
}

/** Wait for fire-and-forget KV writes to settle. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 200))
}

/** Compute the current ISO week id in YYYY-Www format (Monday start). */
function currentWeekId(): string {
  const now = new Date()
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const dayNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const weekNum = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

describe('MemoService week lifecycle', () => {
  it('getOrCreateCurrentWeek creates and returns the current week', async () => {
    const { ctx } = await harness()
    const result = await ctx.memo.getOrCreateCurrentWeek({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.weekId).toBe(currentWeekId())
    expect(result.value.entries).toEqual([])
  })

  it('getOrCreateCurrentWeek returns the same week on second call', async () => {
    const { ctx } = await harness()
    const first = await ctx.memo.getOrCreateCurrentWeek({})
    const second = await ctx.memo.getOrCreateCurrentWeek({})
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.value.weekId).toBe(first.value.weekId)
  })

  it('getWeek returns a week by id', async () => {
    const { ctx } = await harness()
    const created = await ctx.memo.getOrCreateCurrentWeek({})
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const result = ctx.memo.getWeek({ weekId: created.value.weekId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).not.toBeNull()
    if (result.value === null) return
    expect(result.value.weekId).toBe(created.value.weekId)
  })

  it('getWeek returns null for an unknown week', async () => {
    const { ctx } = await harness()
    const result = ctx.memo.getWeek({ weekId: '2099-W01' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBeNull()
  })

  it('listWeeks returns at least one week after creation', async () => {
    const { ctx } = await harness()
    await ctx.memo.getOrCreateCurrentWeek({})
    const result = ctx.memo.listWeeks({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.length).toBeGreaterThanOrEqual(1)
  })
})

describe('MemoService entry CRUD', () => {
  it('addEntry adds to the current week', async () => {
    const { ctx } = await harness()
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    expect(week.ok).toBe(true)
    if (!week.ok) return
    const result = await ctx.memo.addEntry({
      weekId: week.value.weekId,
      type: 'text',
      content: 'test entry',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.type).toBe('text')
    expect(result.value.content).toBe('test entry')
    expect(result.value.id).toBeTruthy()
  })

  it('addEntry on a week with no stored row writes bounds the schema accepts', async () => {
    const { ctx } = await harness()
    // A week id nothing has created yet. An earlier revision stored
    // `weekStart: 0, weekEnd: 0` here, which the week schema rejects; because
    // the storage domain validates every record on open, that single row then
    // stopped the plugin from booting at all.
    const result = await ctx.memo.addEntry({ weekId: '1999-W07', type: 'text', content: 'back-filled' })
    expect(result.ok).toBe(true)

    const week = await ctx.memo.getWeek({ weekId: '1999-W07' })
    expect(week.ok).toBe(true)
    if (!week.ok || week.value === null) throw new Error('expected the back-filled week to exist')
    expect(week.value.weekEnd).toBeGreaterThan(week.value.weekStart)
    // 1999-W07 runs Monday 1999-02-15 through Sunday 1999-02-21.
    const start = new Date(week.value.weekStart)
    const end = new Date(week.value.weekEnd)
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([1999, 1, 15])
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([1999, 1, 21])
    expect(() => memoWeekSchema.parse(week.value)).not.toThrow()
  })

  it('addEntry rejects a week id that is not an ISO week id', async () => {
    const { ctx } = await harness()
    const result = await ctx.memo.addEntry({ weekId: 'not-a-week', type: 'text', content: 'nope' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid-week-id')
    // Nothing may be stored under a rejected id, or the schema would see it on
    // the next open.
    const week = await ctx.memo.getWeek({ weekId: 'not-a-week' })
    expect(week.ok).toBe(true)
    if (week.ok) expect(week.value).toBeNull()
  })

  it('the week schema rejects the zero-bounds row an earlier revision wrote', () => {
    // Pins the exact defect, so the shape cannot come back unnoticed.
    expect(() => memoWeekSchema.parse({
      weekId: '1999-W07',
      weekStart: 0,
      weekEnd: 0,
      entries: [],
      updatedAt: 0,
    })).toThrow(/weekEnd must follow weekStart/u)
  })

  it('updateEntry updates content', async () => {
    const { ctx } = await harness()
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    const added = await ctx.memo.addEntry({
      weekId: week.value.weekId,
      type: 'text',
      content: 'original',
    })
    if (!added.ok) return
    const result = await ctx.memo.updateEntry({
      weekId: week.value.weekId,
      entryId: added.value.id,
      content: 'updated content',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.content).toBe('updated content')
  })

  it('updateEntry on a past week requires force', async () => {
    const { ctx } = await harness()
    const result = await ctx.memo.updateEntry({
      weekId: '2020-W01',
      entryId: 'nonexistent',
      content: 'test',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('week-not-found')
  })

  it('updateEntry on a past week with force fails with week-not-found', async () => {
    const { ctx } = await harness()
    const result = await ctx.memo.updateEntry({
      weekId: '2020-W01',
      entryId: 'nonexistent',
      content: 'test',
      force: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('week-not-found')
  })

  it('deleteEntry removes an entry', async () => {
    const { ctx } = await harness()
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    const added = await ctx.memo.addEntry({
      weekId: week.value.weekId,
      type: 'text',
      content: 'to be deleted',
    })
    if (!added.ok) return
    const delResult = await ctx.memo.deleteEntry({
      weekId: week.value.weekId,
      entryId: added.value.id,
    })
    expect(delResult.ok).toBe(true)
    const getResult = ctx.memo.getWeek({ weekId: week.value.weekId })
    expect(getResult.ok).toBe(true)
    if (!getResult.ok || getResult.value === null) return
    expect(getResult.value.entries.find(e => e.id === added.value.id)).toBeUndefined()
  })
})

describe('MemoService analysis and export', () => {
  it('analyze returns analysis text from the model', async () => {
    const { ctx } = await harness()
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    await ctx.memo.addEntry({
      weekId: week.value.weekId,
      type: 'text',
      content: 'did some work',
    })
    await settle()
    const result = await ctx.memo.analyze({
      period: 'week',
      periodLabel: week.value.weekId,
      analysisType: '\u68b3\u7406',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.summary).toBeTruthy()
    expect(result.value.period).toBe('week')
    expect(result.value.periodLabel).toBe(week.value.weekId)
  })

  it('analyze fails with no-entries when the week has no entries', async () => {
    const { ctx } = await harness()
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    const result = await ctx.memo.analyze({
      period: 'week',
      periodLabel: week.value.weekId,
      analysisType: '\u603b\u7ed3',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('no-entries')
  })

  it('exportReport returns a markdown report', async () => {
    const { ctx } = await harness()
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    await ctx.memo.addEntry({
      weekId: week.value.weekId,
      type: 'text',
      content: 'important work',
    })
    await settle()
    const result = await ctx.memo.exportReport({
      period: 'week',
      periodLabel: week.value.weekId,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBeTruthy()
    expect(typeof result.value).toBe('string')
  })
})

describe('MemoService log analysis', () => {
  const analysis = {
    totalEvents: 458,
    totalFailures: 5,
    window: { firstEventAt: Date.parse('2026-09-01T07:22:00Z'), lastEventAt: Date.parse('2026-09-15T08:19:00Z') },
    failureGroups: [{
      featureCodeRef: 'memo:analyze',
      count: 3,
      errorCodes: ['LLM_FAILURE'],
      latest: {
        timestamp: Date.parse('2026-09-11T03:04:00Z'),
        error: { code: 'LLM_FAILURE', message: 'model produced no output' },
      },
      attemptsAfterLastFailure: 14,
      route: { provider: 'deepseek-cu', model: 'deepseek-flash', status: 429 },
    }],
  }

  it('forwards the analysis window, route, and timing to the report', async () => {
    const { ctx, githubIssue } = await harness({ analysis })

    const result = await ctx.memo.analyzeLogs({})
    expect(result.ok).toBe(true)

    const request = githubIssue.reportRequests[0]!
    expect(request.pluginId).toBe('memo')
    expect(request.window).toEqual({ firstEventAt: Date.parse('2026-09-01T07:22:00Z'), lastEventAt: Date.parse('2026-09-15T08:19:00Z') })
    const group = (request.failureGroups as Record<string, unknown>[])[0]!
    expect(group.featureCodeRef).toBe('memo:analyze')
    expect(group.errorCode).toBe('LLM_FAILURE')
    expect(group.errorMessage).toBe('model produced no output')
    expect(group.lastFailureAt).toBe(Date.parse('2026-09-11T03:04:00Z'))
    expect(group.attemptsAfterLastFailure).toBe(14)
    expect(group.route).toEqual({ provider: 'deepseek-cu', model: 'deepseek-flash', status: 429 })
  })

  it('exposes the same facts to the caller, not only to the report', async () => {
    const { ctx } = await harness({ analysis })

    const result = await ctx.memo.analyzeLogs({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.analysis.window).toEqual(analysis.window)
    expect(result.value.analysis.failureGroups[0]).toEqual({
      featureCodeRef: 'memo:analyze',
      count: 3,
      errorCodes: ['LLM_FAILURE'],
      lastFailureAt: Date.parse('2026-09-11T03:04:00Z'),
      attemptsAfterLastFailure: 14,
      route: { provider: 'deepseek-cu', model: 'deepseek-flash', status: 429 },
    })
  })

  it('omits facts the analysis did not carry instead of sending empty ones', async () => {
    // The shape of failures recorded before the route metadata existed: a group
    // with an event but no recorded route, and a plugin with no events at all.
    const lastFailureAt = Date.parse('2026-09-11T03:04:00Z')
    const { ctx, githubIssue } = await harness({
      analysis: {
        totalEvents: 5,
        totalFailures: 1,
        failureGroups: [{
          featureCodeRef: 'memo:analyze',
          count: 1,
          latest: { timestamp: lastFailureAt, error: { code: 'LLM_FAILURE', message: 'no output' } },
          attemptsAfterLastFailure: 0,
        }],
      },
    })

    const result = await ctx.memo.analyzeLogs({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.analysis.window).toBeUndefined()
    expect(result.value.analysis.failureGroups[0]!.route).toBeUndefined()

    const request = githubIssue.reportRequests[0]!
    // Absent, not `undefined`: a key carrying nothing would read as a recorded
    // fact once it crosses the report boundary.
    expect('window' in request).toBe(false)
    const group = (request.failureGroups as Record<string, unknown>[])[0]!
    expect('route' in group).toBe(false)
    // The event itself is always there, so this one cannot be absent.
    expect(group.lastFailureAt).toBe(lastFailureAt)
  })
})

describe('MemoService model-route resolution and LLM failure reporting', () => {
  it('resolves the route from Config instead of requiring a caller-supplied value', async () => {
    const { ctx } = await harness()
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    await ctx.memo.addEntry({ weekId: week.value.weekId, type: 'text', content: 'work' })
    await settle()

    const result = await ctx.memo.analyze({ period: 'week', periodLabel: week.value.weekId, analysisType: '\u68b3\u7406' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.modelProvider).toBe(TEST_ROUTE.provider)
    expect(result.value.modelName).toBe(TEST_ROUTE.model)
  })

  it('reports NO_ADAPTER with the attempted provider when the route is unregistered', async () => {
    // Config pins the exact provider that used to be hardcoded in the UI
    // controller: unregistered, and previously reported as "the model produced
    // no output" with no way to tell why.
    const { ctx } = await harness({ config: { provider: 'custom', model: 'glm-5-2-260617' } })
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    await ctx.memo.addEntry({ weekId: week.value.weekId, type: 'text', content: 'work' })
    await settle()

    const result = await ctx.memo.analyze({ period: 'week', periodLabel: week.value.weekId, analysisType: '\u5206\u6790' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('llm-failure')
    if (result.error.code !== 'llm-failure') return
    expect(result.error.failureCode).toBe('NO_ADAPTER')
    expect(result.error.provider).toBe('custom')
    expect(result.error.model).toBe('glm-5-2-260617')
    expect(result.error.message).toContain('NO_ADAPTER')
    expect(result.error.message).toContain('custom')
  })

  it('reports the preserved failure code for a non-routing terminal failure', async () => {
    const { ctx } = await harness({
      llm: {
        behaviour: 'route-error',
        failure: { code: 'MISSING_CREDENTIAL', message: 'no API key for this provider', status: 401 },
      },
    })
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    await ctx.memo.addEntry({ weekId: week.value.weekId, type: 'text', content: 'work' })
    await settle()

    const result = await ctx.memo.analyze({ period: 'week', periodLabel: week.value.weekId, analysisType: '\u603b\u7ed3' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('llm-failure')
    if (result.error.code !== 'llm-failure') return
    expect(result.error.failureCode).toBe('MISSING_CREDENTIAL')
    expect(result.error.status).toBe(401)
  })

  it('reports EMPTY_RESPONSE when the model succeeds with no text', async () => {
    const { ctx } = await harness({ llm: { behaviour: 'empty' } })
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    await ctx.memo.addEntry({ weekId: week.value.weekId, type: 'text', content: 'work' })
    await settle()

    const result = await ctx.memo.analyze({ period: 'week', periodLabel: week.value.weekId, analysisType: '\u603b\u7ed3' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('llm-failure')
    if (result.error.code !== 'llm-failure') return
    expect(result.error.failureCode).toBe('EMPTY_RESPONSE')
  })

  it('lets an explicit request route override the configured route', async () => {
    const { ctx } = await harness({ config: { provider: 'unregistered', model: 'unregistered' } })
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    await ctx.memo.addEntry({ weekId: week.value.weekId, type: 'text', content: 'work' })
    await settle()

    const result = await ctx.memo.analyze({
      period: 'week',
      periodLabel: week.value.weekId,
      analysisType: '\u603b\u7ed3',
      provider: TEST_ROUTE.provider,
      model: TEST_ROUTE.model,
    })
    expect(result.ok).toBe(true)
  })

  it('exportReport preserves the failure code instead of a generic message', async () => {
    const { ctx } = await harness({ config: { provider: 'nope', model: 'nope' } })
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    await ctx.memo.addEntry({ weekId: week.value.weekId, type: 'text', content: 'work' })
    await settle()

    const result = await ctx.memo.exportReport({ period: 'week', periodLabel: week.value.weekId })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('llm-failure')
    if (result.error.code !== 'llm-failure') return
    expect(result.error.failureCode).toBe('NO_ADAPTER')
  })
})

describe('MemoService four-dimension timeline', () => {
  it('reports the stored week as belonging to the current period in all four dimensions', async () => {
    const { ctx } = await harness()
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    await ctx.memo.addEntry({ weekId: week.value.weekId, type: 'text', content: 'work' })
    await settle()

    for (const period of ['week', 'month', 'quarter', 'year'] as const) {
      const listed = ctx.memo.listPeriods({ period })
      expect(listed.ok, period).toBe(true)
      if (!listed.ok) continue
      const current = listed.value.find(entry => entry.current)
      expect(current, period).toBeDefined()
      if (current === undefined) continue
      expect(current.period, period).toBe(period)
      expect(current.weekIds, period).toContain(week.value.weekId)
      // The stored week must be visible from every dimension, which is the
      // whole point of the timeline: a card added in the week view is
      // reachable from month, quarter, and year without being re-added.
      expect(current.weekCount, period).toBeGreaterThanOrEqual(1)
      expect(current.start, period).toBeLessThanOrEqual(current.end)
    }
  })

  it('lists periods newest first with stable labels and no duplicates', async () => {
    const { ctx } = await harness()
    await ctx.memo.getOrCreateCurrentWeek({})
    await settle()

    for (const period of ['week', 'month', 'quarter', 'year'] as const) {
      const listed = ctx.memo.listPeriods({ period, limit: 8 })
      expect(listed.ok, period).toBe(true)
      if (!listed.ok) continue
      expect(listed.value.length, period).toBe(8)
      const labels = listed.value.map(entry => entry.label)
      expect(new Set(labels).size, period).toBe(labels.length)
      for (let index = 1; index < listed.value.length; index += 1) {
        const previous = listed.value[index - 1]
        const entry = listed.value[index]
        if (previous === undefined || entry === undefined) continue
        expect(entry.start, `${period} newest first`).toBeLessThan(previous.start)
      }
    }
  })

  it('returns empty periods as valid targets for a first card', async () => {
    const { ctx } = await harness()
    await ctx.memo.getOrCreateCurrentWeek({})
    await settle()

    // Far enough back that nothing can be stored there.
    const listed = ctx.memo.listPeriods({ period: 'month', limit: 40 })
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    const empty = listed.value.filter(entry => entry.weekCount === 0)
    expect(empty.length).toBeGreaterThan(0)
    for (const entry of empty) {
      expect(entry.weekIds.length).toBeGreaterThan(0)
      expect(entry.current).toBe(false)
    }
  })
})

describe('MemoService quarter archive', () => {
  it('archives the quarter containing the viewed period and resolves its weeks', async () => {
    const { ctx } = await harness()
    const listed = ctx.memo.listPeriods({ period: 'quarter', limit: 4 })
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    const quarter = listed.value[1]!
    expect(quarter.current).toBe(false)

    const archived = await ctx.memo.archiveQuarter({ label: quarter.label })
    expect(archived.ok).toBe(true)
    if (!archived.ok) return

    expect(archived.value.label).toBe(quarter.label)
    // The host resolves the weeks, so a client never has to.
    expect(archived.value.weekIds).toEqual(quarter.weekIds)
    expect(archived.value.weekIds.length).toBeGreaterThan(0)
    expect(archived.value.archivedAt).toBeGreaterThan(0)
  })

  it('lists what is archived and drops it again on unarchive', async () => {
    const { ctx } = await harness()
    const listed = ctx.memo.listPeriods({ period: 'quarter', limit: 4 })
    if (!listed.ok) return
    const first = listed.value[0]!
    const second = listed.value[1]!

    await ctx.memo.archiveQuarter({ label: first.label })
    await ctx.memo.archiveQuarter({ label: second.label })
    const both = ctx.memo.listArchivedQuarters()
    expect(both.ok).toBe(true)
    if (!both.ok) return
    // Oldest first, so the order does not depend on write order.
    expect(both.value.map(entry => entry.label)).toEqual([second.label, first.label].sort())

    const removed = await ctx.memo.unarchiveQuarter({ label: first.label })
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.value).toEqual({ label: first.label, archived: true })

    const left = ctx.memo.listArchivedQuarters()
    if (!left.ok) return
    expect(left.value.map(entry => entry.label)).toEqual([second.label])

    // Unarchiving something already gone reports the no-op rather than failing.
    const again = await ctx.memo.unarchiveQuarter({ label: first.label })
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.value.archived).toBe(false)
  })

  it('archives exactly the quarter named, never a neighbour', async () => {
    // Regression: resolving "the quarter containing the viewed period" from the
    // period's start timestamp picks the wrong quarter for a year (four
    // quarters) and for a week whose Monday sits in the previous quarter. The
    // request therefore names a quarter, and this pins that the neighbours stay
    // untouched.
    const { ctx } = await harness()
    const listed = ctx.memo.listPeriods({ period: 'quarter', limit: 6 })
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    const target = listed.value[2]!
    const previous = listed.value[3]!
    const next = listed.value[1]!

    const archived = await ctx.memo.archiveQuarter({ label: target.label })
    expect(archived.ok).toBe(true)
    if (!archived.ok) return
    expect(archived.value.label).toBe(target.label)
    expect(archived.value.weekIds).toEqual(target.weekIds)

    const stored = ctx.memo.listArchivedQuarters()
    if (!stored.ok) return
    expect(stored.value.map(entry => entry.label)).toEqual([target.label])
    expect(stored.value.map(entry => entry.label)).not.toContain(previous.label)
    expect(stored.value.map(entry => entry.label)).not.toContain(next.label)

    // Archiving the same quarter twice is idempotent, not a duplicate row.
    await ctx.memo.archiveQuarter({ label: target.label })
    const again = ctx.memo.listArchivedQuarters()
    if (!again.ok) return
    expect(again.value).toHaveLength(1)
  })

  it('rejects anything that is not a quarter label and writes nothing', async () => {
    const { ctx } = await harness()
    for (const label of ['2026-W37', '2026-09', '2026', 'not-a-quarter', '']) {
      const bad = await ctx.memo.archiveQuarter({ label })
      expect(bad.ok).toBe(false)
      if (bad.ok) return
      expect(bad.error.code).toBe('invalid-quarter-label')
    }

    const stored = ctx.memo.listArchivedQuarters()
    expect(stored.ok).toBe(true)
    if (!stored.ok) return
    expect(stored.value).toHaveLength(0)
  })
})

describe('MemoService archived-quarter write guard', () => {
  it('refuses add, update and delete inside an archived quarter, and changes nothing', async () => {
    // Read-only has to be the host's rule, not the browser's: the same Remote
    // methods are reachable by any client, and an archive can land while an edit
    // dialog is already open.
    const { ctx } = await harness()
    const listed = ctx.memo.listPeriods({ period: 'quarter', limit: 4 })
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    const quarter = listed.value[1]!
    const weekId = quarter.weekIds[0]!

    const seeded = await ctx.memo.addEntry({ weekId, type: 'text', content: 'before archive' })
    expect(seeded.ok).toBe(true)
    if (!seeded.ok) return

    const archived = await ctx.memo.archiveQuarter({ label: quarter.label })
    expect(archived.ok).toBe(true)
    if (!archived.ok) return

    const refusedAdd = await ctx.memo.addEntry({ weekId, type: 'text', content: 'after archive' })
    expect(refusedAdd.ok).toBe(false)
    if (refusedAdd.ok) return
    expect(refusedAdd.error.code).toBe('quarter-archived')
    expect(refusedAdd.error.weekId).toBe(weekId)

    const refusedUpdate = await ctx.memo.updateEntry({
      weekId, entryId: seeded.value.id, content: 'edited', force: true,
    })
    expect(refusedUpdate.ok).toBe(false)
    if (refusedUpdate.ok) return
    expect(refusedUpdate.error.code).toBe('quarter-archived')

    const refusedDelete = await ctx.memo.deleteEntry({ weekId, entryId: seeded.value.id, force: true })
    expect(refusedDelete.ok).toBe(false)
    if (refusedDelete.ok) return
    expect(refusedDelete.error.code).toBe('quarter-archived')

    // A refused call wrote nothing at all.
    const week = ctx.memo.getWeek({ weekId })
    expect(week.ok).toBe(true)
    if (!week.ok) return
    expect(week.value.entries.map(entry => entry.content)).toEqual(['before archive'])

    // Unarchiving is the only way back to writable, and it does restore it.
    await ctx.memo.unarchiveQuarter({ label: quarter.label })
    const allowed = await ctx.memo.updateEntry({
      weekId, entryId: seeded.value.id, content: 'edited', force: true,
    })
    expect(allowed.ok).toBe(true)
  })

  it('refuses a write in every week the archived quarter owns', async () => {
    // The quarter's ownership is decided by the Thursday rule, so a week whose
    // Monday falls in the previous quarter must still be closed.
    const { ctx } = await harness()
    const listed = ctx.memo.listPeriods({ period: 'quarter', limit: 4 })
    if (!listed.ok) return
    const quarter = listed.value[1]!
    await ctx.memo.archiveQuarter({ label: quarter.label })

    for (const weekId of quarter.weekIds) {
      const refused = await ctx.memo.addEntry({ weekId, type: 'text', content: 'nope' })
      expect(refused.ok).toBe(false)
      if (refused.ok) return
      expect(refused.error.code).toBe('quarter-archived')
    }
  })

  it('leaves weeks outside every archived quarter writable', async () => {
    const { ctx } = await harness()
    const listed = ctx.memo.listPeriods({ period: 'quarter', limit: 4 })
    if (!listed.ok) return
    const current = listed.value[0]!
    const older = listed.value[1]!
    expect(current.current).toBe(true)

    await ctx.memo.archiveQuarter({ label: older.label })

    const today = await ctx.memo.getOrCreateCurrentWeek({})
    expect(today.ok).toBe(true)
    if (!today.ok) return
    const added = await ctx.memo.addEntry({ weekId: today.value.weekId, type: 'text', content: 'today' })
    expect(added.ok).toBe(true)
  })

  it('closes the current quarter too when that is the one archived', async () => {
    // "Archive this quarter" is a legitimate action on the current quarter, and
    // it closes today as well. The client disables the composer in that state
    // and points at the unarchive action, so this is a stated consequence rather
    // than a surprise.
    const { ctx } = await harness()
    const listed = ctx.memo.listPeriods({ period: 'quarter', limit: 4 })
    if (!listed.ok) return
    const current = listed.value[0]!
    expect(current.current).toBe(true)

    const today = await ctx.memo.getOrCreateCurrentWeek({})
    expect(today.ok).toBe(true)
    if (!today.ok) return
    const seeded = await ctx.memo.addEntry({ weekId: today.value.weekId, type: 'text', content: 'mine' })
    expect(seeded.ok).toBe(true)

    await ctx.memo.archiveQuarter({ label: current.label })
    const refused = await ctx.memo.addEntry({ weekId: today.value.weekId, type: 'text', content: 'later' })
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.error.code).toBe('quarter-archived')

    await ctx.memo.unarchiveQuarter({ label: current.label })
    const allowed = await ctx.memo.addEntry({ weekId: today.value.weekId, type: 'text', content: 'later' })
    expect(allowed.ok).toBe(true)
  })
})

describe('MemoService model catalog', () => {
  it('reports the resolved route alongside every registered provider', async () => {
    const { ctx } = await harness()
    const result = await ctx.memo.listModels({})

    expect(result.ok).toBe(true)
    expect(result.value.provider).toBe(TEST_ROUTE.provider)
    expect(result.value.model).toBe(TEST_ROUTE.model)
    expect(result.value.catalogError).toBeUndefined()
    expect(result.value.providers.map(provider => provider.id)).toEqual([TEST_ROUTE.provider])
    expect(result.value.providers[0]?.models.map(model => model.id))
      .toEqual([TEST_ROUTE.model, 'test-model-pro'])
    expect(result.value.providers[0]?.models[0]?.name).toBe('Test Model')
  })

  it('lists every registered provider in registration order, with its own models', async () => {
    const { ctx } = await harness({
      llm: {
        extraProviders: [
          { id: 'cu', name: 'ark', models: [{ id: 'glm-5-2-260617', name: 'glm-5.2' }] },
          { id: 'deepseek-cu', models: [{ id: 'deepseek-flash', name: 'ds-4.1' }] },
        ],
      },
    })
    const result = await ctx.memo.listModels({})

    expect(result.value.providers.map(provider => provider.id))
      .toEqual([TEST_ROUTE.provider, 'cu', 'deepseek-cu'])
    // The display name is what a selector shows, so it has to survive; a
    // provider without one falls back to its id rather than to an empty label.
    expect(result.value.providers.map(provider => provider.name))
      .toEqual([TEST_ROUTE.provider, 'ark', 'deepseek-cu'])
    expect(result.value.providers[1]?.models.map(model => model.name)).toEqual(['glm-5.2'])
    // The resolved route stays the deployment's, not the first catalog's.
    expect(result.value.provider).toBe(TEST_ROUTE.provider)
  })

  it('keeps every other provider when one catalog throws', async () => {
    // One adapter that cannot answer must not hide the models the others are
    // willing to serve, and must not turn the whole registry into an error.
    const { ctx } = await harness({
      llm: {
        extraProviders: [
          { id: 'broken', name: 'Broken', models: [], throws: 'endpoint is unreachable' },
          { id: 'deepseek-cu', models: [{ id: 'deepseek-pro', name: 'ds-4' }] },
        ],
      },
    })
    const result = await ctx.memo.listModels({})

    expect(result.ok).toBe(true)
    expect(result.value.catalogError).toBeUndefined()
    expect(result.value.providers.map(provider => provider.id))
      .toEqual([TEST_ROUTE.provider, 'broken', 'deepseek-cu'])
    const broken = result.value.providers[1]
    expect(broken?.error).toBe('endpoint is unreachable')
    expect(broken?.models).toEqual([])
    expect(result.value.providers[2]?.error).toBeUndefined()
    expect(result.value.providers[0]?.models.length).toBe(2)
  })

  it('follows agentDefaultModel when the service Config pins no route', async () => {
    const { ctx } = await harness({
      followAgentDefault: { provider: TEST_ROUTE.provider, model: 'test-model-pro' },
    })
    const result = await ctx.memo.listModels({})

    expect(result.value.provider).toBe(TEST_ROUTE.provider)
    expect(result.value.model).toBe('test-model-pro')
    expect(result.value.providers[0]?.models.length).toBe(2)
  })

  it('reports an empty provider catalog without an error when it advertises nothing', async () => {
    // A provider that advertises nothing and a catalog that could not be read
    // are different states: only the second one is worth telling the user about.
    const { ctx } = await harness({ llm: { catalog: [] } })
    const result = await ctx.memo.listModels({})

    expect(result.ok).toBe(true)
    expect(result.value.catalogError).toBeUndefined()
    expect(result.value.providers[0]?.models).toEqual([])
    expect(result.value.providers[0]?.error).toBeUndefined()
  })

  it('records a throwing provider as that provider\'s own error', async () => {
    const { ctx } = await harness({ llm: { catalogThrows: 'provider endpoint is unreachable' } })
    const result = await ctx.memo.listModels({})

    // Still a successful result: a missing catalog disables one group in a
    // picker, while a failure here would take the whole board down with it.
    expect(result.ok).toBe(true)
    expect(result.value.catalogError).toBeUndefined()
    expect(result.value.providers[0]?.error).toBe('provider endpoint is unreachable')
    expect(result.value.providers[0]?.models).toEqual([])
  })

  it('degrades to an empty registry when no llm service is mounted', async () => {
    const { ctx } = await harness({ withoutLlm: true })
    const result = await ctx.memo.listModels({})

    expect(result.ok).toBe(true)
    expect(result.value.providers).toEqual([])
    expect(result.value.catalogError).toContain('llm')
  })

  it('lets one call override the model without touching the configured route', async () => {
    // This is the seam the switcher depends on: the override wins for the call
    // that carries it, and nothing else in the deployment changes.
    const { ctx } = await harness()
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    await ctx.memo.addEntry({ weekId: week.value.weekId, type: 'text', content: 'work' })
    await settle()

    const overridden = await ctx.memo.analyze({
      period: 'week',
      periodLabel: week.value.weekId,
      analysisType: '\u5206\u6790',
      model: 'test-model-pro',
    })
    expect(overridden.ok).toBe(true)
    if (!overridden.ok) return
    expect(overridden.value.modelName).toBe('test-model-pro')

    const before = await ctx.memo.listModels({})
    expect(before.value.model).toBe(TEST_ROUTE.model)

    const asked = await ctx.memo.analyze({
      period: 'week',
      periodLabel: week.value.weekId,
      analysisType: '\u5206\u6790',
      provider: 'unregistered-provider',
      model: 'whatever',
    })
    expect(asked.ok).toBe(false)
    if (asked.ok) return
    expect(asked.error.code).toBe('llm-failure')
    if (asked.error.code !== 'llm-failure') return
    expect(asked.error.provider).toBe('unregistered-provider')
  })
})

describe('MemoService records the route on calls that worked', () => {
  /** The metadata of the first recorded event for one action and result. */
  function metadataOf(events: { kind: string; input: Record<string, unknown> }[], action: string, result: string): Record<string, unknown> {
    const event = events.find(candidate => candidate.input.action === action && candidate.input.result === result)
    expect(event, `no ${result} event was recorded for ${action}`).toBeDefined()
    return event!.input.metadata as Record<string, unknown>
  }

  it('records the route that served a successful analysis', async () => {
    // Before this, the route only ever appeared on a failure, so a later
    // analysis could say which route broke but never which route served the
    // calls that worked — leaving "did changing the route fix it?"
    // unanswerable from the data.
    const { ctx, telemetry } = await harness()
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    await ctx.memo.addEntry({ weekId: week.value.weekId, type: 'text', content: 'work' })
    await settle()

    const result = await ctx.memo.analyze({ period: 'week', periodLabel: week.value.weekId, analysisType: '\u5206\u6790' })
    expect(result.ok).toBe(true)

    expect(metadataOf(telemetry.events, 'analyze', 'success')).toMatchObject({
      provider: TEST_ROUTE.provider,
      model: TEST_ROUTE.model,
      period: 'week',
      periodLabel: week.value.weekId,
    })
  })

  it('records the route on a successful export and a model listing', async () => {
    const { ctx, telemetry } = await harness()
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    await ctx.memo.addEntry({ weekId: week.value.weekId, type: 'text', content: 'work' })
    await settle()

    const exported = await ctx.memo.exportReport({ period: 'week', periodLabel: week.value.weekId })
    expect(exported.ok).toBe(true)
    await ctx.memo.listModels({})

    expect(metadataOf(telemetry.events, 'exportReport', 'success')).toMatchObject({
      provider: TEST_ROUTE.provider,
      model: TEST_ROUTE.model,
    })
    expect(metadataOf(telemetry.events, 'listModels', 'success')).toMatchObject({
      provider: TEST_ROUTE.provider,
      model: TEST_ROUTE.model,
    })
  })

  it('records the route on log analysis, which is itself an AI call', async () => {
    const { ctx, telemetry } = await harness()

    const result = await ctx.memo.analyzeLogs({})
    expect(result.ok).toBe(true)

    expect(metadataOf(telemetry.events, 'analyzeLogs', 'success')).toMatchObject({
      provider: TEST_ROUTE.provider,
      model: TEST_ROUTE.model,
      pluginId: 'memo',
    })
  })

  it('records a resolved-but-empty route as empty instead of omitting it', async () => {
    // An absent route means "this event predates route recording"; an empty one
    // means "nothing resolved". Collapsing the two would put every old event
    // and every unroutable deployment in the same bucket.
    const { ctx, telemetry } = await harness({ config: { provider: '', model: '' } })
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) return
    await ctx.memo.addEntry({ weekId: week.value.weekId, type: 'text', content: 'work' })
    await settle()

    await ctx.memo.listModels({})

    const metadata = metadataOf(telemetry.events, 'listModels', 'success')
    expect(metadata).toHaveProperty('provider', '')
    expect(metadata).toHaveProperty('model', '')
  })

  it('records the route when a listing reports no usable provider', async () => {
    // The failure branch is the one a user consults when the model menu is
    // empty; without the route it cannot say whether a route was resolved.
    const { ctx, telemetry } = await harness({ withoutLlm: true, config: { provider: 'ghost', model: 'ghost-model' } })

    await ctx.memo.listModels({})

    expect(metadataOf(telemetry.events, 'listModels', 'failure')).toMatchObject({
      provider: 'ghost',
      model: 'ghost-model',
      reason: 'llm-unavailable',
    })
  })
})
