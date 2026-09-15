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

/** Mock LLM service that yields no text and finishes with an error. */
class EmptyLlmService extends Service {
  constructor(ctx: Context) { super(ctx, 'llm') }
  stream(_options: unknown) {
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'finish', reason: { kind: 'error' } }
      },
    }
  }
}

export interface TestHarness {
  readonly ctx: Context
  readonly service: GithubIssueService
  /** Every model call's prompt, in order, so a test can assert what was asked. */
  readonly prompts: CapturedPrompt[]
  /** Every model call's route, in order, so a test can assert what was resolved. */
  readonly llm: { readonly requests: CapturedRoute[] }
  dispose(): Promise<void>
}

export async function setupHarness(options: {
  readonly repoUrl?: string
  readonly llmText?: string
  readonly emptyLlm?: boolean
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
    if (options.emptyLlm) {
      await ctx.plugin(EmptyLlmService)
    } else {
      await ctx.plugin(MockLlmService, { text: options.llmText ?? '## \u767b\u5f55\u5931\u8d25\n\n<details><summary>\u590d\u73b0</summary>\n\nBlank page\n\n</details>', prompts, requests })
    }
    if (options.defaultRoute !== undefined) {
      await ctx.plugin(MockAgentDefaultModel, options.defaultRoute)
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
    async dispose() { await ctx.fiber.dispose() },
  }
}
