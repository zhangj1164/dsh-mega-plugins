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