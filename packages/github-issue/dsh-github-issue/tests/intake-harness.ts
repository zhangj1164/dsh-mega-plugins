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

/** One prompt this harness's Session controller mock admitted. */
export interface RecordedPrompt {
  /** Client-minted identity recorded on the message. */
  readonly requestId: string
  /** Session the prompt was admitted on. */
  readonly sessionId: string
  /** Delivery mode. */
  readonly mode: string
  /** Rendered prompt text. */
  readonly text: string
}

/** Mock Session controller that records creation, prompt admission, and renaming. */
class MockSessionController extends Service {
  /** Every create request, in order. */
  readonly creates: { cwd?: string; agentPreset?: string }[] = []
  /** Every prompt admission, in order. */
  readonly prompts: RecordedPrompt[] = []
  /** Every rename request, in order. */
  readonly renames: { sessionId: string; title: string }[] = []
  /** Whether prompt admission fails the way a disposed Agent does. */
  private readonly promptFails: boolean
  private index = 0
  constructor(ctx: Context, config?: { promptFails?: boolean }) {
    super(ctx, 'sessionController')
    this.promptFails = config?.promptFails ?? false
  }
  async create(request: { cwd?: string; agentPreset?: string }) {
    this.creates.push(request)
    this.index += 1
    return { sessionId: 'session-' + this.index }
  }
  async prompt(request: { requestId: string; sessionId: string; mode: string; content: readonly { text: string }[] }) {
    if (this.promptFails) throw new Error('the Agent is not accepting prompts')
    this.prompts.push({
      requestId: request.requestId,
      sessionId: request.sessionId,
      mode: request.mode,
      text: request.content.map(part => part.text).join(''),
    })
    return { accepted: true }
  }
  async rename(request: { sessionId: string; title: string }) {
    this.renames.push(request)
    return { title: request.title }
  }
}

/** One automation task this harness's Schedule mock registered. */
export interface RecordedTask {
  /** Session the task delivers into. */
  readonly sessionId: string
  /** Rendered prompt the task carries. */
  readonly prompt: string
  /** Task name shown on the automation board. */
  readonly title: string
  /** Delay between registration and delivery. */
  readonly afterSeconds: number
}

/** Mock Schedule service that records registered automation tasks. */
class MockSchedule extends Service {
  /** Every create request, in order. */
  readonly created: RecordedTask[] = []
  /** Whether registering a task fails the way an unavailable store does. */
  private readonly createFails: boolean
  private index = 0
  constructor(ctx: Context, config?: { createFails?: boolean }) {
    super(ctx, 'schedule')
    this.createFails = config?.createFails ?? false
  }
  async create(sessionId: string, request: { prompt: string; title: string; after_seconds: number }) {
    if (this.createFails) throw new Error('the schedule store is not available')
    this.index += 1
    this.created.push({
      sessionId,
      prompt: request.prompt,
      title: request.title,
      afterSeconds: request.after_seconds,
    })
    return { id: 'schedule-' + this.index }
  }
}

/** Mock storage domain serving one in-memory table. */
class MockStorageDomain extends Service {
  /** Every opened domain name. */
  readonly opened: string[] = []
  /** The one table's rows. */
  readonly rows = new Map<string, unknown>()
  /** Whether opening the domain fails the way a corrupt state file does. */
  private readonly failingOpen: boolean
  constructor(ctx: Context, config?: { failingOpen?: boolean }) {
    super(ctx, 'storageDomain')
    this.failingOpen = config?.failingOpen ?? false
  }
  async open(spec: { name: string }) {
    if (this.failingOpen) throw new Error('the intake state is not valid JSON')
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

/** One telemetry event a test can assert on. */
export interface RecordedTelemetryEvent {
  /** Plugin the event belongs to. */
  readonly pluginId: string
  /** Method the event describes. */
  readonly action: string
  /** Whether the event is a success; absent on failure events. */
  readonly result?: string
  /** Failure facts, on failure events. */
  readonly error?: { readonly code: string; readonly message: string }
}

/** Mock telemetry sink that records what the service reports. */
class MockTelemetry extends Service {
  /** Every success event, in order. */
  readonly tracks: RecordedTelemetryEvent[] = []
  /** Every failure event, in order. */
  readonly errors: RecordedTelemetryEvent[] = []
  constructor(ctx: Context) {
    super(ctx, 'telemetry')
  }
  track(event: RecordedTelemetryEvent): void {
    this.tracks.push(event)
  }
  trackError(event: RecordedTelemetryEvent): void {
    this.errors.push(event)
  }
}

/** Options one intake harness accepts. */
export interface IntakeHarnessOptions {
  /** Mount no Session controller. */
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
  /** Make prompt admission fail the way a disposed Agent does. */
  readonly promptFails?: boolean
  /** Mount no Schedule service, the way a non-Web composition does. */
  readonly withoutSchedule?: boolean
  /** Make automation-task registration fail the way an unavailable store does. */
  readonly scheduleCreateFails?: boolean
  /** Make opening the intake state fail the way a corrupt state file does. */
  readonly storageOpenFails?: boolean
}

/** The mounted intake harness. */
export interface IntakeHarness {
  /** Host context. */
  readonly ctx: Context
  /** The mounted service. */
  readonly service: GithubIssueService
  /** Session controller mock, absent when not mounted. */
  readonly sessions: MockSessionController | undefined
  /** Schedule mock, absent when not mounted. */
  readonly schedule: MockSchedule | undefined
  /** Storage mock, absent when not mounted. */
  readonly storage: MockStorageDomain | undefined
  /** Telemetry mock that records every event. */
  readonly telemetry: MockTelemetry
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
  await ctx.plugin(MockTelemetry)
  const telemetry = ctx.get('telemetry') as MockTelemetry
  const storage = options.withoutStorage === true
    ? undefined
    : await ctx.plugin(MockStorageDomain, { failingOpen: options.storageOpenFails === true }).then(() => ctx.get('storageDomain') as MockStorageDomain)
  if (storage !== undefined && options.initialState !== undefined) storage.rows.set('intake', options.initialState)
  const sessions = options.withoutSessionServices === true
    ? undefined
    : await ctx.plugin(MockSessionController, { promptFails: options.promptFails === true }).then(() => ctx.get('sessionController') as MockSessionController)
  const schedule = options.withoutSchedule === true
    ? undefined
    : await ctx.plugin(MockSchedule, { createFails: options.scheduleCreateFails === true }).then(() => ctx.get('schedule') as MockSchedule)
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
    schedule,
    storage,
    telemetry,
    async dispose() {
      await ctx.fiber.dispose()
    },
  }
}