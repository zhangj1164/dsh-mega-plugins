/**
 * The configuration contract a Settings surface depends on.
 *
 * `@deepseek-ai/dsh-settings` projects only fields below a `.volatile()` node,
 * so a field that loses its volatile marker silently disappears from the
 * Settings panel. The first test pins that: every top-level field of the memo
 * schema must stay volatile, and a field added later without the marker fails
 * here rather than in the panel.
 *
 * The second test pins the other half of the contract — the one a volatile
 * marker alone does not buy. `cordis-plugin-loader` commits a volatile-only
 * config change by updating the existing refs in place (no remount), so the
 * service must read each value at the point of use. A field copied into an
 * instance property in the constructor would pass every other test in this
 * suite and still serve the value the plugin started with, which is exactly the
 * bug this file exists to catch.
 *
 * @module @zhangj1164/dsh-memo/tests/config-volatile
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createVolatile, updateVolatile, type Volatile } from '@deepseek-ai/cosmokit'
import { Config, MemoService } from '../src/index.ts'
import { setupHarness, type TestHarness } from './harness.ts'

/** The runtime shape of a schemastery node, which its public types do not expose. */
interface SchemaNode {
  readonly meta?: { readonly volatile?: boolean }
  readonly dict?: Record<string, SchemaNode>
}

/** Harnesses opened by one test, disposed afterwards. */
let harnesses: TestHarness[] = []

beforeEach(() => { harnesses = [] })

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(async h => h.dispose()))
})

/**
 * Open a harness and remember it for disposal.
 * @param options - the harness options.
 * @returns the opened harness.
 */
async function harness(options: Parameters<typeof setupHarness>[0] = {}): Promise<TestHarness> {
  const h = await setupHarness(options)
  harnesses.push(h)
  return h
}

/** Wait for fire-and-forget KV writes to settle. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 200))
}

describe('memo Config volatility', () => {
  it('marks every top-level field volatile, so the Settings panel can edit it', () => {
    const fields = (Config as unknown as SchemaNode).dict ?? {}
    expect(Object.keys(fields).sort()).toEqual([
      'logAnalysisPlugins',
      'model',
      'provider',
      'repoUrl',
      'sessionSummaryLanguage',
      'sessionSummaryMaxChars',
      'sessionSummaryMaxCharsLimit',
      'sessionSummaryMaxSessions',
      'sessionSummaryPrompt',
      'sessionSummarySourceTemplate',
      'sessionSummaryTranscriptMaxChars',
      'storageWriteRetries',
      'storageWriteRetryDelayMs',
    ])
    const notVolatile = Object.entries(fields)
      .filter(([, node]) => node.meta?.volatile !== true)
      .map(([name]) => name)
    expect(notVolatile).toEqual([])
  })

  it('serves a route committed in place on the next call, without a remount', async () => {
    const { ctx } = await harness({ config: { provider: 'first-route', model: 'first-model' } })
    const week = await ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) throw new Error('current week was not created')
    await ctx.memo.addEntry({ weekId: week.value.weekId, type: 'text', content: 'work' })
    await settle()

    /** Reproduce what the Loader does on a volatile-only write: commit into the same ref. */
    const commit = (ref: Volatile<unknown> | undefined, value: string): void => {
      if (ref === undefined) throw new Error('config ref is missing')
      updateVolatile(ref, createVolatile(value))
    }
    commit((ctx.memo as MemoService).config.provider as Volatile<unknown> | undefined, 'second-route')
    commit((ctx.memo as MemoService).config.model as Volatile<unknown> | undefined, 'second-model')

    const result = await ctx.memo.analyze({
      period: 'week',
      periodLabel: week.value.weekId,
      analysisType: '\u603b\u7ed3',
    })
    expect(result.ok).toBe(false)
    if (result.ok || result.error.code !== 'llm-failure') throw new Error('expected an llm-failure')
    // The unregistered route proves the call used the committed values rather
    // than the ones the service was constructed with.
    expect(result.error.failureCode).toBe('NO_ADAPTER')
    expect(result.error.provider).toBe('second-route')
    expect(result.error.model).toBe('second-model')
  })
})
