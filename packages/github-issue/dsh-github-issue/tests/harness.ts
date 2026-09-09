import { Context, Service } from '@deepseek-ai/cordis'
import GithubIssueService from '../src/index.ts'

/** Mock LLM service that yields one text-delta then a finish. */
class MockLlmService extends Service {
  readonly mockText: string
  constructor(ctx: Context, config: { text: string }) {
    super(ctx, 'llm')
    this.mockText = config.text
  }
  stream(_options: unknown) {
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
  dispose(): Promise<void>
}

export async function setupHarness(options: {
  readonly repoUrl?: string
  readonly llmText?: string
  readonly emptyLlm?: boolean
} = {}): Promise<TestHarness> {
  const ctx = new Context()
  const repoUrl = options.repoUrl ?? 'https://github.com/test/repo'
  try {
    if (options.emptyLlm) {
      await ctx.plugin(EmptyLlmService)
    } else {
      await ctx.plugin(MockLlmService, { text: options.llmText ?? '## \u767b\u5f55\u5931\u8d25\n\n<details><summary>\u590d\u73b0</summary>\n\nBlank page\n\n</details>' })
    }
    await ctx.plugin(GithubIssueService, { repoUrl })
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
  return {
    ctx,
    get service() { return ctx.get('githubIssue') as GithubIssueService },
    async dispose() { await ctx.fiber.dispose() },
  }
}
