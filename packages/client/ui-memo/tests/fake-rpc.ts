import { expect, vi } from 'vitest'
import type { MemoAnalysisPeriod, MemoEntry, MemoPeriodEntry, MemoWeek } from 'dsh-memo/client'
import type { GithubIssueReport } from 'dsh-github-issue/client'

/**
 * A fake of the host memo service, faithful enough to test the board end to
 * end without a running DSH.
 *
 * It models the parts the UI actually depends on: the wire shape (transport
 * envelope wrapping a business result), the four-dimension calendar
 * (`listPeriods` returns real week ids so the board's period filtering is
 * exercised rather than stubbed), and the mutation-then-refresh cycle.
 */

/** Transport envelope shape returned by the connection RPC channel. */
interface Envelope { ok: boolean; value?: unknown; error?: { code: string; message: string } }

/** One recorded RPC call. */
export interface RecordedCall {
  /** Endpoint, e.g. `memo/addEntry`. */
  readonly endpoint: string
  /** The request payload. */
  readonly request: Record<string, unknown>
}

/** Options for {@link createFakeRpc}. */
export interface FakeRpcOptions {
  /** Seed weeks, keyed by ISO week id. */
  readonly weeks?: Record<string, { entries: { id: string; content: string; createdAt: number }[] }>
  /** Current ISO week id used when a week must be created. */
  readonly currentWeekId?: string
  /** Fail every call with this error. */
  readonly failWith?: { code: string; message: string }
  /** Fail only these endpoints (by method name). */
  readonly failOn?: Record<string, { code: string; message: string }>
  /** Result of `githubIssue/optimizeIssue`. */
  readonly issueReport?: GithubIssueReport
  /** Result of `memo/analyzeLogs`. */
  readonly logAnalysis?: { report: GithubIssueReport; issueUrl: string }
}

/** A fake RPC channel plus the state it accumulated. */
export interface FakeRpc {
  /** The `call` function to hand to the controller. */
  readonly call: (channel: string, endpoint: string, payload: unknown) => Promise<unknown>
  /** Every call received, in order. */
  readonly calls: RecordedCall[]
  /** The current stored state. */
  readonly state: { weeks: Map<string, MemoWeek> }
  /** Reset recorded calls without clearing stored data. */
  clearCalls(): void
}

/** Compute the ISO week id for a date. */
export function isoWeekId(date: Date): string {
  const monday = new Date(date)
  monday.setHours(0, 0, 0, 0)
  const day = monday.getDay()
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day))
  const thursday = new Date(monday)
  thursday.setDate(monday.getDate() + 3)
  const weekYear = thursday.getFullYear()
  const jan4 = new Date(weekYear, 0, 4)
  const firstMonday = new Date(jan4)
  const jan4Day = firstMonday.getDay()
  firstMonday.setDate(jan4.getDate() + (jan4Day === 0 ? -6 : 1 - jan4Day))
  const week = Math.round((monday.getTime() - firstMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1
  return `${String(weekYear)}-W${String(week).padStart(2, '0')}`
}

/** The Monday of an ISO week id. */
function mondayOf(weekId: string): Date {
  const year = Number(weekId.slice(0, 4))
  const week = Number(weekId.slice(6, 8))
  const jan4 = new Date(year, 0, 4)
  const firstMonday = new Date(jan4)
  const day = firstMonday.getDay()
  firstMonday.setDate(jan4.getDate() + (day === 0 ? -6 : 1 - day))
  firstMonday.setDate(firstMonday.getDate() + (week - 1) * 7)
  return firstMonday
}

/** Whether a week id belongs to a period label, by the Thursday rule. */
function weekInPeriod(weekId: string, period: MemoAnalysisPeriod, label: string): boolean {
  const monday = mondayOf(weekId)
  const thursday = new Date(monday)
  thursday.setDate(monday.getDate() + 3)
  const year = thursday.getFullYear()
  const month = thursday.getMonth() + 1
  if (period === 'week') return weekId === label
  if (period === 'month') return label === `${String(year)}-${String(month).padStart(2, '0')}`
  if (period === 'quarter') return label === `${String(year)}-Q${String(Math.floor(thursday.getMonth() / 3) + 1)}`
  return label === String(year)
}

/**
 * The inclusive date range of a period, mirroring the host's calendar.
 * A quarter is not `month * 3`, so it needs its own branch.
 */
function periodRange(period: MemoAnalysisPeriod, label: string): { start: Date; endExclusive: Date } {
  if (period === 'week') {
    const monday = mondayOf(label)
    const endExclusive = new Date(monday)
    endExclusive.setDate(monday.getDate() + 7)
    return { start: monday, endExclusive }
  }
  if (period === 'month') {
    const year = Number(label.slice(0, 4))
    const month = Number(label.slice(5, 7)) - 1
    return { start: new Date(year, month, 1), endExclusive: new Date(year, month + 1, 1) }
  }
  if (period === 'quarter') {
    const year = Number(label.slice(0, 4))
    const quarter = Number(label.slice(6, 7))
    return { start: new Date(year, (quarter - 1) * 3, 1), endExclusive: new Date(year, quarter * 3, 1) }
  }
  const year = Number(label)
  return { start: new Date(year, 0, 1), endExclusive: new Date(year + 1, 0, 1) }
}

/**
 * Build the period timeline for a dimension, newest first, starting at the
 * period containing `now`. Week ids come from the same Thursday rule the host
 * uses.
 */
function buildPeriods(period: MemoAnalysisPeriod, limit: number, now: Date): MemoPeriodEntry[] {
  const labelFor = (date: Date): string => {
    if (period === 'week') return isoWeekId(date)
    if (period === 'month') return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}`
    if (period === 'quarter') return `${String(date.getFullYear())}-Q${String(Math.floor(date.getMonth() / 3) + 1)}`
    return String(date.getFullYear())
  }
  const shifted = (date: Date, delta: number): Date => {
    const next = new Date(date)
    if (period === 'week') next.setDate(next.getDate() + delta * 7)
    else if (period === 'month') next.setMonth(next.getMonth() + delta)
    else if (period === 'quarter') next.setMonth(next.getMonth() + delta * 3)
    else next.setFullYear(next.getFullYear() + delta)
    return next
  }

  const currentLabel = labelFor(now)
  const entries: MemoPeriodEntry[] = []
  for (let index = 0; index < limit; index += 1) {
    const label = labelFor(shifted(now, -index))
    const range = periodRange(period, label)
    // Enumerate every day in the period; the days whose Thursday lands inside
    // name the weeks that belong to it.
    const weekIds = new Set<string>()
    for (const cursor = new Date(range.start); cursor.getTime() < range.endExclusive.getTime(); cursor.setDate(cursor.getDate() + 1)) {
      const thursday = new Date(cursor)
      const weekday = thursday.getDay()
      thursday.setDate(thursday.getDate() + (weekday === 0 ? -3 : 4 - weekday))
      if (thursday.getTime() < range.start.getTime() || thursday.getTime() >= range.endExclusive.getTime()) continue
      const monday = new Date(thursday)
      monday.setDate(thursday.getDate() - 3)
      weekIds.add(isoWeekId(monday))
    }
    entries.push({
      id: label,
      label,
      period,
      start: range.start.getTime(),
      end: range.endExclusive.getTime() - 1,
      current: label === currentLabel,
      weekCount: 0,
      weekIds: [...weekIds].sort(),
    })
  }
  return entries
}

/**
 * Create a fake RPC channel that behaves like the host memo service.
 * @param options - seed data and failure switches.
 * @returns the fake channel.
 */
export function createFakeRpc(options: FakeRpcOptions = {}): FakeRpc {
  const now = new Date()
  const currentWeekId = options.currentWeekId ?? isoWeekId(now)
  const weeks = new Map<string, MemoWeek>()
  for (const [weekId, seed] of Object.entries(options.weeks ?? {})) {
    const monday = mondayOf(weekId)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    weeks.set(weekId, {
      weekId,
      weekStart: monday.getTime(),
      weekEnd: sunday.getTime(),
      updatedAt: 0,
      entries: seed.entries.map(entry => ({
        id: entry.id,
        type: 'text' as const,
        content: entry.content,
        createdAt: entry.createdAt,
        updatedAt: entry.createdAt,
      })),
    })
  }

  const calls: RecordedCall[] = []
  const ok = (value: unknown): Envelope => ({ ok: true, value })
  const fail = (code: string, message: string): Envelope => ({ ok: false, error: { code, message } })

  const handle = (endpoint: string, request: Record<string, unknown>): Envelope => {
    const method = endpoint.slice(endpoint.indexOf('/') + 1)
    const failure = options.failWith ?? options.failOn?.[method]
    if (failure !== undefined) return fail(failure.code, failure.message)

    if (method === 'listWeeks') {
      return ok([...weeks.values()].sort((a, b) => b.weekStart - a.weekStart))
    }
    if (method === 'listPeriods') {
      const period = request.period as MemoAnalysisPeriod
      const limit = (request.limit as number | undefined) ?? 26
      const periods = buildPeriods(period, limit, now)
      return ok(periods.map(entry => ({
        ...entry,
        weekCount: entry.weekIds.filter(weekId => weeks.has(weekId)).length,
      })))
    }
    if (method === 'getOrCreateCurrentWeek') {
      const existing = weeks.get(currentWeekId)
      if (existing !== undefined) return ok(existing)
      const monday = mondayOf(currentWeekId)
      const created: MemoWeek = {
        weekId: currentWeekId,
        weekStart: monday.getTime(),
        weekEnd: monday.getTime() + 6 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now(),
        entries: [],
      }
      weeks.set(currentWeekId, created)
      return ok(created)
    }
    if (method === 'addEntry') {
      const weekId = String(request.weekId)
      const existing = weeks.get(weekId)
      const monday = mondayOf(weekId)
      const week: MemoWeek = existing ?? {
        weekId,
        weekStart: monday.getTime(),
        weekEnd: monday.getTime() + 6 * 24 * 60 * 60 * 1000,
        updatedAt: 0,
        entries: [],
      }
      const entry: MemoEntry = {
        id: `entry-${String(weeks.size)}-${String((week.entries ?? []).length + 1)}`,
        type: 'text',
        content: String(request.content),
        createdAt: 1_700_000_000_000 + calls.length,
        updatedAt: 1_700_000_000_000 + calls.length,
      }
      weeks.set(weekId, { ...week, entries: [...(week.entries ?? []), entry], updatedAt: entry.createdAt })
      return ok(entry)
    }
    if (method === 'updateEntry') {
      const weekId = String(request.weekId)
      const week = weeks.get(weekId)
      if (week === undefined) return fail('week-not-found', `no week ${weekId}`)
      const entryId = String(request.entryId)
      let updated: MemoEntry | undefined
      const entries = (week.entries ?? []).map(entry => {
        if (entry.id !== entryId) return entry
        updated = { ...entry, content: String(request.content), updatedAt: entry.updatedAt + 1 }
        return updated
      })
      if (updated === undefined) return fail('entry-not-found', `no entry ${entryId}`)
      weeks.set(weekId, { ...week, entries })
      return ok(updated)
    }
    if (method === 'deleteEntry') {
      const weekId = String(request.weekId)
      const week = weeks.get(weekId)
      if (week === undefined) return fail('week-not-found', `no week ${weekId}`)
      const entryId = String(request.entryId)
      const before = (week.entries ?? []).length
      const entries = (week.entries ?? []).filter(entry => entry.id !== entryId)
      if (entries.length === before) return fail('entry-not-found', `no entry ${entryId}`)
      weeks.set(weekId, { ...week, entries })
      return ok(true)
    }
    if (method === 'analyze') {
      return ok({ summary: `analysis:${String(request.analysisType)}`, period: request.period, periodLabel: request.periodLabel })
    }
    if (method === 'exportReport') {
      return ok(`# report for ${String(request.periodLabel)}`)
    }
    if (method === 'analyzeLogs') {
      if (options.logAnalysis === undefined) return fail('no-failures', 'no failures recorded')
      return ok(options.logAnalysis)
    }
    if (endpoint === 'githubIssue/optimizeIssue') {
      if (options.issueReport === undefined) return fail('llm-failure', 'no adapter registered for provider "unregistered"')
      return ok(options.issueReport)
    }
    return fail('not-found', `unhandled endpoint ${endpoint}`)
  }

  return {
    call: vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
      const args = (payload as { args?: { request?: Record<string, unknown> } }).args ?? {}
      const request = args.request ?? {}
      calls.push({ endpoint, request })
      // The transport envelope wraps the business result, so the wire shape is
      // `{ ok, value: { ok, value } }`. Returning the business result directly
      // would collapse one level and make the loader read `.ok` off an array.
      return { ok: true, value: handle(endpoint, request) }
    }),
    calls,
    state: { weeks },
    clearCalls(): void { calls.length = 0 },
  }
}

/** A github issue report fixture. */
export function issueReport(overrides: Partial<GithubIssueReport> = {}): GithubIssueReport {
  return {
    title: 'crash on analyze',
    body: 'The analyze action fails.',
    labels: ['bug'],
    ...overrides,
  } as GithubIssueReport
}

/** Assert that no request carried a hardcoded model route. */
export function expectNoModelRouteInRequests(calls: readonly RecordedCall[]): void {
  for (const call of calls) {
    expect(call.request.provider, `${call.endpoint} must not send provider`).toBeUndefined()
    expect(call.request.model, `${call.endpoint} must not send model`).toBeUndefined()
  }
}
