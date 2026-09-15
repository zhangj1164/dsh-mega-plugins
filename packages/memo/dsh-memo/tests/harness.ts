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
  /** Display name reported for {@link MockLlmOptions.route}; defaults to its id. */
  readonly providerName?: string
  /** Configured answer shape; defaults to one text-delta then `stop`. */
  readonly behaviour?: 'text' | 'empty' | 'route-error'
  /** Failure code and message used by the `route-error` behaviour. */
  readonly failure?: { readonly code: string; readonly message: string; readonly status?: number }
  /** Models the registered route advertises; defaults to two entries. */
  readonly catalog?: readonly { readonly id: string; readonly name: string }[]
  /** When set, `listModels` rejects with this message instead of answering. */
  readonly catalogThrows?: string
  /**
   * Further registered routes, each with its own display name, catalog, and
   * optional failure.
   *
   * A test needs these to tell "the whole registry" apart from "the one route
   * the deployment happens to default to", which is the difference this mock
   * exists to make visible.
   */
  readonly extraProviders?: readonly {
    readonly id: string
    readonly name?: string
    readonly models: readonly { readonly id: string; readonly name: string }[]
    /** When set, listing this provider's models rejects with this message. */
    readonly throws?: string
  }[]
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
  private readonly registry: readonly {
    readonly id: string
    readonly name: string
    readonly models: readonly { readonly id: string; readonly name: string }[]
    readonly throws?: string
  }[]

  constructor(ctx: Context, options: MockLlmOptions = {}) {
    super(ctx, 'llm')
    this.route = options.route ?? TEST_ROUTE
    this.behaviour = options.behaviour ?? 'text'
    this.failure = options.failure ?? { code: 'NO_ADAPTER', message: 'no adapter registered for provider' }
    const primaryModels = options.catalog ?? [
      { id: this.route.model, name: 'Test Model' },
      { id: 'test-model-pro', name: 'Test Model Pro' },
    ]
    this.registry = [
      {
        id: this.route.provider,
        name: options.providerName ?? this.route.provider,
        models: primaryModels,
        ...(options.catalogThrows === undefined ? {} : { throws: options.catalogThrows }),
      },
      ...(options.extraProviders ?? []).map(entry => ({
        id: entry.id,
        name: entry.name ?? entry.id,
        models: entry.models,
        ...(entry.throws === undefined ? {} : { throws: entry.throws }),
      })),
    ]
  }

  /**
   * Describe the routes this mock registered, in registration order.
   * @returns provider ids and display names, exactly as DSH would report them.
   */
  listProviders(): readonly { readonly id: string; readonly name: string }[] {
    return this.registry.map(entry => ({ id: entry.id, name: entry.name }))
  }

  /**
   * Advertise the models of one provider route.
   *
   * A provider this mock never registered answers with an empty catalog rather
   * than an error, mirroring DSH's rule that catalog membership is advisory:
   * absence of a model is never a request rejection.
   *
   * @param provider - the provider route to inspect.
   * @returns the advertised models, or `[]` for an unregistered provider.
   */
  async listModels(provider: string): Promise<readonly { readonly id: string; readonly name: string }[]> {
    const entry = this.registry.find(candidate => candidate.id === provider)
    if (entry === undefined) return []
    if (entry.throws !== undefined) throw new Error(entry.throws)
    return entry.models
  }

  stream(options: { readonly provider?: string; readonly model?: string }): AsyncIterable<MockChunk> {
    const provider = options.provider ?? ''
    const model = options.model ?? ''
    // The mock serves exactly what it advertises: the provider route must be
    // registered, and the model must be in that route's catalog. A mock that
    // accepted any model would let a request no adapter would honor pass every
    // test.
    const entry = this.registry.find(candidate => candidate.id === provider)
    if (entry === undefined || !entry.models.some(candidate => candidate.id === model)) {
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

/** Mock `agentDefaultModel` service: one fixed selection, no settings write. */
class MockAgentDefaultModel extends Service {
  private readonly selection: { readonly provider: string; readonly model: string }

  constructor(ctx: Context, selection: { readonly provider: string; readonly model: string }) {
    super(ctx, 'agentDefaultModel')
    this.selection = selection
  }

  /**
   * Read the deployment's default selection.
   * @returns a detached provider and model.
   */
  currentSelection(): { readonly provider: string; readonly model: string } {
    return { ...this.selection }
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
   * {@link TEST_ROUTE} so the service resolves a route the mock registered —
   * unless {@link SetupOptions.followAgentDefault} asks for the opposite.
   */
  readonly config?: { readonly provider?: string; readonly model?: string }
  /**
   * Mount a mock `agentDefaultModel` carrying this selection and leave the memo
   * `Config` route unset, so the service has to fall back to the deployment's
   * default the way a real deployment with no pinned route does.
   */
  readonly followAgentDefault?: { readonly provider: string; readonly model: string }
  /** Mount no `llm` service at all, as a deployment without a model route. */
  readonly withoutLlm?: boolean
}

export async function setupHarness(options: SetupOptions = {}): Promise<TestHarness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memo-test-'))
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    if (options.withoutLlm !== true) await ctx.plugin(MockLlmService, options.llm ?? {})
    if (options.followAgentDefault !== undefined) {
      await ctx.plugin(MockAgentDefaultModel, options.followAgentDefault)
    }
    await ctx.plugin(MockTelemetryService)
    await ctx.plugin(MockGithubIssueService)
    const pinned = options.followAgentDefault !== undefined
      ? {}
      : {
          provider: options.config?.provider ?? TEST_ROUTE.provider,
          model: options.config?.model ?? TEST_ROUTE.model,
        }
    await ctx.plugin(MemoService, { repoUrl: 'https://github.com/test/repo', ...pinned })
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
