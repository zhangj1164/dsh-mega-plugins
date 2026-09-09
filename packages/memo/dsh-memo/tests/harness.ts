import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import MemoService from '../src/index.ts'

/** Mock LLM service that yields one text-delta then a finish. */
class MockLlmService extends Service {
  constructor(ctx: Context) { super(ctx, 'llm') }
  stream(_options: unknown) {
    const text = '# Work Report\n\n- entry 1\n- entry 2'
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'text-delta', text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
  }
}

/** Mock telemetry service with no-op tracking. */
class MockTelemetryService extends Service {
  constructor(ctx: Context) { super(ctx, 'telemetry') }
  track(_input: unknown): void {}
  trackError(_input: unknown): void {}
  listEvents(_query: unknown): never[] { return [] }
  analyzeForPlugin(_pluginId: string) {
    return { pluginId: _pluginId, totalEvents: 0, totalFailures: 0, failureGroups: [] }
  }
}

/** Mock github-issue service with stub methods. */
class MockGithubIssueService extends Service {
  constructor(ctx: Context) { super(ctx, 'githubIssue') }
  async generateReport(_request: unknown) {
    return { ok: true, value: { title: 'Test Report', body: 'Report body', labels: ['bug'] } }
  }
  prefilledIssueUrl(_request: unknown) {
    return { ok: true, value: 'https://github.com/test/repo/issues/new?title=Test' }
  }
  async optimizeIssue(_request: unknown) {
    return { ok: true, value: { title: 'Optimized Title', body: 'Optimized body', labels: ['bug'] } }
  }
}

export interface TestHarness {
  readonly ctx: Context
  readonly root: string
  dispose(): Promise<void>
}

export async function setupHarness(): Promise<TestHarness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memo-test-'))
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(MockLlmService)
    await ctx.plugin(MockTelemetryService)
    await ctx.plugin(MockGithubIssueService)
    await ctx.plugin(MemoService, { repoUrl: 'https://github.com/test/repo' })
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
  return {
    ctx,
    root,
    async dispose() {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
