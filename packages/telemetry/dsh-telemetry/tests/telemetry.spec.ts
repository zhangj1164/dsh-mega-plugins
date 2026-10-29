import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import TelemetryService from '../src/index.ts'
import type { TestHarness } from './harness.ts'
import { setupHarness } from './harness.ts'

const harnesses: TestHarness[] = []

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(h => h.dispose()))
})

async function harness(): Promise<TestHarness> {
  const h = await setupHarness()
  harnesses.push(h)
  return h
}

/** A harness with the given telemetry Config overrides. */
async function harnessWith(config: Record<string, unknown>): Promise<TestHarness> {
  const h = await setupHarness(undefined, config)
  harnesses.push(h)
  return h
}

describe('TelemetryService write-time redaction', () => {
  it('removes secrets from an error message and stack before storing them', async () => {
    const { ctx } = await harness()
    ctx.telemetry.trackError({
      pluginId: 'memo',
      action: 'addEntry',
      error: {
        code: 'storage-error',
        featureCodeRef: 'memo.storage',
        message: 'cannot write /Users/zjlzld/.dsh/memo.json for jane@example.com',
        stack: 'Error: EACCES\n    at open (C:\\Users\\zjlzld\\.dsh\\memo.json:12:5)',
      },
    })
    await ctx.telemetry.flush()
    const [event] = ctx.telemetry.listEvents({ pluginId: 'memo' })

    expect(event?.error?.message).toBe('cannot write [redacted:home-path] for [redacted:email]')
    expect(event?.error?.stack).toBe('Error: EACCES\n    at open ([redacted:home-path]:12:5)')
    // The grouping keys survive, or the log stops being analyzable.
    expect(event?.error?.code).toBe('storage-error')
    expect(event?.error?.featureCodeRef).toBe('memo.storage')
  })

  it('removes secrets nested anywhere inside metadata', async () => {
    const { ctx } = await harness()
    ctx.telemetry.track({
      pluginId: 'memo',
      action: 'analyze',
      metadata: {
        route: { provider: 'custom', endpoint: 'http://10.0.0.7:8080/v1' },
        attempts: [3, { note: 'from /home/me/notes.md' }],
      },
    })
    await ctx.telemetry.flush()
    const [event] = ctx.telemetry.listEvents({ pluginId: 'memo' })

    expect(event?.metadata).toEqual({
      route: { provider: 'custom', endpoint: 'http://[redacted:ipv4]:8080/v1' },
      attempts: [3, { note: 'from [redacted:home-path]' }],
    })
    // The numeric leaf keeps its type rather than becoming a string.
    expect(typeof (event?.metadata?.attempts as unknown[])[0]).toBe('number')
  })

  it('stores events verbatim when redaction is turned off', async () => {
    const { ctx } = await harnessWith({ redact: false })
    ctx.telemetry.track({ pluginId: 'memo', action: 'addEntry', metadata: { path: '/Users/me/x.md' } })
    await ctx.telemetry.flush()
    expect(ctx.telemetry.listEvents({ pluginId: 'memo' })[0]?.metadata).toEqual({ path: '/Users/me/x.md' })
  })

  it('applies a deployment-supplied rule set instead of the defaults', async () => {
    const { ctx } = await harnessWith({
      redactionMarker: '<{rule}>',
      redactionRules: [{ name: 'ticket', pattern: 'JIRA-\\d+' }],
    })
    ctx.telemetry.track({
      pluginId: 'memo',
      action: 'addEntry',
      metadata: { subject: 'JIRA-4210 for jane@example.com' },
    })
    await ctx.telemetry.flush()
    // The custom rule fires; the default email rule is gone because the rule
    // set is the deployment's, not an addition to ours.
    expect(ctx.telemetry.listEvents({ pluginId: 'memo' })[0]?.metadata).toEqual({
      subject: '<ticket> for jane@example.com',
    })
  })

  it('leaves already-stored events alone', async () => {
    // Redaction is a write-time policy: it changes what is recorded next, never
    // what was recorded before.
    const first = await harnessWith({ redact: false })
    first.ctx.telemetry.track({ pluginId: 'memo', action: 'addEntry', metadata: { path: '/Users/me/x.md' } })
    await first.ctx.telemetry.flush()
    const root = first.root
    await first.disposeKeepRoot()
    harnesses.splice(harnesses.indexOf(first), 1)

    const reopened = await setupHarness(root)
    harnesses.push(reopened)
    expect(reopened.ctx.telemetry.listEvents({ pluginId: 'memo' })[0]?.metadata).toEqual({ path: '/Users/me/x.md' })
  })
})

describe('TelemetryService track and query', () => {
  it('records a success event durably', async () => {
    const { ctx } = await harness()
    ctx.telemetry.track({ pluginId: 'memo', action: 'addEntry' })
    await ctx.telemetry.flush()
    const events = ctx.telemetry.listEvents({ pluginId: 'memo' })
    expect(events).toHaveLength(1)
    expect(events[0].pluginId).toBe('memo')
    expect(events[0].action).toBe('addEntry')
    expect(events[0].result).toBe('success')
    expect(events[0].category).toBe('user-action')
  })

  it('records a failure event with featureCodeRef', async () => {
    const { ctx } = await harness()
    ctx.telemetry.trackError({
      pluginId: 'memo',
      action: 'analyze',
      error: { code: 'LLM_FAILURE', message: 'model timeout', featureCodeRef: 'memo:analyze' },
    })
    await ctx.telemetry.flush()
    const events = ctx.telemetry.listEvents({ pluginId: 'memo' })
    expect(events).toHaveLength(1)
    expect(events[0].result).toBe('failure')
    expect(events[0].category).toBe('error')
    expect(events[0].error).toBeDefined()
    expect(events[0].error!.featureCodeRef).toBe('memo:analyze')
    expect(events[0].error!.code).toBe('LLM_FAILURE')
  })

  it('filters events by pluginId', async () => {
    const { ctx } = await harness()
    ctx.telemetry.track({ pluginId: 'memo', action: 'a1' })
    ctx.telemetry.track({ pluginId: 'other', action: 'a2' })
    ctx.telemetry.track({ pluginId: 'memo', action: 'a3' })
    await ctx.telemetry.flush()
    expect(ctx.telemetry.listEvents({ pluginId: 'memo' })).toHaveLength(2)
    expect(ctx.telemetry.listEvents({ pluginId: 'other' })).toHaveLength(1)
  })

  it('respects the limit parameter', async () => {
    const { ctx } = await harness()
    for (let i = 0; i < 5; i++) {
      ctx.telemetry.track({ pluginId: 'memo', action: `action-${i}` })
    }
    await ctx.telemetry.flush()
    const limited = ctx.telemetry.listEvents({ pluginId: 'memo', limit: 2 })
    expect(limited).toHaveLength(2)
    // The limit has to select the newest events, not whichever rows the table
    // handed back first: filtering during the walk would return the oldest two.
    expect(limited.map(event => event.action)).toEqual(['action-4', 'action-3'])
  })
})

describe('TelemetryService analyzeForPlugin', () => {
  it('groups failures by featureCodeRef', async () => {
    const { ctx } = await harness()
    ctx.telemetry.trackError({
      pluginId: 'memo', action: 'addEntry',
      error: { code: 'E1', message: 'err1', featureCodeRef: 'memo:addEntry' },
    })
    ctx.telemetry.trackError({
      pluginId: 'memo', action: 'addEntry',
      error: { code: 'E2', message: 'err2', featureCodeRef: 'memo:addEntry' },
    })
    ctx.telemetry.trackError({
      pluginId: 'memo', action: 'analyze',
      error: { code: 'E3', message: 'err3', featureCodeRef: 'memo:analyze' },
    })
    ctx.telemetry.track({ pluginId: 'memo', action: 'listWeeks' })
    await ctx.telemetry.flush()

    const analysis = ctx.telemetry.analyzeForPlugin('memo')
    expect(analysis.totalEvents).toBe(4)
    expect(analysis.totalFailures).toBe(3)
    expect(analysis.failureGroups).toHaveLength(2)

    const addEntryGroup = analysis.failureGroups.find(g => g.featureCodeRef === 'memo:addEntry')
    expect(addEntryGroup).toBeDefined()
    expect(addEntryGroup!.count).toBe(2)
    expect(addEntryGroup!.errorCodes).toContain('E1')
    expect(addEntryGroup!.errorCodes).toContain('E2')

    const analyzeGroup = analysis.failureGroups.find(g => g.featureCodeRef === 'memo:analyze')
    expect(analyzeGroup).toBeDefined()
    expect(analyzeGroup!.count).toBe(1)
  })

  it('returns zeros for an unknown plugin', async () => {
    const { ctx } = await harness()
    const analysis = ctx.telemetry.analyzeForPlugin('nonexistent')
    expect(analysis.totalEvents).toBe(0)
    expect(analysis.totalFailures).toBe(0)
    expect(analysis.failureGroups).toHaveLength(0)
    // No events means no window: an empty range would read as "nothing happened
    // in this period" rather than "there is nothing to speak of".
    expect(analysis.window).toBeUndefined()
  })

  it('reports the window the analysis read', async () => {
    const { ctx } = await harness()
    ctx.telemetry.track({ pluginId: 'memo', action: 'listWeeks' })
    ctx.telemetry.trackError({
      pluginId: 'memo', action: 'analyze',
      error: { code: 'E1', message: 'err1', featureCodeRef: 'memo:analyze' },
    })
    await ctx.telemetry.flush()

    const analysis = ctx.telemetry.analyzeForPlugin('memo')
    const timestamps = ctx.telemetry.listEvents({ pluginId: 'memo' }).map(event => event.timestamp)
    expect(analysis.window).toBeDefined()
    expect(analysis.window!.firstEventAt).toBe(Math.min(...timestamps))
    expect(analysis.window!.lastEventAt).toBe(Math.max(...timestamps))
    // Only this plugin's events bound the window, not the whole table's: a
    // busier neighbour must not make this plugin look active.
    ctx.telemetry.track({ pluginId: 'other', action: 'listWeeks' })
    await ctx.telemetry.flush()
    expect(ctx.telemetry.analyzeForPlugin('memo').window).toEqual(analysis.window)
  })

  it('counts attempts of the failing action after the last failure', async () => {
    const { ctx } = await harness()
    ctx.telemetry.trackError({
      pluginId: 'memo', action: 'analyze',
      error: { code: 'LLM_FAILURE', message: 'no output', featureCodeRef: 'memo:analyze' },
    })
    await ctx.telemetry.flush()
    // Unrelated reads must not be counted: they would inflate the number and
    // present an old failure as if it sat in a busy period.
    for (let i = 0; i < 3; i++) ctx.telemetry.track({ pluginId: 'memo', action: 'listWeeks' })
    for (let i = 0; i < 2; i++) ctx.telemetry.track({ pluginId: 'memo', action: 'analyze' })
    // Nor other plugins' attempts of the same action.
    ctx.telemetry.track({ pluginId: 'other', action: 'analyze' })
    await ctx.telemetry.flush()

    const group = ctx.telemetry.analyzeForPlugin('memo').failureGroups[0]!
    expect(group.featureCodeRef).toBe('memo:analyze')
    expect(group.attemptsAfterLastFailure).toBe(2)
  })

  it('carries the recorded route, and only the allowlisted keys', async () => {
    const { ctx } = await harness()
    ctx.telemetry.trackError({
      pluginId: 'memo', action: 'analyze',
      error: { code: 'LLM_FAILURE', message: 'no output', featureCodeRef: 'memo:analyze' },
      metadata: { provider: 'deepseek-cu', model: 'deepseek-flash', status: 429, apiKey: 'sk-secret', notes: 'x' },
    })
    await ctx.telemetry.flush()

    const group = ctx.telemetry.analyzeForPlugin('memo').failureGroups[0]!
    // The route survives redaction: ids like these match no rule, which is the
    // fact that makes carrying them possible at all.
    expect(group.route).toEqual({ provider: 'deepseek-cu', model: 'deepseek-flash', status: 429 })
    // Everything else stays behind. The report leaves the machine.
    expect(JSON.stringify(group.route)).not.toContain('secret')
    expect(Object.keys(group.route!)).toEqual(['provider', 'model', 'status'])
  })

  it('leaves the route absent when the event recorded none', async () => {
    const { ctx } = await harness()
    // The shape of every failure recorded before the metadata write existed.
    ctx.telemetry.trackError({
      pluginId: 'memo', action: 'analyze',
      error: { code: 'LLM_FAILURE', message: 'no output', featureCodeRef: 'memo:analyze' },
    })
    ctx.telemetry.trackError({
      pluginId: 'memo', action: 'exportReport',
      error: { code: 'LLM_FAILURE', message: 'no output', featureCodeRef: 'memo:exportReport' },
      metadata: { provider: 'deepseek-cu' },
    })
    await ctx.telemetry.flush()

    const groups = ctx.telemetry.analyzeForPlugin('memo').failureGroups
    // Absent means "not recorded", never "no route".
    expect(groups.every(group => group.route === undefined)).toBe(true)
  })
})

describe('TelemetryService event order', () => {
  // A fixed clock is what makes the same-millisecond case reproducible rather
  // than occasional: on a real clock these events land in one millisecond only
  // some of the time, which is why the defect could reach a green suite and
  // then fail the next full run.
  const SAME_MILLISECOND = 1_700_000_000_000

  it('counts an attempt written in the same millisecond as the failure', async () => {
    const { ctx } = await harness()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(SAME_MILLISECOND)
    try {
      ctx.telemetry.trackError({
        pluginId: 'memo', action: 'analyze',
        error: { code: 'LLM_FAILURE', message: 'no output', featureCodeRef: 'memo:analyze' },
      })
      // A retry that starts within the same millisecond as the failure is still
      // a retry: `Date.now()` has no resolution for it, the write order does.
      ctx.telemetry.track({ pluginId: 'memo', action: 'analyze' })
      ctx.telemetry.track({ pluginId: 'memo', action: 'analyze' })
      await ctx.telemetry.flush()
    } finally {
      clock.mockRestore()
    }

    const group = ctx.telemetry.analyzeForPlugin('memo').failureGroups[0]!
    expect(group.featureCodeRef).toBe('memo:analyze')
    expect(group.attemptsAfterLastFailure).toBe(2)
  })

  it('takes the last-written failure when two share a millisecond', async () => {
    const { ctx } = await harness()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(SAME_MILLISECOND)
    try {
      ctx.telemetry.trackError({
        pluginId: 'memo', action: 'analyze',
        error: { code: 'E_FIRST', message: 'first', featureCodeRef: 'memo:analyze' },
        metadata: { provider: 'p-first', model: 'm-first' },
      })
      ctx.telemetry.trackError({
        pluginId: 'memo', action: 'analyze',
        error: { code: 'E_SECOND', message: 'second', featureCodeRef: 'memo:analyze' },
        metadata: { provider: 'p-second', model: 'm-second' },
      })
      ctx.telemetry.track({ pluginId: 'memo', action: 'analyze' })
      await ctx.telemetry.flush()
    } finally {
      clock.mockRestore()
    }

    const group = ctx.telemetry.analyzeForPlugin('memo').failureGroups[0]!
    expect(group.count).toBe(2)
    // The report describes this group with `latest`, so it has to be the second
    // failure: its code, message and route are the ones a reader will act on.
    expect(group.latest.error?.code).toBe('E_SECOND')
    expect(group.latest.error?.message).toBe('second')
    expect(group.route).toEqual({ provider: 'p-second', model: 'm-second' })
    // Only the recorded attempt came after it; the second failure is the last
    // failure, not an attempt at recovering from itself.
    expect(group.attemptsAfterLastFailure).toBe(1)
  })

  it('lists events newest first inside one millisecond', async () => {
    const { ctx } = await harness()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(SAME_MILLISECOND)
    try {
      for (const action of ['a1', 'a2', 'a3']) ctx.telemetry.track({ pluginId: 'memo', action })
      await ctx.telemetry.flush()
    } finally {
      clock.mockRestore()
    }

    expect(ctx.telemetry.listEvents({ pluginId: 'memo' }).map(event => event.action)).toEqual(['a3', 'a2', 'a1'])
  })

  it('keeps the sequence running across a cold restart', async () => {
    const first = await setupHarness()
    harnesses.push(first)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(SAME_MILLISECOND)
    let root = ''
    try {
      first.ctx.telemetry.trackError({
        pluginId: 'memo', action: 'analyze',
        error: { code: 'LLM_FAILURE', message: 'no output', featureCodeRef: 'memo:analyze' },
      })
      await first.ctx.telemetry.flush()
      root = first.root
    } finally {
      clock.mockRestore()
    }
    await first.disposeKeepRoot()
    harnesses.splice(harnesses.indexOf(first), 1)

    const second = await setupHarness(root)
    harnesses.push(second)
    const laterClock = vi.spyOn(Date, 'now').mockReturnValue(SAME_MILLISECOND)
    try {
      second.ctx.telemetry.track({ pluginId: 'memo', action: 'analyze' })
      await second.ctx.telemetry.flush()
    } finally {
      laterClock.mockRestore()
    }

    // A sequence that restarted at 1 would hand this attempt a number the
    // stored failure already holds, and every comparison would go back to
    // comparing two equal timestamps.
    const group = second.ctx.telemetry.analyzeForPlugin('memo').failureGroups[0]!
    expect(group.attemptsAfterLastFailure).toBe(1)
  })

  it('opens a store written before the sequence existed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-telemetry-legacy-'))
    // The shape of a row written by a build that predates `seq`, in the
    // single-layout JSON unit this package opens.
    await writeFile(join(root, 'memo_telemetry.json'), `${JSON.stringify({
      unit: { name: 'memo_telemetry', version: 0 },
      tables: {
        events: {
          'legacy-failure': {
            id: 'legacy-failure',
            timestamp: 1_000,
            pluginId: 'memo',
            action: 'analyze',
            category: 'error',
            result: 'failure',
            error: { code: 'LLM_FAILURE', message: 'no output', featureCodeRef: 'memo:analyze' },
          },
          'legacy-attempt': {
            id: 'legacy-attempt',
            timestamp: 2_000,
            pluginId: 'memo',
            action: 'analyze',
            category: 'user-action',
            result: 'success',
          },
        },
      },
    }, null, 2)}\n`)

    const reopened = await setupHarness(root)
    harnesses.push(reopened)
    try {
      // An old record has no write order of its own, so the timestamp still
      // decides — and its `seq` reads as 0 rather than as "missing".
      const events = reopened.ctx.telemetry.listEvents({ pluginId: 'memo' })
      expect(events.map(event => event.id)).toEqual(['legacy-attempt', 'legacy-failure'])
      expect(events.map(event => event.seq)).toEqual([0, 0])

      const group = reopened.ctx.telemetry.analyzeForPlugin('memo').failureGroups[0]!
      expect(group.latest.id).toBe('legacy-failure')
      expect(group.attemptsAfterLastFailure).toBe(1)

      // A write after the sequence exists is later than every legacy row even
      // when its clock reading is smaller: write order is the order, not time.
      const clock = vi.spyOn(Date, 'now').mockReturnValue(500)
      try {
        reopened.ctx.telemetry.track({ pluginId: 'memo', action: 'analyze' })
        await reopened.ctx.telemetry.flush()
      } finally {
        clock.mockRestore()
      }
      expect(reopened.ctx.telemetry.analyzeForPlugin('memo').failureGroups[0]!.attemptsAfterLastFailure).toBe(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('TelemetryService read-time redaction', () => {
  it('re-reads a stored record on the way out, so a legacy row cannot reach a report verbatim', async () => {
    // A row can end up unprotected without anyone writing it insecurely: it was
    // stored before the rule set covered what it carries. Write-time redaction
    // is irreversible, so the analysis is the last place such a row can be
    // stopped before it becomes a model prompt and a pre-filled issue.
    const legacy = await harnessWith({ redact: false })
    legacy.ctx.telemetry.trackError({
      pluginId: 'memo',
      action: 'analyze',
      error: {
        code: 'ENOENT',
        message: "cannot open '/home/acme/payroll.xlsx' for jane@example.com",
        stack: 'Error: ENOENT\n    at open (/home/acme/payroll.xlsx:12:5)',
        featureCodeRef: 'memo:analyze',
      },
      metadata: { endpoint: 'http://10.0.0.7:8080/v1', provider: 'deepseek-cu', model: 'deepseek-flash', status: 429 },
    })
    await legacy.ctx.telemetry.flush()
    const root = legacy.root
    await legacy.disposeKeepRoot()
    harnesses.splice(harnesses.indexOf(legacy), 1)

    const reopened = await setupHarness(root)
    harnesses.push(reopened)
    // The store still holds the verbatim row: read-time redaction is not a
    // migration, and listEvents stays the raw view of what was recorded.
    expect(reopened.ctx.telemetry.listEvents({ pluginId: 'memo' })[0]?.error?.message)
      .toBe("cannot open '/home/acme/payroll.xlsx' for jane@example.com")

    const group = reopened.ctx.telemetry.analyzeForPlugin('memo').failureGroups[0]!
    expect(group.latest.error?.message).toBe("cannot open '[redacted:home-path]' for [redacted:email]")
    expect(group.latest.error?.stack).toBe('Error: ENOENT\n    at open ([redacted:home-path]:12:5)')
    expect(group.latest.metadata).toEqual({
      endpoint: 'http://[redacted:ipv4]:8080/v1',
      provider: 'deepseek-cu',
      model: 'deepseek-flash',
      status: 429,
    })
    // The grouping keys stay legible, and the route still comes from the stored
    // metadata, so the report can still say where the failure ran.
    expect(group.latest.error?.code).toBe('ENOENT')
    expect(group.latest.error?.featureCodeRef).toBe('memo:analyze')
    expect(group.route).toEqual({ provider: 'deepseek-cu', model: 'deepseek-flash', status: 429 })
  })

  it('comes back unchanged when the stored record was already redacted', async () => {
    const { ctx } = await harness()
    ctx.telemetry.trackError({
      pluginId: 'memo',
      action: 'analyze',
      error: {
        code: 'EACCES',
        message: 'cannot write /Users/me/x.md for jane@example.com',
        featureCodeRef: 'memo:analyze',
      },
      metadata: { note: 'from /home/me/notes.md' },
    })
    await ctx.telemetry.flush()

    // A marker matches no default rule, so the second pass is a no-op rather
    // than a nested marker — which is what makes re-reading the store safe.
    const group = ctx.telemetry.analyzeForPlugin('memo').failureGroups[0]!
    expect(group.latest.error?.message).toBe('cannot write [redacted:home-path] for [redacted:email]')
    expect(group.latest.metadata).toEqual({ note: 'from [redacted:home-path]' })
    expect(JSON.stringify(group.latest)).not.toContain('[redacted:[redacted')
  })

  it('leaves the free text verbatim when redaction is off', async () => {
    const { ctx } = await harnessWith({ redact: false })
    ctx.telemetry.trackError({
      pluginId: 'memo',
      action: 'analyze',
      error: { code: 'EACCES', message: 'cannot write /Users/me/x.md', featureCodeRef: 'memo:analyze' },
    })
    await ctx.telemetry.flush()

    // The deployment asked for the verbatim log, which is what someone tuning
    // their rules needs; the read pass must not quietly contradict that choice.
    const group = ctx.telemetry.analyzeForPlugin('memo').failureGroups[0]!
    expect(group.latest.error?.message).toBe('cannot write /Users/me/x.md')
  })

  it('re-reads whatever the deployment rules catch, not a fixed family list', async () => {
    // The read pass carries no family list of its own: it runs the deployed rule
    // set. That is what lets a rule added later — a new credential shape, say —
    // still protect a row written before the rule existed.
    const legacy = await harnessWith({ redact: false })
    legacy.ctx.telemetry.trackError({
      pluginId: 'memo',
      action: 'analyze',
      error: {
        code: 'HTTP',
        message: 'GET https://api.example.com/v1/items?token=abc123def456 failed, call 13800138000',
        featureCodeRef: 'memo:analyze',
      },
    })
    await legacy.ctx.telemetry.flush()
    const root = legacy.root
    await legacy.disposeKeepRoot()
    harnesses.splice(harnesses.indexOf(legacy), 1)

    const reopened = await setupHarness(root, {
      redactionRules: [
        { name: 'query-token', pattern: '[?&](?:token|sig|signature|key)=[^\\s&]+' },
        { name: 'cn-mobile', pattern: '\\b1[3-9]\\d{9}\\b' },
      ],
    })
    harnesses.push(reopened)

    const group = reopened.ctx.telemetry.analyzeForPlugin('memo').failureGroups[0]!
    expect(group.latest.error?.message)
      .toBe('GET https://api.example.com/v1/items[redacted:query-token] failed, call [redacted:cn-mobile]')
  })
})

describe('TelemetryService durability', () => {
  it('survives a cold restart', async () => {
    const first = await setupHarness()
    harnesses.push(first)
    first.ctx.telemetry.track({ pluginId: 'memo', action: 'addEntry' })
    first.ctx.telemetry.trackError({
      pluginId: 'memo', action: 'analyze',
      error: { code: 'LLM_FAILURE', message: 'timeout', featureCodeRef: 'memo:analyze' },
    })
    await first.ctx.telemetry.flush()
    // Verify events are readable before disposing
    expect(first.ctx.telemetry.listEvents({ pluginId: 'memo' })).toHaveLength(2)
    await first.disposeKeepRoot()

    const second = await setupHarness(first.root)
    harnesses.push(second)
    const events = second.ctx.telemetry.listEvents({ pluginId: 'memo' })
    expect(events).toHaveLength(2)
    expect(events.some(e => e.result === 'success' && e.action === 'addEntry')).toBe(true)
    expect(events.some(e => e.result === 'failure' && e.error?.featureCodeRef === 'memo:analyze')).toBe(true)
  })
})

describe('TelemetryService durable-write retry', () => {
  // The race this guards is real but external (an antivirus or indexer holding
  // the unit file open while the JSON backend renames over it), so the harness
  // injects the exact errno the rename produces instead of waiting for it.
  it('replays an EPERM write instead of dropping the event', async () => {
    const h = await setupHarness(undefined, { storageWriteRetryDelayMs: 1 }, { flakyWriteFailures: 2 })
    harnesses.push(h)
    h.ctx.telemetry.track({ pluginId: 'memo', action: 'addEntry' })
    await h.ctx.telemetry.flush()

    expect(h.ctx.telemetry.listEvents({ pluginId: 'memo' })).toHaveLength(1)
    // Two failures, then the success.
    expect(h.flakyWrites?.attempts).toBe(3)
  })

  it('stops at the configured attempt budget and drops the event', async () => {
    const h = await setupHarness(
      undefined,
      { storageWriteRetries: 2, storageWriteRetryDelayMs: 1 },
      { flakyWriteFailures: 5 },
    )
    harnesses.push(h)
    h.ctx.telemetry.track({ pluginId: 'memo', action: 'addEntry' })
    await expect(h.ctx.telemetry.flush()).rejects.toMatchObject({ code: 'EPERM' })

    // One initial attempt plus two retries, then the fire-and-forget write is
    // dropped exactly as a permanently failing medium would drop it.
    expect(h.ctx.telemetry.listEvents({ pluginId: 'memo' })).toHaveLength(0)
    expect(h.flakyWrites?.attempts).toBe(3)
  })

  it('does not replay a non-transient filesystem failure', async () => {
    const h = await setupHarness(
      undefined,
      { storageWriteRetries: 4, storageWriteRetryDelayMs: 1 },
      { flakyWriteFailures: 1, flakyWriteCode: 'EACCES' },
    )
    harnesses.push(h)
    h.ctx.telemetry.track({ pluginId: 'memo', action: 'addEntry' })
    await expect(h.ctx.telemetry.flush()).rejects.toMatchObject({ code: 'EACCES' })

    // EACCES is a real permission problem, not the rename race: sleeping on it
    // would only delay the report.
    expect(h.ctx.telemetry.listEvents({ pluginId: 'memo' })).toHaveLength(0)
    expect(h.flakyWrites?.attempts).toBe(1)
  })

  it('does not replay when retries are disabled', async () => {
    const h = await setupHarness(
      undefined,
      { storageWriteRetries: 0, storageWriteRetryDelayMs: 1 },
      { flakyWriteFailures: 1 },
    )
    harnesses.push(h)
    h.ctx.telemetry.track({ pluginId: 'memo', action: 'addEntry' })
    await expect(h.ctx.telemetry.flush()).rejects.toMatchObject({ code: 'EPERM' })

    // `0` means one attempt, so a deployment can opt out of the extra latency.
    expect(h.flakyWrites?.attempts).toBe(1)
  })
})
