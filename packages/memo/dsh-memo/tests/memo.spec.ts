import { afterEach, describe, expect, it } from 'vitest'
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
