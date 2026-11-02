import { Context, Service } from '@deepseek-ai/cordis'
import GithubIssueService from '../src/index.ts'
import type { IntakeStateRow } from '../src/spec.ts'

/**
 * Mock LLM that satisfies the service's declared dependency.
 *
 * The intake tests never call the model; the service still cannot activate
 * without this injection, and a bare Context has no LLM service.
 */
class MockLlmService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm')
  }
  stream(): never {
    throw new Error('the intake tests never call the model')
  }
}

/** One followup this harness's Agent mock received. */
export interface RecordedFollowup {
  /** Session the prompt was queued on. */
  readonly sessionId: string
  /** Rendered prompt text. */
  readonly text: string
  /** Message source kind. */
  readonly source: string
}

/** Mock Session controller that records creation and renaming. */
class MockSessionController extends Service {
  /** Every create request, in order. */
  readonly creates: { cwd?: string; agentPreset?: string }[] = []
  /** Every rename request, in order. */
  readonly renames: { sessionId: string; title: string }[] = []
  private index = 0
  constructor(ctx: Context) {
    super(ctx, 'sessionController')
  }
  async create(request: { cwd?: string; agentPreset?: string }) {
    this.creates.push(request)
    this.index += 1
    return { sessionId: 'session-' + this.index }
  }
  async rename(request: { sessionId: string; title: string }) {
    this.renames.push(request)
    return { title: request.title }
  }
}

/** Mock Agent registry whose handles record every queued prompt. */
class MockAgents extends Service {
  /** Every followup, in order. */
  readonly followups: RecordedFollowup[] = []
  constructor(ctx: Context) {
    super(ctx, 'agents')
  }
  get(sessionId: string) {
    const followups = this.followups
    return {
      agent: {
        followup(input: { content: readonly { text: string }[]; source: { kind: string } }) {
          followups.push({
            sessionId,
            text: input.content.map(part => part.text).join(''),
            source: input.source.kind,
          })
        },
      },
    }
  }
}

/** Mock storage domain serving one in-memory table. */
class MockStorageDomain extends Service {
  /** Every opened domain name. */
  readonly opened: string[] = []
  /** The one table's rows. */
  readonly rows = new Map<string, unknown>()
  constructor(ctx: Context) {
    super(ctx, 'storageDomain')
  }
  async open(spec: { name: string }) {
    this.opened.push(spec.name)
    const rows = this.rows
    return {
      table: () => ({
        get: (key: string) => rows.get(key),
        put: async (key: string, value: unknown) => {
          rows.set(key, value)
        },
      }),
      close: async () => {},
    }
  }
}

/** Options one intake harness accepts. */
export interface IntakeHarnessOptions {
  /** Mount no Session controller and no Agent registry. */
  readonly withoutSessionServices?: boolean
  /** Mount no storage domain. */
  readonly withoutStorage?: boolean
  /** Seed the durable intake state before the service opens it. */
  readonly initialState?: IntakeStateRow
  /** Turn the first-startup check on. */
  readonly autopilotEnabled?: boolean
  /** Zone the startup check measures today in. */
  readonly autopilotTimeZone?: string
  /** Working directory a dispatched Session owns. */
  readonly autopilotCwd?: string
  /** Preset a dispatched Session runs. */
  readonly autopilotPreset?: string
  /** Prompt template. */
  readonly autopilotPrompt?: string
  /** Claim label. */
  readonly claimLabel?: string
  /** Largest dispatch count. */
  readonly maxIssuesPerRun?: number
  /** Token to hand the service; `null` means no credential at all. */
  readonly token?: string | null
}

/** The mounted intake harness. */
export interface IntakeHarness {
  /** Host context. */
  readonly ctx: Context
  /** The mounted service. */
  readonly service: GithubIssueService
  /** Session controller mock, absent when not mounted. */
  readonly sessions: MockSessionController | undefined
  /** Agent registry mock, absent when not mounted. */
  readonly agents: MockAgents | undefined
  /** Storage mock, absent when not mounted. */
  readonly storage: MockStorageDomain | undefined
  /** Release the context. */
  dispose(): Promise<void>
}

/**
 * Mount the GitHub-issue service with the services the intake loop reads.
 * @param options - which mocks to mount and the service config.
 * @returns the mounted harness.
 */
export async function setupIntakeHarness(options: IntakeHarnessOptions = {}): Promise<IntakeHarness> {
  const ctx = new Context()
  await ctx.plugin(MockLlmService)
  const storage = options.withoutStorage === true ? undefined : await ctx.plugin(MockStorageDomain).then(() => ctx.get('storageDomain') as MockStorageDomain)
  if (storage !== undefined && options.initialState !== undefined) storage.rows.set('intake', options.initialState)
  const sessions = options.withoutSessionServices === true ? undefined : await ctx.plugin(MockSessionController).then(() => ctx.get('sessionController') as MockSessionController)
  const agents = options.withoutSessionServices === true ? undefined : await ctx.plugin(MockAgents).then(() => ctx.get('agents') as MockAgents)
  const token = options.token ?? 'test-token'
  await ctx.plugin(GithubIssueService, {
    repoUrl: 'https://github.com/test/repo',
    tokenEnv: 'DSH_TEST_SUITE_ABSENT_TOKEN',
    ...(options.token === null ? { tokenCommand: '' } : { token, tokenCommand: '' }),
    autopilotEnabled: options.autopilotEnabled ?? false,
    autopilotTimeZone: options.autopilotTimeZone ?? 'UTC',
    ...(options.autopilotCwd === undefined ? {} : { autopilotCwd: options.autopilotCwd }),
    ...(options.autopilotPreset === undefined ? {} : { autopilotPreset: options.autopilotPreset }),
    ...(options.autopilotPrompt === undefined ? {} : { autopilotPrompt: options.autopilotPrompt }),
    ...(options.claimLabel === undefined ? {} : { claimLabel: options.claimLabel }),
    ...(options.maxIssuesPerRun === undefined ? {} : { maxIssuesPerRun: options.maxIssuesPerRun }),
  })
  return {
    ctx,
    service: ctx.get('githubIssue') as GithubIssueService,
    sessions,
    agents,
    storage,
    async dispose() {
      await ctx.fiber.dispose()
    },
  }
}