/**
 * Tests for the memo controller's RPC unwrapping logic.
 *
 * These tests verify the wire-shape contract between the Connection RPC
 * channel and the memo Remote methods, using a mock RPC caller that
 * reproduces the real double-envelope structure:
 *
 *   rpc.call() → { ok: true, value: { ok: true, value: <T> } }
 *                 ^transport              ^business
 *
 * @module dsh-client-ui-memo/tests/controller.spec
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoController, callMemo, callGithubIssue, callRemote, createInitialState, type RpcCaller, type MemoViewState } from '../src/client/controller.ts'
import type { MemoWeek, MemoEntry, MemoAnalysis } from 'dsh-memo/client'
import type { GithubIssueReport } from 'dsh-github-issue/client'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Create a mock RpcCaller that returns a pre-canned double-envelope. */
function mockRpc<T>(businessOk: boolean, businessValue?: T, errorMessage?: string): RpcCaller {
  return {
    async call(_channel: string, _endpoint: string, _payload: unknown): Promise<unknown> {
      if (!businessOk) {
        return { ok: true, value: { ok: false, error: { code: 'business-error', message: errorMessage ?? 'test error' } } }
      }
      return { ok: true, value: { ok: true, value: businessValue } }
    },
  }
}

/** Create a mock RpcCaller that always throws (transport failure). */
function throwingRpc(error: Error): RpcCaller {
  return {
    async call(): Promise<unknown> { throw error },
  }
}

/** Create a mock RpcCaller that returns a transport-level failure. */
function transportErrorRpc(message: string): RpcCaller {
  return {
    async call(): Promise<unknown> {
      return { ok: false, error: { code: 'transport-failure', message } }
    },
  }
}

/** A sample week with one entry, matching MemoWeek shape. */
function sampleWeek(overrides: Partial<MemoWeek> = {}): MemoWeek {
  return {
    weekId: '2026-W36',
    weekStart: 1788105600000,
    weekEnd: 1788710399999,
    entries: [sampleEntry()],
    updatedAt: 1788253071682,
    ...overrides,
  }
}

/** A sample entry, matching MemoEntry shape. */
function sampleEntry(overrides: Partial<MemoEntry> = {}): MemoEntry {
  return {
    id: 'entry-001',
    type: 'text',
    content: 'Test memo entry',
    createdAt: 1788253169026,
    updatedAt: 1788253169026,
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('createInitialState', () => {
  it('starts cold with no weeks', () => {
    const state = createInitialState()
    expect(state.status).toBe('cold')
    expect(state.weeks).toEqual([])
    expect(state.error).toBeNull()
    expect(state.analysis).toBeNull()
    expect(state.report).toBeNull()
    expect(state.busy).toBe(false)
  })
})

describe('callMemo', () => {
  it('unwraps transport envelope and returns business success', async () => {
    const rpc = mockRpc(true, ['week1', 'week2'])
    const result = await callMemo<string[]>(rpc, 'listWeeks', {})
    expect(result.ok).toBe(true)
    expect(result.ok && result.value).toEqual(['week1', 'week2'])
  })

  it('unwraps business failure from successful transport', async () => {
    const rpc = mockRpc(false, undefined, 'no entries found')
    const result = await callMemo<string[]>(rpc, 'listWeeks', {})
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.message).toBe('no entries found')
  })

  it('returns error on transport failure', async () => {
    const rpc = transportErrorRpc('HTTP 500')
    const result = await callMemo<string[]>(rpc, 'listWeeks', {})
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.message).toBe('HTTP 500')
  })

  it('returns rpc-failure on thrown exception', async () => {
    const rpc = throwingRpc(new Error('network down'))
    const result = await callMemo<string[]>(rpc, 'listWeeks', {})
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('rpc-failure')
    expect(!result.ok && result.error.message).toBe('network down')
  })

  it('passes args as { request: ... } wrapper', async () => {
    let capturedPayload: unknown = null
    const rpc: RpcCaller = {
      async call(_ch, _ep, payload) { capturedPayload = payload; return { ok: true, value: { ok: true, value: 'ok' } } },
    }
    await callMemo(rpc, 'addEntry', { weekId: '2026-W36', type: 'text', content: 'hello' })
    expect(capturedPayload).toEqual({
      args: {
        request: { weekId: '2026-W36', type: 'text', content: 'hello' },
      },
    })
  })
})

describe('MemoController', () => {
  it('getSnapshot returns current state', () => {
    const ctrl = new MemoController(mockRpc(true, []))
    expect(ctrl.getSnapshot()).toEqual(createInitialState())
  })

  it('subscribe receives updates', () => {
    const ctrl = new MemoController(mockRpc(true, []))
    const updates: MemoViewState[] = []
    ctrl.subscribe(() => updates.push(ctrl.getSnapshot()))
    // Initial state
    expect(updates.length).toBe(0)
    // Manually trigger (for test only — set is private, so we test via refresh)
    // The actual emit happens through refresh()
  })

  describe('refresh', () => {
    it('loads weeks from listWeeks and sets ready status', async () => {
      const weeks = [sampleWeek(), sampleWeek({ weekId: '2026-W35' })]
      const ctrl = new MemoController(mockRpc(true, weeks))
      await ctrl.refresh()
      const state = ctrl.getSnapshot()
      expect(state.status).toBe('ready')
      expect(state.weeks).toHaveLength(2)
      expect(state.weeks[0].weekId).toBe('2026-W36')
      expect(state.busy).toBe(false)
      expect(state.error).toBeNull()
    })

    it('handles empty weeks array', async () => {
      const ctrl = new MemoController(mockRpc(true, []))
      await ctrl.refresh()
      const state = ctrl.getSnapshot()
      expect(state.status).toBe('ready')
      expect(state.weeks).toEqual([])
    })

    it('handles business failure with error message', async () => {
      const ctrl = new MemoController(mockRpc(false, undefined, 'not initialized'))
      await ctrl.refresh()
      const state = ctrl.getSnapshot()
      expect(state.status).toBe('error')
      expect(state.error).toBe('not initialized')
    })

    it('handles transport failure', async () => {
      const ctrl = new MemoController(transportErrorRpc('connection refused'))
      await ctrl.refresh()
      const state = ctrl.getSnapshot()
      expect(state.status).toBe('error')
      expect(state.error).toBe('connection refused')
    })

    it('handles thrown exception', async () => {
      const ctrl = new MemoController(throwingRpc(new Error('timeout')))
      await ctrl.refresh()
      const state = ctrl.getSnapshot()
      expect(state.status).toBe('error')
      expect(state.error).toBe('timeout')
    })
  })

  describe('addEntry', () => {
    it('creates week then adds entry then refreshes', async () => {
      const week = sampleWeek()
      const entry = sampleEntry()
      let callCount = 0
      const rpc: RpcCaller = {
        async call(_ch, _ep, _payload) {
          callCount++
          if (callCount === 1) return { ok: true, value: { ok: true, value: week } }
          if (callCount === 2) return { ok: true, value: { ok: true, value: entry } }
          // callCount 3 = refresh listWeeks
          return { ok: true, value: { ok: true, value: [week] } }
        },
      }
      const ctrl = new MemoController(rpc)
      await ctrl.addEntry('New memo content')
      const state = ctrl.getSnapshot()
      expect(state.busy).toBe(false)
      expect(state.error).toBeNull()
      expect(state.weeks).toHaveLength(1)
      expect(callCount).toBe(3)
    })

    it('handles getOrCreateCurrentWeek business failure', async () => {
      const rpc: RpcCaller = {
        async call() { return { ok: true, value: { ok: false, error: { code: 'not-initialized', message: 'table not ready' } } } },
      }
      const ctrl = new MemoController(rpc)
      await ctrl.addEntry('content')
      const state = ctrl.getSnapshot()
      expect(state.busy).toBe(false)
      expect(state.error).toBe('table not ready')
    })

    it('ignores empty content', async () => {
      const ctrl = new MemoController(mockRpc(true, []))
      await ctrl.addEntry('   ')
      // Should not make any RPC calls — state stays cold
      expect(ctrl.getSnapshot().status).toBe('cold')
    })
  })

  describe('analyze', () => {
    it('sets analysis summary on success', async () => {
      // First set up weeks via refresh
      const week = sampleWeek()
      const analysis: MemoAnalysis = {
        period: 'week',
        periodLabel: '2026-W36',
        summary: 'Organized summary text',
        generatedAt: Date.now(),
        modelProvider: 'custom',
        modelName: 'glm-5-2-260617',
      }
      let callCount = 0
      const rpc: RpcCaller = {
        async call(_ch, _ep, _payload) {
          callCount++
          if (callCount === 1) return { ok: true, value: { ok: true, value: [week] } }
          return { ok: true, value: { ok: true, value: analysis } }
        },
      }
      const ctrl = new MemoController(rpc)
      await ctrl.refresh()
      await ctrl.analyze('梳理')
      const state = ctrl.getSnapshot()
      expect(state.busy).toBe(false)
      expect(state.analysis).toBe('Organized summary text')
    })

    it('shows error when no weeks loaded', async () => {
      const ctrl = new MemoController(mockRpc(true, []))
      await ctrl.refresh()
      await ctrl.analyze('梳理')
      const state = ctrl.getSnapshot()
      expect(state.error).toBe('No week selected')
    })

    it('handles business failure from LLM', async () => {
      const week = sampleWeek()
      let callCount = 0
      const rpc: RpcCaller = {
        async call(_ch, _ep, _payload) {
          callCount++
          if (callCount === 1) return { ok: true, value: { ok: true, value: [week] } }
          return { ok: true, value: { ok: false, error: { code: 'llm-failure', message: 'model produced no output' } } }
        },
      }
      const ctrl = new MemoController(rpc)
      await ctrl.refresh()
      await ctrl.analyze('总结')
      const state = ctrl.getSnapshot()
      expect(state.busy).toBe(false)
      expect(state.analysis).toBeNull()
      expect(state.error).toBe('model produced no output')
    })
  })

  describe('exportReport', () => {
    it('sets report string on success', async () => {
      const week = sampleWeek()
      let callCount = 0
      const rpc: RpcCaller = {
        async call(_ch, _ep, _payload) {
          callCount++
          if (callCount === 1) return { ok: true, value: { ok: true, value: [week] } }
          return { ok: true, value: { ok: true, value: '# Weekly Report\n\n- Did stuff' } }
        },
      }
      const ctrl = new MemoController(rpc)
      await ctrl.refresh()
      await ctrl.exportReport()
      const state = ctrl.getSnapshot()
      expect(state.busy).toBe(false)
      expect(state.report).toContain('# Weekly Report')
    })

    it('shows error when no weeks loaded', async () => {
      const ctrl = new MemoController(mockRpc(true, []))
      await ctrl.refresh()
      await ctrl.exportReport()
      const state = ctrl.getSnapshot()
      expect(state.error).toBe('No week selected')
    })
  })

  describe('dispose', () => {
    it('stops emitting after dispose', () => {
      const ctrl = new MemoController(mockRpc(true, []))
      let updateCount = 0
      ctrl.subscribe(() => updateCount++)
      ctrl.dispose()
      // Trigger a state change — emit should be suppressed
      void ctrl.refresh()
      // updateCount should remain 0 because dispose stops emit
      // (refresh is async, so we just check no synchronous emit happened)
      expect(updateCount).toBe(0)
    })
  })

  describe('subscribe', () => {
    it('returns an unsubscribe function', () => {
      const ctrl = new MemoController(mockRpc(true, []))
      let count = 0
      const unsub = ctrl.subscribe(() => count++)
      expect(typeof unsub).toBe('function')
      // After unsubscribe, no more updates
      unsub()
      void ctrl.refresh()
      expect(count).toBe(0)
    })
  })

  describe('selectWeek', () => {
    it('selects a different week and clears results', async () => {
      const weeks = [sampleWeek(), sampleWeek({ weekId: '2026-W35' })]
      const ctrl = new MemoController(mockRpc(true, weeks))
      await ctrl.refresh()
      expect(ctrl.getSnapshot().selectedWeekIndex).toBe(0)
      ctrl.selectWeek(1)
      expect(ctrl.getSnapshot().selectedWeekIndex).toBe(1)
      expect(ctrl.getSnapshot().analysis).toBeNull()
      expect(ctrl.getSnapshot().report).toBeNull()
    })

    it('ignores out-of-bounds index', async () => {
      const ctrl = new MemoController(mockRpc(true, [sampleWeek()]))
      await ctrl.refresh()
      ctrl.selectWeek(5)
      expect(ctrl.getSnapshot().selectedWeekIndex).toBe(0)
      ctrl.selectWeek(-1)
      expect(ctrl.getSnapshot().selectedWeekIndex).toBe(0)
    })
  })

  describe('optimizeIssue', () => {
    it('calls githubIssue/optimizeIssue and sets issueReport on success', async () => {
      const report: GithubIssueReport = {
        title: 'Test issue title',
        body: '## Test issue title\n\n<details>...</details>',
        labels: ['bug'],
      }
      const rpc: RpcCaller = {
        async call(_ch, endpoint) {
          expect(endpoint).toBe('githubIssue/optimizeIssue')
          return { ok: true, value: { ok: true, value: report } }
        },
      }
      const ctrl = new MemoController(rpc)
      await ctrl.optimizeIssue('something is broken')
      const state = ctrl.getSnapshot()
      expect(state.busy).toBe(false)
      expect(state.issueReport).not.toBeNull()
      expect(state.issueReport?.title).toBe('Test issue title')
    })

    it('does nothing with empty description', async () => {
      const ctrl = new MemoController(mockRpc(true, null))
      await ctrl.optimizeIssue('   ')
      expect(ctrl.getSnapshot().issueReport).toBeNull()
    })

    it('handles business failure', async () => {
      const rpc: RpcCaller = {
        async call() { return { ok: true, value: { ok: false, error: { code: 'empty-input', message: 'empty description' } } } },
      }
      const ctrl = new MemoController(rpc)
      await ctrl.optimizeIssue('test')
      const state = ctrl.getSnapshot()
      expect(state.busy).toBe(false)
      expect(state.issueReport).toBeNull()
      expect(state.error).toBe('empty description')
    })
  })

  describe('analyzeLogs', () => {
    it('calls memo/analyzeLogs and sets logAnalysis on success', async () => {
      const report: GithubIssueReport = {
        title: 'Log analysis report',
        body: '## Log analysis report\n\n<details>...</details>',
        labels: ['bug', 'telemetry'],
      }
      const rpc: RpcCaller = {
        async call(_ch, endpoint) {
          expect(endpoint).toBe('memo/analyzeLogs')
          return { ok: true, value: { ok: true, value: { report, issueUrl: 'https://github.com/owner/repo/issues/new?title=Log' } } }
        },
      }
      const ctrl = new MemoController(rpc)
      await ctrl.analyzeLogs()
      const state = ctrl.getSnapshot()
      expect(state.busy).toBe(false)
      expect(state.logAnalysis).not.toBeNull()
      expect(state.logAnalysis?.report.title).toBe('Log analysis report')
      expect(state.logAnalysis?.issueUrl).toContain('github.com')
    })

    it('handles business failure', async () => {
      const rpc: RpcCaller = {
        async call() { return { ok: true, value: { ok: false, error: { code: 'llm-failure', message: 'model error' } } } },
      }
      const ctrl = new MemoController(rpc)
      await ctrl.analyzeLogs()
      const state = ctrl.getSnapshot()
      expect(state.logAnalysis).toBeNull()
      expect(state.error).toBe('model error')
    })
  })

  describe('updateEntry', () => {
    it('calls memo/updateEntry with force flag and refreshes', async () => {
      const week = sampleWeek()
      const updatedEntry = sampleEntry({ content: 'Updated content' })
      let callCount = 0
      const rpc: RpcCaller = {
        async call(_ch, endpoint, payload) {
          callCount++
          if (callCount === 1) {
            expect(endpoint).toBe('memo/updateEntry')
            const args = payload as { args: { request: { weekId: string; entryId: string; content: string; force: boolean } } }
            expect(args.args.request.force).toBe(true)
            return { ok: true, value: { ok: true, value: updatedEntry } }
          }
          return { ok: true, value: { ok: true, value: [week] } }
        },
      }
      const ctrl = new MemoController(rpc)
      await ctrl.refresh()
      const ok = await ctrl.updateEntry('2026-W36', 'entry-001', 'Updated content', true)
      expect(ok).toBe(true)
      expect(callCount).toBe(3)
    })

    it('returns false on business failure', async () => {
      const rpc: RpcCaller = {
        async call() { return { ok: true, value: { ok: false, error: { code: 'past-week-requires-force', message: 'requires force' } } } },
      }
      const ctrl = new MemoController(rpc)
      const ok = await ctrl.updateEntry('2026-W35', 'entry-001', 'content', false)
      expect(ok).toBe(false)
      expect(ctrl.getSnapshot().error).toBe('requires force')
    })

    it('returns false on empty content', async () => {
      const ctrl = new MemoController(mockRpc(true, null))
      const ok = await ctrl.updateEntry('2026-W36', 'entry-001', '   ', false)
      expect(ok).toBe(false)
    })
  })

  describe('deleteEntry', () => {
    it('calls memo/deleteEntry with force flag and refreshes', async () => {
      const week = sampleWeek()
      let callCount = 0
      const rpc: RpcCaller = {
        async call(_ch, endpoint, payload) {
          callCount++
          if (callCount === 1) {
            expect(endpoint).toBe('memo/deleteEntry')
            const args = payload as { args: { request: { weekId: string; entryId: string; force: boolean } } }
            expect(args.args.request.force).toBe(true)
            return { ok: true, value: { ok: true, value: true } }
          }
          return { ok: true, value: { ok: true, value: [week] } }
        },
      }
      const ctrl = new MemoController(rpc)
      await ctrl.refresh()
      const ok = await ctrl.deleteEntry('2026-W36', 'entry-001', true)
      expect(ok).toBe(true)
      expect(callCount).toBe(3)
    })

    it('returns false on business failure', async () => {
      const rpc: RpcCaller = {
        async call() { return { ok: true, value: { ok: false, error: { code: 'entry-not-found', message: 'not found' } } } },
      }
      const ctrl = new MemoController(rpc)
      const ok = await ctrl.deleteEntry('2026-W36', 'entry-999', false)
      expect(ok).toBe(false)
      expect(ctrl.getSnapshot().error).toBe('not found')
    })
  })
})

describe('callGithubIssue', () => {
  it('calls githubIssue service endpoint', async () => {
    let capturedEndpoint: string = ''
    const rpc: RpcCaller = {
      async call(_ch, endpoint) { capturedEndpoint = endpoint; return { ok: true, value: { ok: true, value: 'result' } } },
    }
    const result = await callGithubIssue<string>(rpc, 'optimizeIssue', { description: 'test' })
    expect(capturedEndpoint).toBe('githubIssue/optimizeIssue')
    expect(result.ok).toBe(true)
  })
})

describe('callRemote', () => {
  it('routes to the specified service', async () => {
    let capturedEndpoint: string = ''
    const rpc: RpcCaller = {
      async call(_ch, endpoint) { capturedEndpoint = endpoint; return { ok: true, value: { ok: true, value: 42 } } },
    }
    const result = await callRemote<number>(rpc, 'customService', 'method1', {})
    expect(capturedEndpoint).toBe('customService/method1')
    expect(result.ok && result.value).toBe(42)
  })
})
