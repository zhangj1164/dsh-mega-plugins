/**
 * The configuration contract the Settings surface depends on.
 *
 * `@deepseek-ai/dsh-settings` projects only fields below a `.volatile()` node,
 * so a field that loses its volatile marker silently disappears from the
 * Settings panel. The first test pins that for the eight fields the intake page
 * edits. The second pins the other half: `cordis-plugin-loader` commits a
 * volatile-only change by updating the existing refs in place, so the service
 * must read each value where it is used, not copy it in the constructor.
 *
 * @module @zhangj1164/dsh-github-issue/tests/config-volatile
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVolatile, updateVolatile, type Volatile } from '@deepseek-ai/cosmokit'
import { Config } from '../src/index.ts'
import { setupIntakeHarness, type IntakeHarness } from './intake-harness.ts'

/** The runtime shape of a schemastery node, which its public types do not expose. */
interface SchemaNode {
  readonly meta?: { readonly volatile?: boolean }
  readonly dict?: Record<string, SchemaNode>
}

/** Harnesses opened by one test, disposed afterwards. */
let harnesses: IntakeHarness[] = []

beforeEach(() => { harnesses = [] })

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(async h => h.dispose()))
})

/**
 * Open a harness and remember it for disposal.
 * @param options - the harness options.
 * @returns the opened harness.
 */
async function harness(options: Parameters<typeof setupIntakeHarness>[0] = {}): Promise<IntakeHarness> {
  const mounted = await setupIntakeHarness(options)
  harnesses.push(mounted)
  return mounted
}

/**
 * Reproduce what the Loader does on a volatile-only write: commit into the same ref.
 * @param ref - the config field to update in place.
 * @param value - the new value.
 */
function commit<T>(ref: Volatile<T>, value: T): void {
  updateVolatile(ref, createVolatile(value))
}

/** A JSON response with the given status. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** One claimable issue payload. */
function issue(number: number): Record<string, unknown> {
  return {
    number,
    title: 'Issue ' + number,
    html_url: 'https://github.com/test/repo/issues/' + number,
    body: 'body ' + number,
    labels: [{ name: 'ready-for-agent' }],
  }
}

describe('github-issue Config volatility', () => {
  it('marks exactly the settings-editable fields volatile', () => {
    const fields = (Config as unknown as SchemaNode).dict ?? {}
    const volatile = Object.entries(fields)
      .filter(([, node]) => node.meta?.volatile === true)
      .map(([name]) => name)
      .sort()
    expect(volatile).toEqual([
      'autopilotCwd',
      'autopilotEnabled',
      'autopilotPreset',
      'autopilotPrompt',
      'autopilotTimeZone',
      'claimLabel',
      'maxIssuesPerRun',
      'repoUrl',
    ])
  })

  it('serves values committed in place on the next pass, without a remount', async () => {
    const mounted = await harness()
    const fetchMock = vi.fn(async () => json([
      { ...issue(1), labels: [{ name: 'agent-take' }] },
      { ...issue(2), labels: [{ name: 'agent-take' }] },
    ]))
    vi.stubGlobal('fetch', fetchMock)

    commit(mounted.service.config.claimLabel, 'agent-take')
    commit(mounted.service.config.maxIssuesPerRun, 1)
    commit(mounted.service.config.autopilotCwd, 'E:/elsewhere')
    commit(mounted.service.config.autopilotPrompt, 'TASK {number}')

    const result = await mounted.service.runIntake({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.dispatched.map(item => item.number)).toEqual([1])
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('labels=agent-take')
    expect(mounted.sessions?.creates).toEqual([{ cwd: 'E:/elsewhere' }])
    expect(mounted.agents?.followups[0]?.text).toBe('TASK 1')
  })

  it('falls back to the host zone instead of throwing on an invalid zone', async () => {
    const mounted = await harness({ autopilotTimeZone: 'Not/AZone' })
    vi.stubGlobal('fetch', vi.fn(async () => json([])))
    const result = await mounted.service.runIntake({})
    expect(result.ok).toBe(true)
    const row = mounted.storage?.rows.get('intake') as { lastCheckedDay: string } | undefined
    expect(row?.lastCheckedDay).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
  })
})
