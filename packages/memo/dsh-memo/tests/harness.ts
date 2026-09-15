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

/** The plugin id memo records its own events under, mirrored for the mock. */
const TELEMETRY_PLUGIN_ID = 'memo'

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

/** One telemetry event the mock recorded, so a test can assert what was reported. */
export interface RecordedEvent {
  /** Which of the two recording methods produced it. */
  readonly kind: 'track' | 'trackError'
  /** The recorded input, verbatim. */
  readonly input: Record<string, unknown>
}

/** Mock telemetry service that records every event and answers a configured analysis. */
class MockTelemetryService extends Service {
  /** The analysis `analyzeForPlugin` answers with for `memo`. */
  readonly analysis: Record<string, unknown>
  /** Per-plugin analyses, which win over {@link MockTelemetryService.analysis}. */
  readonly analysisByPlugin: Record<string, Record<string, unknown>>
  /** Every recorded event, in order. */
  readonly events: RecordedEvent[] = []
  /** Every plugin id `analyzeForPlugin` was asked about, in order. */
  readonly requested: string[] = []
  constructor(ctx: Context, config: { analysis: Record<string, unknown>; analysisByPlugin: Record<string, Record<string, unknown>> }) {
    super(ctx, 'telemetry')
    this.analysis = config.analysis
    this.analysisByPlugin = config.analysisByPlugin
  }
  track(input: unknown): void { this.events.push({ kind: 'track', input: input as Record<string, unknown> }) }
  trackError(input: unknown): void { this.events.push({ kind: 'trackError', input: input as Record<string, unknown> }) }
  listEvents(_query: unknown): never[] { return [] }
  analyzeForPlugin(pluginId: string) {
    this.requested.push(pluginId)
    // The plain fixture answers for `memo` alone rather than for every plugin:
    // a suite-wide read must not clone one plugin's events onto the others.
    const fixture = this.analysisByPlugin[pluginId] ?? (pluginId === TELEMETRY_PLUGIN_ID ? this.analysis : {})
    return { pluginId, totalEvents: 0, totalFailures: 0, failureGroups: [], ...fixture }
  }
}

/** Mock github-issue service that records the report request it was handed. */
class MockGithubIssueService extends Service {
  /** Every `generateReport` request, in order. */
  readonly reportRequests: Record<string, unknown>[] = []
  constructor(ctx: Context) { super(ctx, 'githubIssue') }
  async generateReport(request: unknown) {
    this.reportRequests.push(request as Record<string, unknown>)
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
  /** The telemetry analysis the mock answers with, for log-analysis tests. */
  readonly telemetry: MockTelemetryService
  /** The mock github-issue service, which records the requests it received. */
  readonly githubIssue: MockGithubIssueService
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
  /**
   * What the mock telemetry service's `analyzeForPlugin` answers with for
   * `memo`, so the log-analysis pipeline can be tested without a real
   * telemetry store.
   */
  readonly analysis?: Record<string, unknown>
  /**
   * Per-plugin answers, for an analysis that spans more than one plugin. Each
   * entry overrides {@link SetupOptions.analysis} for its plugin id.
   */
  readonly analysisByPlugin?: Record<string, Record<string, unknown>>
  /** Memo `Config.logAnalysisPlugins`, for a deployment that trims the suite. */
  readonly logAnalysisPlugins?: readonly string[]
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
    await ctx.plugin(MockTelemetryService, { analysis: options.analysis ?? {}, analysisByPlugin: options.analysisByPlugin ?? {} })
    await ctx.plugin(MockGithubIssueService)
    const pinned = options.followAgentDefault !== undefined
      ? {}
      : {
          provider: options.config?.provider ?? TEST_ROUTE.provider,
          model: options.config?.model ?? TEST_ROUTE.model,
        }
    await ctx.plugin(MemoService, {
      repoUrl: 'https://github.com/test/repo',
      ...pinned,
      ...(options.logAnalysisPlugins === undefined ? {} : { logAnalysisPlugins: [...options.logAnalysisPlugins] }),
    })
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
  return {
    ctx,
    root,
    get telemetry() { return ctx.get('telemetry') as MockTelemetryService },
    get githubIssue() { return ctx.get('githubIssue') as MockGithubIssueService },
    async dispose() {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
