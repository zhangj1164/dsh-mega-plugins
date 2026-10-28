import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionSurfaceEventLike } from '../src/session-transcript.ts'
import type { TestHarness } from './harness.ts'
import { setupHarness } from './harness.ts'

const harnesses: TestHarness[] = []

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(h => h.dispose()))
})

async function harness(options: Parameters<typeof setupHarness>[0] = {}): Promise<TestHarness> {
  const h = await setupHarness(options)
  harnesses.push(h)
  return h
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

/** One session header as the mock query reports it. */
interface MockHeader {
  readonly id: string
  readonly createdAt: number
  readonly cwd?: string
  readonly origin?: string
}

/** Configuration for the mock workspace registry and session query. */
interface MockSessionConfig {
  /** Sessions in the official archive. */
  readonly archived: readonly string[]
  /** Headers the mock corpus can list. */
  readonly headers?: readonly MockHeader[]
  /** Log-backed titles, by session id. */
  readonly titles?: Readonly<Record<string, string>>
  /** Current surfaces, by session id. */
  readonly surfaces?: Readonly<Record<string, readonly SessionSurfaceEventLike[]>>
}

/** Mock `workspaceRegistry`: only the archive set is read by this feature. */
class MockWorkspaceRegistry extends Service {
  readonly archivedSessionIds: readonly string[]

  constructor(ctx: Context, config: MockSessionConfig) {
    super(ctx, 'workspaceRegistry')
    this.archivedSessionIds = [...config.archived]
  }
}

/** Mock `sessionQuery`: headers, titles, and surfaces served from one fixture. */
class MockSessionQuery extends Service {
  private readonly headers: readonly MockHeader[]
  private readonly titles: Readonly<Record<string, string>>
  private readonly surfaces: Readonly<Record<string, readonly SessionSurfaceEventLike[]>>

  constructor(ctx: Context, config: MockSessionConfig) {
    super(ctx, 'sessionQuery')
    this.headers = config.headers ?? []
    this.titles = config.titles ?? {}
    this.surfaces = config.surfaces ?? {}
  }

  async listSessions(): Promise<readonly { readonly header: MockHeader }[]> {
    return this.headers.map(header => ({ header }))
  }

  async readTitleSnapshots(sessionIds: readonly string[]): Promise<readonly {
    readonly sessionId: string
    readonly status: 'fulfilled' | 'rejected'
    readonly value?: { readonly session?: MockHeader; readonly title?: { readonly title: string } }
  }[]> {
    return sessionIds.map(sessionId => {
      const header = this.headers.find(candidate => candidate.id === sessionId)
      if (header === undefined) return { sessionId, status: 'rejected' as const }
      const title = this.titles[sessionId]
      return {
        sessionId,
        status: 'fulfilled' as const,
        value: {
          session: header,
          ...(title === undefined ? {} : { title: { title } }),
        },
      }
    })
  }

  async readSurface(sessionId: string): Promise<{ readonly session?: MockHeader; readonly events: readonly SessionSurfaceEventLike[] }> {
    const events = this.surfaces[sessionId]
    if (events === undefined) throw new Error(`no log for ${sessionId}`)
    return { session: this.headers.find(header => header.id === sessionId), events }
  }
}

/** A session with a system prompt, a real exchange, a tool result, and a synthesized user turn. */
const SURFACE_A: readonly SessionSurfaceEventLike[] = [
  { type: 'system/message', seq: 1, data: { content: [{ type: 'text', text: 'SYSTEM_ONLY' }] } },
  {
    type: 'user/message',
    seq: 2,
    data: {
      message: {
        content: [{ type: 'text', text: 'Please fix the CI' }],
        source: { kind: 'user' },
      },
    },
  },
  {
    type: 'assistant/message',
    seq: 3,
    data: {
      message: {
        content: [
          { type: 'text', text: 'I fixed the CI' },
          { type: 'tool-call', toolName: 'bash' },
        ],
      },
    },
  },
  { type: 'tool/result', seq: 4, data: { message: { content: [{ type: 'text', text: 'TOOL_RESULT_ONLY' }] } } },
  {
    type: 'user/message',
    seq: 5,
    data: {
      message: {
        content: [{ type: 'text', text: 'TOOL_ONLY' }],
        source: { kind: 'tool' },
      },
    },
  },
]

/** A session with a single assistant turn and no user text. */
const SURFACE_TOOL_ONLY: readonly SessionSurfaceEventLike[] = [
  { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'text', text: 'just a tool wrapper' }] } } },
]

const HEADERS: readonly MockHeader[] = [
  { id: 'session-a', createdAt: 2_000, cwd: '/work' },
  { id: 'session-b', createdAt: 1_000 },
  { id: 'session-sub', createdAt: 3_000, origin: 'subagent' },
]

/** The full fixture: two user sessions, one subagent, one unreadable id. */
const FIXTURE: MockSessionConfig = {
  archived: ['session-a', 'session-b', 'session-sub'],
  headers: HEADERS,
  titles: { 'session-a': 'Fix CI' },
  surfaces: { 'session-a': SURFACE_A, 'session-b': SURFACE_TOOL_ONLY },
}

/** Build a harness with the session services mounted before memo. */
async function sessionHarness(
  config: MockSessionConfig = FIXTURE,
  options: Omit<Parameters<typeof setupHarness>[0], 'beforeMemo'> = {},
): Promise<TestHarness> {
  return harness({
    ...options,
    beforeMemo: async (ctx) => {
      await ctx.plugin(MockWorkspaceRegistry, config)
      await ctx.plugin(MockSessionQuery, config)
    },
  })
}

describe('listArchivedSessions', () => {
  it('maps archived ids to titles and filters subagent sessions', async () => {
    const h = await sessionHarness()
    const result = await h.ctx.memo.listArchivedSessions({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sessions.map(session => session.sessionId)).toEqual(['session-a', 'session-b'])
    expect(result.value.sessions[0]?.title).toBe('Fix CI')
    expect(result.value.sessions[0]?.createdAt).toBe(2_000)
    expect(result.value.sessions[0]?.cwd).toBe('/work')
    expect(result.value.sessions[1]?.title).toBe('Session session-')
    expect(result.value.maxSessions).toBe(5)
    expect(result.value.currentWeekId).toBe(currentWeekId())
  })

  it('reports a missing workspace registry instead of an empty picker', async () => {
    const h = await harness()
    const result = await h.ctx.memo.listArchivedSessions({})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('session-service-unavailable')
  })
})

describe('summarizeSession', () => {
  it('writes one entry with the default source annotation and provenance', async () => {
    const h = await sessionHarness()
    const weekId = currentWeekId()
    const result = await h.ctx.memo.summarizeSession({ sessionIds: ['session-a'], weekId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const outcome = result.value.outcomes[0]
    expect(outcome?.entry?.originSessionId).toBe('session-a')
    expect(outcome?.entry?.content).toBe('# Work Report\n\n- entry 1\n- entry 2\n\n来源会话：session-a')
    expect(result.value.weekId).toBe(weekId)

    const week = h.ctx.memo.getWeek({ weekId })
    expect(week.ok).toBe(true)
    if (!week.ok || week.value === null) return
    expect(week.value.entries.map(entry => entry.id)).toEqual([outcome?.entry?.id])
  })

  it('sends only user and assistant text to the model', async () => {
    const h = await sessionHarness()
    await h.ctx.memo.summarizeSession({ sessionIds: ['session-a'], weekId: currentWeekId() })
    const call = h.llm.calls[0]
    expect(call).toBeDefined()
    expect(call?.userText).toContain('Please fix the CI')
    expect(call?.userText).toContain('I fixed the CI')
    expect(call?.userText).not.toContain('SYSTEM_ONLY')
    expect(call?.userText).not.toContain('TOOL_RESULT_ONLY')
    expect(call?.userText).not.toContain('TOOL_ONLY')
    expect(call?.system).toContain('work-session summarizer')
  })

  it('honours a custom source template with the session title', async () => {
    const h = await sessionHarness(FIXTURE, {
      memoConfig: { sessionSummarySourceTemplate: '\n\n[{sessionTitle}]({sessionId})' },
    })
    const result = await h.ctx.memo.summarizeSession({ sessionIds: ['session-a'], weekId: currentWeekId() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.outcomes[0]?.entry?.content).toBe('# Work Report\n\n- entry 1\n- entry 2\n\n[Fix CI](session-a)')
  })

  it('refuses a duplicate unless force is set, then replaces the same entry', async () => {
    const h = await sessionHarness()
    const weekId = currentWeekId()
    const first = await h.ctx.memo.summarizeSession({ sessionIds: ['session-a'], weekId })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const entryId = first.value.outcomes[0]?.entry?.id

    const duplicate = await h.ctx.memo.summarizeSession({ sessionIds: ['session-a'], weekId })
    expect(duplicate.ok).toBe(true)
    if (!duplicate.ok) return
    expect(duplicate.value.outcomes[0]?.error?.code).toBe('already-summarized')

    const forced = await h.ctx.memo.summarizeSession({ sessionIds: ['session-a'], weekId, force: true })
    expect(forced.ok).toBe(true)
    if (!forced.ok) return
    expect(forced.value.outcomes[0]?.entry?.id).toBe(entryId)
    expect(forced.value.outcomes[0]?.entry?.originSessionId).toBe('session-a')

    const week = h.ctx.memo.getWeek({ weekId })
    if (!week.ok || week.value === null) return
    expect(week.value.entries).toHaveLength(1)
  })

  it('isolates a session that cannot be read', async () => {
    const h = await sessionHarness({
      ...FIXTURE,
      archived: ['session-a', 'session-missing'],
      headers: [...HEADERS, { id: 'session-missing', createdAt: 500 }],
    })
    const result = await h.ctx.memo.summarizeSession({ sessionIds: ['session-a', 'session-missing'], weekId: currentWeekId() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.outcomes[0]?.entry).toBeDefined()
    expect(result.value.outcomes[1]?.error?.code).toBe('session-unreadable')
  })

  it('reports a session with no user or assistant text as empty', async () => {
    const h = await sessionHarness({
      ...FIXTURE,
      archived: ['session-tool'],
      headers: [{ id: 'session-tool', createdAt: 100 }],
      surfaces: { 'session-tool': [{ type: 'tool/result', seq: 1, data: {} }] },
    })
    const result = await h.ctx.memo.summarizeSession({ sessionIds: ['session-tool'], weekId: currentWeekId() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.outcomes[0]?.error?.code).toBe('session-empty')
  })

  it('keeps the DSH failure facts when the model route fails', async () => {
    const h = await sessionHarness(FIXTURE, { llm: { behaviour: 'route-error' } })
    const result = await h.ctx.memo.summarizeSession({ sessionIds: ['session-a'], weekId: currentWeekId() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const error = result.value.outcomes[0]?.error
    expect(error?.code).toBe('llm-failure')
    if (error?.code !== 'llm-failure') return
    expect(error.failureCode).toBe('NO_ADAPTER')
    expect(error.provider).toBe('test-provider')
  })

  it('refuses a session that is not in the official archive', async () => {
    const h = await sessionHarness({ ...FIXTURE, archived: [] })
    const result = await h.ctx.memo.summarizeSession({ sessionIds: ['session-a'], weekId: currentWeekId() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.outcomes[0]?.error?.code).toBe('session-not-archived')
  })

  it('caps one request at the configured session limit', async () => {
    const h = await sessionHarness(FIXTURE, { memoConfig: { sessionSummaryMaxSessions: 1 } })
    const result = await h.ctx.memo.summarizeSession({ sessionIds: ['session-a', 'session-b'], weekId: currentWeekId() })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('too-many-sessions')
  })

  it('refuses a malformed target week', async () => {
    const h = await sessionHarness()
    const result = await h.ctx.memo.summarizeSession({ sessionIds: ['session-a'], weekId: 'not-a-week' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid-week-id')
  })

  it('reports summarized weeks back to the picker', async () => {
    const h = await sessionHarness()
    const weekId = currentWeekId()
    await h.ctx.memo.summarizeSession({ sessionIds: ['session-a'], weekId })
    const listed = await h.ctx.memo.listArchivedSessions({})
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.value.sessions[0]?.summarizedWeekIds).toContain(weekId)
  })
})
