import { afterEach, describe, expect, it, vi } from 'vitest'
import { localDayKey } from '../src/intake.ts'
import type { IntakeHarness } from './intake-harness.ts'
import { setupIntakeHarness } from './intake-harness.ts'

const harnesses: IntakeHarness[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(harnesses.splice(0).map(item => item.dispose()))
})

async function harness(options?: Parameters<typeof setupIntakeHarness>[0]): Promise<IntakeHarness> {
  const mounted = await setupIntakeHarness(options)
  harnesses.push(mounted)
  return mounted
}

/** A JSON response with the given status. */
function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

/** One claimable issue payload. */
function issue(number: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number,
    title: 'Issue ' + number,
    html_url: 'https://github.com/test/repo/issues/' + number,
    body: 'body ' + number,
    labels: [{ name: 'ready-for-agent' }],
    ...overrides,
  }
}

/** A fetch stub that always returns the supplied response. */
function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => json(body, status))
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('createIssue', () => {
  it('files the report without the duplicated title heading', async () => {
    const mounted = await harness()
    const fetchMock = stubFetch({ number: 12, html_url: 'https://github.com/test/repo/issues/12' }, 201)
    const result = await mounted.service.createIssue({
      report: { title: '  登录失败  ', body: '## 登录失败\n\n<details>x</details>', labels: ['bug', ''] },
    })
    expect(result).toEqual({ ok: true, value: { number: 12, url: 'https://github.com/test/repo/issues/12' } })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ title: '登录失败', body: '<details>x</details>', labels: ['bug'] })
  })

  it('rejects a report with a blank title before touching GitHub', async () => {
    const mounted = await harness()
    const fetchMock = stubFetch({})
    const result = await mounted.service.createIssue({ report: { title: '   ', body: 'x', labels: [] } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid-request')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a missing credential instead of calling GitHub', async () => {
    const mounted = await harness({ token: null })
    const fetchMock = stubFetch({})
    const result = await mounted.service.createIssue({ report: { title: 'x', body: 'y', labels: [] } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('auth-missing')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('runIntake', () => {
  it('dispatches a fresh issue, then skips it on the next pass', async () => {
    const mounted = await harness()
    stubFetch([issue(1), issue(2, { pull_request: {} }), issue(3, { labels: [{ name: 'bug' }] })])
    const first = await mounted.service.runIntake({})
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.claimable.map(item => item.number)).toEqual([1])
    expect(first.value.dispatched).toEqual([{ number: 1, sessionId: 'session-1' }])
    expect(first.value.skipped).toEqual([])
    expect(mounted.sessions?.creates).toHaveLength(1)
    expect(mounted.schedule?.created).toEqual([
      { sessionId: 'session-1', prompt: expect.stringContaining('#1'), title: 'Issue #1: Issue 1', afterSeconds: 1 },
    ])
    await vi.waitFor(() => expect(mounted.sessions?.renames).toHaveLength(1))
    expect(mounted.sessions?.renames[0]?.title).toContain('Issue #1')

    stubFetch([issue(1)])
    const second = await mounted.service.runIntake({})
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.skipped).toEqual([1])
    expect(second.value.dispatched).toEqual([])
    expect(mounted.sessions?.creates).toHaveLength(1)
  })

  it('records the local day and the dispatched issue durably', async () => {
    const mounted = await harness({ autopilotTimeZone: 'Asia/Shanghai' })
    const fetchMock = vi.fn(async () => json([issue(5)]))
    vi.stubGlobal('fetch', fetchMock)
    const result = await mounted.service.runIntake({})
    expect(result.ok).toBe(true)
    const row = mounted.storage?.rows.get('intake') as { lastCheckedDay: string; dispatched: { number: number; sessionId: string }[] } | undefined
    expect(row?.lastCheckedDay).toBe(localDayKey(Date.now(), 'Asia/Shanghai'))
    expect(row?.dispatched).toEqual([{ number: 5, day: localDayKey(Date.now(), 'Asia/Shanghai'), sessionId: 'session-1' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('forwards the Session placement and the prompt template', async () => {
    const mounted = await harness({
      autopilotCwd: 'E:\\repo',
      autopilotPreset: 'standard',
      autopilotPrompt: 'TASK {number}: {title}',
    })
    stubFetch([issue(1)])
    const result = await mounted.service.runIntake({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(mounted.sessions?.creates).toEqual([{ cwd: 'E:\\repo', agentPreset: 'standard' }])
    expect(mounted.schedule?.created[0]?.prompt).toBe('TASK 1: Issue 1')
  })

  it('does not remember a day whose listing failed', async () => {
    const mounted = await harness()
    stubFetch({ message: 'server error' }, 500)
    const result = await mounted.service.runIntake({})
    expect(result.ok).toBe(false)
    expect(mounted.storage?.rows.get('intake')).toBeUndefined()
  })

  it('registers the dispatch as a delayed automation task instead of prompting directly', async () => {
    const mounted = await harness()
    stubFetch([issue(7)])
    const result = await mounted.service.runIntake({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.dispatched).toEqual([{ number: 7, sessionId: 'session-1' }])
    expect(result.value.failures).toEqual([])
    expect(mounted.schedule?.created).toEqual([
      { sessionId: 'session-1', prompt: expect.stringContaining('#7'), title: 'Issue #7: Issue 7', afterSeconds: 1 },
    ])
    expect(mounted.sessions?.prompts).toEqual([])
  })

  it('falls back to direct prompt admission without a Schedule service', async () => {
    const mounted = await harness({ withoutSchedule: true })
    stubFetch([issue(3)])
    const result = await mounted.service.runIntake({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.dispatched).toEqual([{ number: 3, sessionId: 'session-1' }])
    expect(mounted.sessions?.prompts).toEqual([
      { requestId: 'github-issue:3:session-1', sessionId: 'session-1', mode: 'queue', text: expect.stringContaining('#3') },
    ])
  })

  it('reports a refused automation task as a dispatch failure without committing the day', async () => {
    const mounted = await harness({ scheduleCreateFails: true })
    stubFetch([issue(8)])
    const result = await mounted.service.runIntake({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.dispatched).toEqual([])
    expect(result.value.failures[0]?.code).toBe('dispatch-failed')
    expect(mounted.storage?.rows.get('intake')).toBeUndefined()
  })

  it('reports a refused fallback prompt as a dispatch failure without committing the day', async () => {
    const mounted = await harness({ withoutSchedule: true, promptFails: true })
    stubFetch([issue(9)])
    const result = await mounted.service.runIntake({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.dispatched).toEqual([])
    expect(result.value.failures[0]?.code).toBe('dispatch-failed')
    expect(mounted.storage?.rows.get('intake')).toBeUndefined()
  })

  it('leaves the day unchecked when every dispatch failed', async () => {
    const mounted = await harness({ withoutSessionServices: true })
    stubFetch([issue(1)])
    const result = await mounted.service.runIntake({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.dispatched).toEqual([])
    expect(mounted.storage?.rows.get('intake')).toBeUndefined()
    expect(mounted.telemetry.errors.map(event => event.action)).toContain('runIntake')
  })

  it('records a failure event when the durable state cannot be opened', async () => {
    const mounted = await harness({ storageOpenFails: true })
    expect(mounted.telemetry.errors.some(event => event.action === 'openIntakeState')).toBe(true)
  })

  it('keeps a dispatch failure instead of inventing a Session', async () => {
    const mounted = await harness({ withoutSessionServices: true })
    stubFetch([issue(1)])
    const result = await mounted.service.runIntake({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.dispatched).toEqual([])
    expect(result.value.failures[0]?.code).toBe('session-unavailable')
  })
})

describe('dispatchIssue', () => {
  it('refuses when the deployment mounts no Session router', async () => {
    const mounted = await harness({ withoutSessionServices: true })
    const result = await mounted.service.dispatchIssue({
      issue: { number: 1, title: 't', body: 'b', url: 'u', labels: [] },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('session-unavailable')
  })
})

describe('first-startup check', () => {
  it('does nothing when the local day was already checked', async () => {
    const today = localDayKey(Date.now(), 'UTC')
    const fetchMock = vi.fn(async () => json([issue(1)]))
    vi.stubGlobal('fetch', fetchMock)
    const mounted = await harness({
      autopilotEnabled: true,
      initialState: { lastCheckedDay: today, dispatched: [] },
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mounted.sessions?.creates).toEqual([])
  })

  it('runs one pass when the stored day is older', async () => {
    stubFetch([issue(9)])
    const mounted = await harness({
      autopilotEnabled: true,
      initialState: { lastCheckedDay: '2000-01-01', dispatched: [] },
    })
    await vi.waitFor(() => expect(mounted.schedule?.created).toHaveLength(1), { timeout: 2000 })
    expect(mounted.schedule?.created[0]?.prompt).toContain('#9')
  })

  it('reports a startup pass whose dispatch failed instead of a silent success', async () => {
    stubFetch([issue(4)])
    const mounted = await harness({
      autopilotEnabled: true,
      initialState: { lastCheckedDay: '2000-01-01', dispatched: [] },
      withoutSessionServices: true,
    })
    await vi.waitFor(
      () => expect(mounted.telemetry.errors.some(event => event.action === 'startupIntake')).toBe(true),
      { timeout: 2000 },
    )
    expect(mounted.telemetry.tracks.some(event => event.action === 'startupIntake' && event.result === 'success')).toBe(false)
    const row = mounted.storage?.rows.get('intake') as { lastCheckedDay: string } | undefined
    expect(row?.lastCheckedDay).toBe('2000-01-01')
  })

  it('stays off without durable state so it cannot dispatch twice', async () => {
    const fetchMock = vi.fn(async () => json([issue(1)]))
    vi.stubGlobal('fetch', fetchMock)
    const mounted = await harness({ autopilotEnabled: true, withoutStorage: true })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mounted.sessions?.creates).toEqual([])
  })
})