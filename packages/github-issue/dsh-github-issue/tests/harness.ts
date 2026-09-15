import { Context, Service } from '@deepseek-ai/cordis'
import GithubIssueService from '../src/index.ts'

/** What one model call was asked, so a test can assert the prompt itself. */
export interface CapturedPrompt {
  /** The system prompt the service sent. */
  readonly system: string
  /** The user text the service sent. */
  readonly user: string
}

/** The route one model call was sent to. */
export interface CapturedRoute {
  /** Provider id the call was routed to. */
  readonly provider: unknown
  /** Model id the call was routed to. */
  readonly model: unknown
}

/** Mock `agentDefaultModel` carrying the deployment's default selection. */
class MockAgentDefaultModel extends Service {
  readonly selection: { provider: string; model: string }
  constructor(ctx: Context, config: { provider: string; model: string }) {
    super(ctx, 'agentDefaultModel')
    this.selection = config
  }
  currentSelection() {
    return this.selection
  }
}

/** Mock LLM service that yields one text-delta then a finish. */
class MockLlmService extends Service {
  readonly mockText: string
  readonly prompts: CapturedPrompt[]
  readonly requests: CapturedRoute[]
  constructor(ctx: Context, config: { text: string; prompts: CapturedPrompt[]; requests: CapturedRoute[] }) {
    super(ctx, 'llm')
    this.mockText = config.text
    this.prompts = config.prompts
    this.requests = config.requests
  }
  stream(options: { provider?: unknown; model?: unknown; system?: string; messages?: readonly { content?: readonly { text?: string }[] }[] }) {
    const user = (options.messages ?? [])
      .flatMap(message => message.content ?? [])
      .map(part => part.text ?? '')
      .join('')
    this.prompts.push({ system: options.system ?? '', user })
    this.requests.push({ provider: options.provider, model: options.model })
    const text = this.mockText
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'text-delta', text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
  }
}

/**
 * Mock LLM service that yields no text and finishes with a terminal failure.
 *
 * The failure object is not decoration: DSH's `error` and `aborted` finish
 * reasons both carry a required {@link LlmFailure}, and a mock that omitted it
 * would let a service drop the machine-routing code without any test noticing.
 */
class EmptyLlmService extends Service {
  readonly failure: { code: string; message: string; status?: number }
  constructor(ctx: Context, config: { failure?: { code: string; message: string; status?: number } }) {
    super(ctx, 'llm')
    this.failure = config.failure ?? { code: 'NO_ADAPTER', message: 'no adapter registered for provider' }
  }
  stream(_options: unknown) {
    const failure = this.failure
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'finish', reason: { kind: 'error', failure } }
      },
    }
  }
}

/** Mock LLM service whose stream throws, as a transport failure that escaped DSH. */
class ThrowingLlmService extends Service {
  constructor(ctx: Context) { super(ctx, 'llm') }
  stream(_options: unknown): never {
    throw new Error('socket hang up')
  }
}

/** One telemetry event the mock recorded, so a test can assert what was reported. */
export interface RecordedEvent {
  /** Which recording method produced it. */
  readonly kind: 'track' | 'trackError'
  /** The recorded input, verbatim. */
  readonly input: Record<string, unknown>
}

/** Mock telemetry service that records every event this service reports. */
class MockTelemetryService extends Service {
  /** Every recorded event, in order. */
  readonly events: RecordedEvent[] = []
  constructor(ctx: Context) { super(ctx, 'telemetry') }
  track(input: unknown): void { this.events.push({ kind: 'track', input: input as Record<string, unknown> }) }
  trackError(input: unknown): void { this.events.push({ kind: 'trackError', input: input as Record<string, unknown> }) }
}

export interface TestHarness {
  readonly ctx: Context
  readonly service: GithubIssueService
  /** Every model call's prompt, in order, so a test can assert what was asked. */
  readonly prompts: CapturedPrompt[]
  /** Every model call's route, in order, so a test can assert what was resolved. */
  readonly llm: { readonly requests: CapturedRoute[] }
  /** The mock telemetry service, absent when the harness mounts none. */
  readonly telemetry: MockTelemetryService | undefined
  dispose(): Promise<void>
}

export async function setupHarness(options: {
  readonly repoUrl?: string
  readonly llmText?: string
  readonly emptyLlm?: boolean
  /** Failure the empty-model mock terminates with, to assert the preserved code. */
  readonly llmFailure?: { readonly code: string; readonly message: string; readonly status?: number }
  /** Mount no telemetry service, as a standalone deployment without one. */
  readonly withoutTelemetry?: boolean
  /** Mount an LLM whose stream throws instead of yielding a finish chunk. */
  readonly throwingLlm?: boolean
  /** Override the prefill URL budget, so shortening is testable without a huge body. */
  readonly maxPrefillUrlLength?: number
  /** Override the note appended when the body is shortened. */
  readonly prefillTruncationNote?: string
  /** Pin the service `Config` route, as a deployment can. */
  readonly provider?: string
  /** Pin the service `Config` model, as a deployment can. */
  readonly model?: string
  /** Mount a deployment default selection, as a real deployment has. */
  readonly defaultRoute?: { readonly provider: string; readonly model: string }
} = {}): Promise<TestHarness> {
  const ctx = new Context()
  const repoUrl = options.repoUrl ?? 'https://github.com/test/repo'
  const prompts: CapturedPrompt[] = []
  const requests: CapturedRoute[] = []
  try {
    if (options.throwingLlm === true) {
      await ctx.plugin(ThrowingLlmService)
    } else if (options.emptyLlm) {
      await ctx.plugin(EmptyLlmService, options.llmFailure === undefined ? {} : { failure: options.llmFailure })
    } else {
      await ctx.plugin(MockLlmService, { text: options.llmText ?? '## \u767b\u5f55\u5931\u8d25\n\n<details><summary>\u590d\u73b0</summary>\n\nBlank page\n\n</details>', prompts, requests })
    }
    if (options.defaultRoute !== undefined) {
      await ctx.plugin(MockAgentDefaultModel, options.defaultRoute)
    }
    if (options.withoutTelemetry !== true) {
      await ctx.plugin(MockTelemetryService)
    }
    await ctx.plugin(GithubIssueService, {
      repoUrl,
      ...(options.maxPrefillUrlLength === undefined ? {} : { maxPrefillUrlLength: options.maxPrefillUrlLength }),
      ...(options.prefillTruncationNote === undefined ? {} : { prefillTruncationNote: options.prefillTruncationNote }),
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      ...(options.model === undefined ? {} : { model: options.model }),
    })
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
  return {
    ctx,
    get service() { return ctx.get('githubIssue') as GithubIssueService },
    prompts,
    llm: { requests },
    get telemetry() { return ctx.get('telemetry') as MockTelemetryService | undefined },
    async dispose() { await ctx.fiber.dispose() },
  }
}
