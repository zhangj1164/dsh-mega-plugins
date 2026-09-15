import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
    expect(ctx.telemetry.listEvents({ pluginId: 'memo', limit: 2 })).toHaveLength(2)
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