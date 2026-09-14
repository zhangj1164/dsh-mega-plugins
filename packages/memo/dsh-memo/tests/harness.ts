import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import MemoService from '../src/index.ts'

/** One text-delta chunk as the memo service consumes it. */
export interface MockTextDelta { readonly type: 'text-delta'; readonly text: string }

/** A terminal successful finish chunk. */
export interface MockFinishStop { readonly type: 'finish'; readonly reason: { readonly kind: 'stop' } }

/** A terminal failure finish chunk, as DSH normalizes every adapter failure. */
export interface MockFinishError {
  readonly type: 'finish'
  readonly reason: {
    readonly kind: 'error' | 'aborted'
    readonly failure: { readonly code: string; readonly message: string; readonly status?: number }
  }
}

/** Any chunk the mock can yield. */
export type MockChunk = MockTextDelta | MockFinishStop | MockFinishError

/**
 * The route the harness registers on the mock LLM service. A `provider` the
 * deployment did not register is exactly the production failure mode
 * (`NO_ADAPTER`), so the mock reproduces it instead of accepting anything.
 */
export const TEST_ROUTE = { provider: 'test-provider', model: 'test-model' } as const

/** Options controlling how the mock LLM service answers one call. */
export interface MockLlmOptions {
  /** The one route this mock has registered. */
  readonly route?: { readonly provider: string; readonly model: string }
  /** Configured answer shape; defaults to one text-delta then `stop`. */
  readonly behaviour?: 'text' | 'empty' | 'route-error'
  /** Failure code and message used by the `route-error` behaviour. */
  readonly failure?: { readonly code: string; readonly message: string; readonly status?: number }
}

/**
 * Mock LLM service that behaves like the real DSH runtime: it only knows the
 * routes it registered, and it normalizes an unknown provider or a failed
 * stream into a terminal `finish` chunk carrying an {@link MockFinishError}
 * reason. Ignoring the requested route is what previously let a hardcoded,
 * unregistered provider pass every test.
 */
export class MockLlmService extends Service {
  private readonly route: { provider: string; model: string }
  private readonly behaviour: 'text' | 'empty' | 'route-error'
  private readonly failure: { code: string; message: string; status?: number }

  constructor(ctx: Context, options: MockLlmOptions = {}) {
    super(ctx, 'llm')
    this.route = options.route ?? TEST_ROUTE
    this.behaviour = options.behaviour ?? 'text'
    this.failure = options.failure ?? { code: 'NO_ADAPTER', message: 'no adapter registered for provider' }
  }

  stream(options: { readonly provider?: string; readonly model?: string }): AsyncIterable<MockChunk> {
    const provider = options.provider ?? ''
    const model = options.model ?? ''
    if (provider !== this.route.provider || model !== this.route.model) {
      const failure = {
        code: 'NO_ADAPTER',
        message: `no adapter registered for provider "${provider}"`,
      }
      return chunkStream([{ type: 'finish', reason: { kind: 'error', failure } }])
    }
    if (this.behaviour === 'route-error') {
      return chunkStream([{ type: 'finish', reason: { kind: 'error', failure: this.failure } }])
    }
    if (this.behaviour === 'empty') {
      return chunkStream([{ type: 'finish', reason: { kind: 'stop' } }])
    }
    return chunkStream([
      { type: 'text-delta', text: '# Work Report\n\n- entry 1\n- entry 2' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  }
}

/** Wrap a fixed chunk list in the async iterable the LLM contract returns. */
function chunkStream(chunks: readonly MockChunk[]): AsyncIterable<MockChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
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

/** Harness options: the mock LLM answer shape, and the memo service Config. */
export interface SetupOptions {
  /** How the mock LLM service answers. */
  readonly llm?: MockLlmOptions
  /**
   * Extra memo `Config` fields. The harness always pins `provider`/`model` to
   * {@link TEST_ROUTE} so the service resolves a route the mock registered.
   */
  readonly config?: { readonly provider?: string; readonly model?: string }
}

export async function setupHarness(options: SetupOptions = {}): Promise<TestHarness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memo-test-'))
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(MockLlmService, options.llm ?? {})
    await ctx.plugin(MockTelemetryService)
    await ctx.plugin(MockGithubIssueService)
    await ctx.plugin(MemoService, {
      repoUrl: 'https://github.com/test/repo',
      provider: options.config?.provider ?? TEST_ROUTE.provider,
      model: options.config?.model ?? TEST_ROUTE.model,
    })
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
