/**
 * GitHub-issue generation service: builds uniform GitHub issue reports from
 * telemetry analysis, constructs pre-filled issue-creation URLs, and optimizes
 * natural-language issue descriptions with the configured model.
 *
 * Extends `TypertRemoteService` because the client issue-editor UI calls
 * `optimizeIssue` and `prefilledIssueUrl` directly, and the memo log-analysis
 * flow calls `generateReport`.
 *
 * @module @zhangj1164/dsh-github-issue
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { GithubIssueClient } from './github.ts'
import { DEFAULT_DISPATCH_PROMPT, isValidTimeZone, issueBody, localDayKey, renderDispatchPrompt } from './intake.ts'
import { INTAKE_STATE_KEY, intakeDomainSpec, type IntakeStateRow } from './spec.ts'
import { streamLlmText, type LlmRoute, type LlmTextResult, type LlmTextSource } from './llm-text.ts'
import type {
  GithubIssueCreateRequest,
  GithubIssueCreateResult,
  GithubIssueDispatchRequest,
  GithubIssueDispatchResult,
  GithubIssueDispatched,
  GithubIssueFailure,
  GithubIssueGenerateReportRequest,
  GithubIssueGenerateReportResult,
  GithubIssueIntakeRequest,
  GithubIssueIntakeResult,
  GithubIssueListRequest,
  GithubIssueListResult,
  GithubIssueOptimizeRequest,
  GithubIssueOptimizeResult,
  GithubIssuePrefillRequest,
  GithubIssuePrefillResult,
  GithubIssueReport,
  GithubIssueTask,
} from './types.ts'

export type * from './types.ts'
export type { LlmRoute, LlmTextFailure, LlmTextResult, LlmTextSource } from './llm-text.ts'

/** Deployment configuration for the GitHub-issue service. */
export interface Config {
  /**
   * The GitHub repository URL for issue prefill (e.g.
   * `https://github.com/owner/repo`). Used as the default when a request omits
   * `repoUrl`. The deployment sets this to the real project repository.
   */
  readonly repoUrl: string
  /**
   * Longest pre-filled issue URL to produce, counted in characters.
   *
   * GitHub refuses a request URL that is too long and shows an error page
   * instead of the new-issue form, and it publishes no stable constant for the
   * boundary, so this is a deployment-tunable value carrying headroom rather
   * than a hardcoded number.
   */
  readonly maxPrefillUrlLength: number
  /**
   * Appended to the issue body when the URL had to be shortened to fit
   * {@link Config.maxPrefillUrlLength}, so the reader knows the body is partial.
   */
  readonly prefillTruncationNote: string
  /**
   * Provider route for model calls; unset to follow this deployment's
   * `agentDefaultModel` selection. Set it to pin issue generation to one route
   * without touching memo's own route.
   */
  readonly provider?: string
  /**
   * Model id for model calls; unset to follow this deployment's
   * `agentDefaultModel` selection.
   */
  readonly model?: string
  /**
   * Environment variable that carries the GitHub token. Read only when
   * {@link Config.token} is unset, and only when no token command is configured
   * or the command produced nothing.
   */
  readonly tokenEnv: string
  /**
   * Explicit GitHub token. A deployment that manages secrets itself sets this;
   * a token stored in the environment or produced by {@link Config.tokenCommand}
   * is read when this field is absent.
   */
  readonly token?: string
  /**
   * Command whose standard output is a GitHub token, run only when neither
   * {@link Config.token} nor {@link Config.tokenEnv} supplies one. The default
   * reads the credential the `gh` CLI already stores, so a machine that is
   * logged in to GitHub needs no extra secret; set it to an empty string to
   * disable the lookup.
   */
  readonly tokenCommand: string
  /** Deadline for {@link Config.tokenCommand}, in milliseconds. */
  readonly tokenCommandTimeoutMs: number
  /**
   * GitHub REST origin. `https://api.github.com` serves github.com; an
   * Enterprise deployment sets its own `https://host/api/v3`.
   */
  readonly apiBaseUrl: string
  /** Deadline for one GitHub REST request, in milliseconds. */
  readonly requestTimeoutMs: number
  /**
   * Label that marks an issue claimable by the intake loop. The repository's
   * triage vocabulary owns the value; this field only names which label counts.
   */
  readonly claimLabel: string
  /** Largest number of issues one intake pass may dispatch. */
  readonly maxIssuesPerRun: number
  /**
   * Whether the host checks for claimable issues on its first startup of the
   * day. Off by default: opening a Session without being asked is a deployment
   * decision, never a surprise a plugin installs on its own.
   */
  readonly autopilotEnabled: boolean
  /**
   * Working directory the dispatched Sessions own. Empty follows the host's
   * default directory, which is the deployment's current working directory.
   */
  readonly autopilotCwd: string
  /** Agent preset the dispatched Sessions run; empty follows the deployment default. */
  readonly autopilotPreset: string
  /**
   * IANA zone "today" is measured in. Empty follows the host's own zone, so a
   * user's local midnight is what starts a new day.
   */
  readonly autopilotTimeZone: string
  /**
   * Prompt template handed to every dispatched Session. Placeholders are
   * documented on `renderDispatchPrompt`; the default states the issue
   * location and points at the repository workflow.
   */
  readonly autopilotPrompt: string
}

/** Schemastery configuration for the GitHub-issue service. */
export const Config: s<Config> = s.object({
  repoUrl: s.string().default('https://github.com/zhangj1164/dsh-mega-plugins'),
  maxPrefillUrlLength: s.number().default(7000),
  prefillTruncationNote: s.string().default('\n\n> （正文过长，已截断以适配 GitHub 的 URL 长度限制。完整正文见备忘面板的「复制完整正文」。）'),
  provider: s.string(),
  model: s.string(),
  tokenEnv: s.string().default('GITHUB_TOKEN'),
  token: s.string(),
  tokenCommand: s.string().default('gh auth token'),
  tokenCommandTimeoutMs: s.number().step(1).min(1000).max(120000).default(10000),
  apiBaseUrl: s.string().default('https://api.github.com'),
  requestTimeoutMs: s.number().step(1).min(1000).max(180000).default(15000),
  claimLabel: s.string().default('ready-for-agent'),
  maxIssuesPerRun: s.number().step(1).min(1).max(20).default(3),
  autopilotEnabled: s.boolean().default(false),
  autopilotCwd: s.string().default(''),
  autopilotPreset: s.string().default(''),
  autopilotTimeZone: s.string().default(''),
  autopilotPrompt: s.string().default(DEFAULT_DISPATCH_PROMPT),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    githubIssue: GithubIssueService
  }
}

/** The built-in system prompt that structures a natural-language issue description. */
const OPTIMIZE_SYSTEM_PROMPT = [
  'You are a technical issue reporter. Rewrite the user\'s description into a',
  'well-structured GitHub issue following this exact Markdown template.',
  'Fill every section from the description; if a section has no information,',
  'state "No information provided." Do not add information the user did not give.',
  '',
  'The title (first line) must contain Chinese characters.',
  'The visible body must be under 50 units of text; place all detail inside a',
  'default-collapsed <details> block so the issue body stays compact.',
  '',
  'Template:',
  '## <brief Chinese title>',
  '',
  '<details>',
  '<summary>复现、预期与验收</summary>',
  '',
  '- 插件 / Plugin:',
  '- 操作 / Action:',
  '- 预期行为 / Expected:',
  '- 实际行为 / Actual:',
  '- 复现步骤 / Steps to Reproduce:',
  '- 环境 / Environment:',
  '',
  '</details>',
  '',
  'Return only the Markdown body (no code fences around the whole output).',
  'The first line must be a concise title prefixed with "## ".',
].join('\n')

/** How a fact the analysis did not carry is written, so it reads as absent data. */
const NOT_RECORDED = 'not recorded'

/**
 * The failure returned when a request arrives without a model route.
 *
 * Named rather than folded into `llm-failure`: a missing route and a model that
 * truly produced nothing are different defects with different owners. Reporting
 * the first as the second sent a user hunting for a model problem in a request
 * that never reached a model.
 */
const ROUTE_MISSING = {
  ok: false,
  error: {
    code: 'route-missing',
    message: 'no model route was supplied for this call; the caller must pass the provider and model to use',
  },
} as const

/** The plugin id these events are recorded under, alongside `memo`. */
const TELEMETRY_PLUGIN_ID = 'github-issue'

/** The DSH machine-routing code `dsh-memo` also uses when nothing resolves a route. */
const NO_MODEL_ROUTE_CODE = 'NO_MODEL_ROUTE'

/**
 * The optional telemetry sink this service reports to.
 *
 * Declared structurally and read with `ctx.get`, deliberately **not** from
 * `static inject`: a deployment may install this plugin on its own bundle
 * without telemetry, and a diagnostic dependency must never be the reason a
 * service refuses to activate.
 */
interface TelemetrySink {
  /** Record one completed call. */
  track(input: { pluginId: string; action: string; result: 'success' | 'failure'; metadata?: Record<string, unknown> }): void
  /** Record one failure, with the feature anchor a report groups on. */
  trackError(input: {
    pluginId: string
    action: string
    error: { code: string; message: string; featureCodeRef?: string }
    metadata?: Record<string, unknown>
  }): void
}

/** The built-in system prompt that generates a report from telemetry analysis. */
const REPORT_SYSTEM_PROMPT = [
  'You are a diagnostic report generator. Given a plugin\'s telemetry failure',
  'analysis, produce a GitHub issue report that correlates each failure group',
  'against the plugin\'s feature code. For each group, state the feature-code',
  'anchor, the error code and message, the route and timing the analysis gives,',
  'a likely cause, and a suggested fix.',
  '',
  'Ground every statement in the analysis you were given:',
  '- Cite only facts present in it. Never propose a mechanism the analysis does',
  '  not evidence — do not mention sampling parameters, token budgets,',
  '  timeouts, chunking, streaming, or response parsing unless the analysis',
  '  names that mechanism.',
  '- Report the analysis window, and per failure group the route, the last',
  '  failure time, and how many attempts of the same action followed it. Say how',
  '  old the last failure is and whether the action ran again afterwards; a',
  '  failure that has not recurred is not a current defect.',
  `- Write "${NOT_RECORDED}" for a fact the analysis does not carry. Never write`,
  '  that collection needs to be added: a missing fact can be an older event as',
  '  easily as a gap, and the report cannot tell which.',
  '',
  'The title (first line) must contain Chinese characters.',
  'Place all detail inside a default-collapsed <details> block.',
  '',
  'Template:',
  '## <brief Chinese title>',
  '',
  '<details>',
  '<summary>诊断报告</summary>',
  '',
  '### 插件 / Plugin',
  '### 操作 / Action',
  '### 预期行为 / Expected',
  '### 实际行为 / Actual',
  '### 路由与时间 / Route and Timing',
  '### 可能原因 / Possible Cause',
  '### 错误日志 / Error Logs',
  '### 环境 / Environment',
  '',
  '</details>',
  '',
  'Return only the Markdown body. The first line must be a concise Chinese title.',
].join('\n')

/** The subset of the storage-domain table the intake state uses. */
interface GithubIntakeTable {
  /** Read the one state row, when it exists. */
  get(key: string): IntakeStateRow | undefined
  /** Persist the one state row durably. */
  put(key: string, value: IntakeStateRow): Promise<void>
}

/** The subset of the storage-domain service this plugin opens. */
interface GithubStorageDomain {
  /** Open the declared intake domain. */
  open(spec: unknown): Promise<{
    /** One table of the opened domain. */
    table(name: string): GithubIntakeTable
    /** Release the domain handle. */
    close(): Promise<void>
  }>
}

/** The Session controller methods dispatching a Session needs. */
interface GithubSessionController {
  /** Create one ordinary Session for a new conversation. */
  create(request: { cwd?: string; agentPreset?: string }): Promise<{ sessionId: string }>
  /** Give one Session a readable title; optional because a deployment may mount no title service. */
  rename?(request: { sessionId: string; title: string }): Promise<unknown>
}

/** One live Agent's inbox entry point. */
interface GithubAgentHandle {
  /** Queue a next-turn prompt and wake the driver. */
  readonly agent: {
    followup(input: {
      content: readonly { readonly type: 'text'; readonly text: string }[]
      source: { readonly kind: string }
    }): void
  }
}

/** The Agent registry dispatch reads a published handle from. */
interface GithubAgents {
  /** Find one live Agent by its Session id. */
  get(sessionId: string): GithubAgentHandle | undefined
}

/** The empty intake state used before the first pass and without storage. */
const EMPTY_INTAKE_STATE: IntakeStateRow = Object.freeze({
  lastCheckedDay: '',
  dispatched: Object.freeze([]),
})

/**
 * How many dispatched-issue records the state keeps.
 *
 * The records are what stops a second pass from opening a second Session for
 * the same issue. The bound only keeps one JSON document from growing without
 * limit; issues beyond it are old enough that their PR is already the record.
 */
const MAX_DISPATCH_HISTORY = 500

/** The failure returned when a report cannot become a GitHub issue at all. */
const INVALID_ISSUE_REQUEST = {
  ok: false,
  error: {
    code: 'invalid-request',
    message: 'the issue report must carry a non-empty title and a body',
  },
} as const

/** The failure returned when the deployment has no Session router. */
const SESSION_UNAVAILABLE = {
  ok: false,
  error: {
    code: 'session-unavailable',
    message: 'this deployment mounts no Session controller or Agent registry, so no issue can be dispatched',
  },
} as const

/** Promise-based `exec`, used only for the configured token command. */
const execAsync = promisify(exec)

/**
 * GitHub-issue generation and optimization service over the configured model.
 *
 * Beyond the model-backed report methods, the service owns the issue intake
 * loop: it files an optimized report through the GitHub REST API, lists the
 * issues that carry the claim label, and hands one of them to a fresh Session.
 */
export class GithubIssueService extends TypertRemoteService {
  static inject = ['llm']
  static Config = Config

  private readonly repoUrl: string
  private readonly maxPrefillUrlLength: number
  private readonly prefillTruncationNote: string
  /** Configured provider route, or `undefined` to follow `agentDefaultModel`. */
  private readonly provider?: string
  /** Configured model id, or `undefined` to follow `agentDefaultModel`. */
  private readonly model?: string
  private readonly tokenEnv: string
  private readonly token?: string
  private readonly tokenCommand: string
  private readonly tokenCommandTimeoutMs: number
  private readonly apiBaseUrl: string
  private readonly requestTimeoutMs: number
  private readonly claimLabel: string
  private readonly maxIssuesPerRun: number
  private readonly autopilotEnabled: boolean
  private readonly autopilotCwd: string
  private readonly autopilotPreset: string
  private readonly autopilotTimeZone: string
  private readonly autopilotPrompt: string
  /** The persisted state, or the empty state when this deployment has no storage. */
  private intakeState: IntakeStateRow = EMPTY_INTAKE_STATE
  /** The durable table, absent when this deployment mounts no storage domain. */
  private intakeTable?: GithubIntakeTable
  /** Whether the state is durable; the startup check refuses to run without it. */
  private intakePersistent = false
  /** The resolved token, cached so a token command runs at most once. */
  private resolvedToken?: string
  /** Whether token resolution finished; a missing credential is a result, not a retry. */
  private tokenResolved = false

  /**
   * @param ctx - Host context carrying the llm service.
   * @param config - Validated deployment configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'githubIssue')
    if (!isValidTimeZone(config.autopilotTimeZone)) {
      throw new Error(`autopilotTimeZone "${config.autopilotTimeZone}" is not an IANA time zone`)
    }
    this.repoUrl = config.repoUrl
    this.maxPrefillUrlLength = config.maxPrefillUrlLength
    this.prefillTruncationNote = config.prefillTruncationNote
    this.provider = config.provider
    this.model = config.model
    this.tokenEnv = config.tokenEnv
    this.token = config.token
    this.tokenCommand = config.tokenCommand
    this.tokenCommandTimeoutMs = config.tokenCommandTimeoutMs
    this.apiBaseUrl = config.apiBaseUrl
    this.requestTimeoutMs = config.requestTimeoutMs
    this.claimLabel = config.claimLabel
    this.maxIssuesPerRun = config.maxIssuesPerRun
    this.autopilotEnabled = config.autopilotEnabled
    this.autopilotCwd = config.autopilotCwd
    this.autopilotPreset = config.autopilotPreset
    this.autopilotTimeZone = config.autopilotTimeZone
    this.autopilotPrompt = config.autopilotPrompt
  }

  /**
   * Open the durable intake state and, when enabled, run the first-startup
   * check.
   *
   * The check is deliberately not awaited: opening a Session is useful work
   * but not a prerequisite for the service, and a slow or unreachable GitHub
   * must not hold up the host's boot. A failure is logged and retried on the
   * next startup, because the day key is only committed after a completed pass.
   */
  protected async [Service.init](): Promise<void> {
    await this.openIntakeState()
    if (!this.autopilotEnabled) return
    if (!this.intakePersistent) {
      this.warn('autopilot is enabled but no durable intake state is available; skipping the startup check so it cannot dispatch the same issue twice')
      return
    }
    void this.startupIntake()
  }

  /**
   * Resolve the model route for one model call.
   *
   * The caller's explicit request wins, then this service's validated `Config`,
   * then the deployment's `agentDefaultModel` selection — the same order the
   * memo service uses, so one deployment-level answer decides both. A blank
   * half is treated as absent rather than as a value: it is the shape an
   * omitted field arrives in, and letting it win would send a call with no
   * adapter, whose failure ("the model produced no output") blames the model
   * for a routing problem.
   *
   * @param request - the caller's optional route.
   * @returns the resolved route, or `undefined` when nothing resolved one.
   */
  private resolveRoute(request: { readonly provider?: string; readonly model?: string }): { provider: string; model: string } | undefined {
    const selection = this.ctx.get('agentDefaultModel')?.currentSelection()
    const provider = firstNonBlank(request.provider, this.provider, selection?.provider)
    const model = firstNonBlank(request.model, this.model, selection?.model)
    if (provider === undefined || model === undefined) return undefined
    return { provider, model }
  }

  /**
   * Generate a uniform GitHub issue report from a telemetry failure analysis.
   * Calls the configured model with a built-in structuring prompt.
   * @param request - the analysis input from the telemetry service.
   * @returns the generated report or an LLM failure.
   */
  @Remote('generateReport')
  async generateReport(request: GithubIssueGenerateReportRequest): Promise<GithubIssueGenerateReportResult> {
    const route = this.resolveRoute(request)
    if (route === undefined) return this.routeMissing('generateReport')
    const userPrompt = buildReportUserPrompt(request)
    const result = await streamLlmText(this.ctx.get('llm') as LlmTextSource | undefined, route, REPORT_SYSTEM_PROMPT, userPrompt)
    if (!result.ok) return this.llmFailure('generateReport', route, result)
    const title = extractTitle(result.text) ?? `Telemetry failures in ${request.pluginIds.join(', ')}`
    this.track('generateReport', 'success', { pluginIds: [...request.pluginIds], ...this.routeFacts(route) })
    return {
      ok: true,
      value: Object.freeze({ title, body: result.text, labels: Object.freeze(['bug', 'telemetry']) }),
    }
  }

  /**
   * Build a pre-filled GitHub issue-creation URL from a report.
   *
   * The body is shortened when the finished URL would exceed the configured
   * limit. The check is on the URL rather than on the body alone because the
   * title and labels spend the same budget and percent-encoding inflates it,
   * so a body-length rule would still produce a URL GitHub refuses.
   *
   * @param request - the repository URL and the report to prefill.
   * @returns the prefill URL or an invalid-URL failure.
   */
  @Remote('prefilledIssueUrl')
  prefilledIssueUrl(request: GithubIssuePrefillRequest): GithubIssuePrefillResult {
    const repoUrl = request.repoUrl.length > 0 ? request.repoUrl : this.repoUrl
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/u.test(repoUrl)) {
      return { ok: false, error: { code: 'invalid-url', message: `repoUrl "${repoUrl}" is not a valid GitHub repository URL` } }
    }
    return {
      ok: true,
      value: buildPrefillUrl(repoUrl, request.report, this.maxPrefillUrlLength, this.prefillTruncationNote),
    }
  }

  /**
   * Optimize a natural-language issue description into a structured report
   * using the configured model and a built-in structuring prompt.
   * @param request - the raw description and model route.
   * @returns the structured report or an LLM failure.
   */
  @Remote('optimizeIssue')
  async optimizeIssue(request: GithubIssueOptimizeRequest): Promise<GithubIssueOptimizeResult> {
    if (request.description.trim().length === 0) {
      return { ok: false, error: { code: 'empty-input', message: 'the issue description is empty' } }
    }
    const route = this.resolveRoute(request)
    if (route === undefined) return this.routeMissing('optimizeIssue')
    const result = await streamLlmText(this.ctx.get('llm') as LlmTextSource | undefined, route, OPTIMIZE_SYSTEM_PROMPT, request.description)
    if (!result.ok) return this.llmFailure('optimizeIssue', route, result)
    const title = extractTitle(result.text) ?? 'New issue'
    this.track('optimizeIssue', 'success', this.routeFacts(route))
    return {
      ok: true,
      value: Object.freeze({ title, body: result.text, labels: Object.freeze(['bug']) }),
    }
  }

  /**
   * File one issue in the configured repository.
   *
   * The body is filed without its leading title heading: the optimizer repeats
   * the title there so one text can drive both the pre-filled URL form and a
   * direct filing, and GitHub takes the title as its own field.
   *
   * @param request - repository override and the report to file.
   * @returns the created issue, or a stable failure.
   */
  @Remote('createIssue')
  async createIssue(request: GithubIssueCreateRequest): Promise<GithubIssueCreateResult> {
    const report = request.report
    if (typeof report?.title !== 'string' || typeof report.body !== 'string') return INVALID_ISSUE_REQUEST
    const title = report.title.trim()
    if (title.length === 0) return INVALID_ISSUE_REQUEST
    const labels = [...(report.labels ?? [])].map(label => label.trim()).filter(label => label.length > 0)
    const normalized: GithubIssueReport = { title, body: issueBody(report), labels }
    const client = await this.createClient(request.repoUrl)
    const result = await client.createIssue(normalized)
    if (!result.ok) {
      this.trackError('createIssue', {
        code: result.error.code,
        message: result.error.message,
        featureCodeRef: this.featureCode('createIssue'),
      })
      return result
    }
    this.track('createIssue', 'success', { issue: result.value.number })
    return result
  }

  /**
   * List the open issues that carry the claim label.
   * @param request - repository, label, and count overrides.
   * @returns the claimable issues, or a stable failure.
   */
  @Remote('listClaimableIssues')
  async listClaimableIssues(request: GithubIssueListRequest = {}): Promise<GithubIssueListResult> {
    const claimLabel = firstNonBlank(request.claimLabel, this.claimLabel) ?? this.claimLabel
    const max = clampCount(request.max ?? this.maxIssuesPerRun)
    const client = await this.createClient(request.repoUrl)
    const result = await client.listClaimable(claimLabel, max)
    if (!result.ok) {
      this.trackError('listClaimableIssues', {
        code: result.error.code,
        message: result.error.message,
        featureCodeRef: this.featureCode('listClaimableIssues'),
      })
    }
    return result
  }

  /**
   * Hand one issue to a fresh Session.
   * @param request - the issue and optional Session placement.
   * @returns the created Session, or a stable failure.
   */
  @Remote('dispatchIssue')
  async dispatchIssue(request: GithubIssueDispatchRequest): Promise<GithubIssueDispatchResult> {
    return this.dispatch(request)
  }

  /**
   * Run one intake pass: list the claimable issues, skip the ones an earlier
   * pass already dispatched, and hand the rest to a fresh Session.
   *
   * The local day is committed only after the listing succeeded, so a pass that
   * could not reach GitHub is retried on the next startup instead of being
   * remembered as done. An issue that was already dispatched is never
   * dispatched again, even on a later day: its Session exists, and a second one
   * would duplicate the work.
   *
   * @param request - repository, label, count, and Session placement overrides.
   * @returns what the pass read and did.
   */
  @Remote('runIntake')
  async runIntake(request: GithubIssueIntakeRequest = {}): Promise<GithubIssueIntakeResult> {
    const repoUrl = firstNonBlank(request.repoUrl, this.repoUrl) ?? this.repoUrl
    const claimLabel = firstNonBlank(request.claimLabel, this.claimLabel) ?? this.claimLabel
    const max = clampCount(request.max ?? this.maxIssuesPerRun)
    const listed = await this.listClaimableIssues({ repoUrl, claimLabel, max })
    if (!listed.ok) return listed
    const claimed = new Set(this.intakeState.dispatched.map(row => row.number))
    const skipped: number[] = []
    const fresh: GithubIssueTask[] = []
    for (const issue of listed.value) {
      if (claimed.has(issue.number)) skipped.push(issue.number)
      else fresh.push(issue)
    }
    const selected = fresh.slice(0, max)
    const dispatched: GithubIssueDispatched[] = []
    const failures: { number: number; code: GithubIssueFailure['error']['code']; message: string }[] = []
    for (const issue of selected) {
      const result = await this.dispatch({
        issue,
        ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
      })
      if (result.ok) {
        dispatched.push({ number: issue.number, sessionId: result.value.sessionId })
        continue
      }
      failures.push({ number: issue.number, code: result.error.code, message: result.error.message })
    }
    const checkedAt = Date.now()
    await this.commitIntakeState(localDayKey(checkedAt, this.autopilotTimeZone), dispatched)
    return {
      ok: true,
      value: Object.freeze({
        checkedAt,
        repoUrl,
        claimable: listed.value,
        dispatched: Object.freeze(dispatched),
        skipped: Object.freeze(skipped),
        failures: Object.freeze(failures),
      }),
    }
  }

  /**
   * Create one Session, queue the issue prompt, and name the Session.
   *
   * The Session is created through the Session controller rather than the Agent
   * registry directly: the controller applies the deployment's preset and
   * workspace policy, so the dispatched Session behaves like one the user
   * opened from the Web. The prompt is queued with the Agent's followup, which
   * wakes the driver without waiting for a turn to be open elsewhere.
   *
   * @param request - the issue and optional Session placement.
   * @returns the created Session, or a stable failure.
   */
  private async dispatch(request: GithubIssueDispatchRequest): Promise<GithubIssueDispatchResult> {
    const controller = optionalService<GithubSessionController>(this.ctx, 'sessionController')
    const agents = optionalService<GithubAgents>(this.ctx, 'agents')
    if (controller === undefined || agents === undefined) return SESSION_UNAVAILABLE
    const cwd = firstNonBlank(request.cwd, this.autopilotCwd)
    const agentPreset = firstNonBlank(request.agentPreset, this.autopilotPreset)
    let sessionId: string
    try {
      const created = await controller.create({
        ...(cwd === undefined ? {} : { cwd }),
        ...(agentPreset === undefined ? {} : { agentPreset }),
      })
      sessionId = created.sessionId
    } catch (error) {
      return { ok: false, error: { code: 'dispatch-failed', message: 'the Session could not be created: ' + describeError(error) } }
    }
    const handle = agents.get(sessionId)
    if (handle === undefined) {
      return {
        ok: false,
        error: { code: 'dispatch-failed', message: 'Session "' + sessionId + '" was created but no live Agent was published for it' },
      }
    }
    try {
      handle.agent.followup({
        content: [{ type: 'text', text: renderDispatchPrompt(this.autopilotPrompt, request.issue) }],
        source: { kind: 'github-issue' },
      })
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'dispatch-failed',
          message: 'Session "' + sessionId + '" was created but the issue prompt was refused: ' + describeError(error),
        },
      }
    }
    void this.renameSession(controller, sessionId, 'Issue #' + request.issue.number + ': ' + request.issue.title)
    this.track('dispatchIssue', 'success', { issue: request.issue.number, sessionId })
    return { ok: true, value: Object.freeze({ sessionId }) }
  }

  /**
   * Name a dispatched Session so the user can recognise it in the sidebar.
   *
   * A title is presentation, not part of the dispatch contract: a deployment
   * that mounts no title service still gets a working Session, so a failure
   * here is logged and never fails the dispatch.
   *
   * @param controller - the Session controller.
   * @param sessionId - the Session to name.
   * @param title - the proposed title.
   */
  private async renameSession(controller: GithubSessionController, sessionId: string, title: string): Promise<void> {
    try {
      await controller.rename?.({ sessionId, title: title.slice(0, 120) })
    } catch (error) {
      this.warn('Session "' + sessionId + '" was created without a title: ' + describeError(error))
    }
  }

  /**
   * Run the first-startup check once per local day.
   *
   * The day is read from durable state, so a restart later the same day does
   * nothing; the check is skipped until the local calendar moves on.
   */
  private async startupIntake(): Promise<void> {
    try {
      const today = localDayKey(Date.now(), this.autopilotTimeZone)
      if (this.intakeState.lastCheckedDay === today) return
      const result = await this.runIntake({})
      if (!result.ok) {
        this.warn('issue intake did not complete: ' + result.error.code + ': ' + result.error.message)
        return
      }
      this.track('startupIntake', 'success', { dispatched: result.value.dispatched.length })
    } catch (error) {
      this.warn('issue intake failed: ' + describeError(error))
    }
  }

  /**
   * Open the durable intake state when this deployment mounts storage.
   *
   * Storage is optional so the service still installs on its own bundle; the
   * startup check then stays off rather than running without a memory of what
   * it already dispatched.
   */
  private async openIntakeState(): Promise<void> {
    const storage = optionalService<GithubStorageDomain>(this.ctx, 'storageDomain')
    if (storage === undefined) return
    try {
      const domain = await storage.open(intakeDomainSpec)
      this.ctx.effect(() => async () => {
        await domain.close()
      }, 'github-issue.intakeStateClose')
      const table = domain.table('state')
      this.intakeTable = table
      this.intakeState = table.get(INTAKE_STATE_KEY) ?? EMPTY_INTAKE_STATE
      this.intakePersistent = true
    } catch (error) {
      this.warn('intake state is unavailable: ' + describeError(error))
    }
  }

  /**
   * Commit one completed pass to durable state.
   *
   * The in-memory state is updated first so the next pass in this process sees
   * the dispatch even when the durable write fails; the warning then names the
   * consequence instead of pretending the write succeeded.
   *
   * @param day - local day the pass completed.
   * @param dispatched - issues handed to a Session in this pass.
   */
  private async commitIntakeState(day: string, dispatched: readonly GithubIssueDispatched[]): Promise<void> {
    const appended = dispatched.map(entry => ({ number: entry.number, day, sessionId: entry.sessionId }))
    const next: IntakeStateRow = Object.freeze({
      lastCheckedDay: day,
      dispatched: Object.freeze([...this.intakeState.dispatched, ...appended].slice(-MAX_DISPATCH_HISTORY)),
    })
    this.intakeState = next
    const table = this.intakeTable
    if (table === undefined) return
    try {
      await table.put(INTAKE_STATE_KEY, next)
    } catch (error) {
      this.warn('intake state could not be saved, so a later pass may dispatch the same issue again: ' + describeError(error))
    }
  }

  /**
   * Build one GitHub client for a call.
   * @param repoUrl - repository override, or the configured repository.
   * @returns the client, carrying the resolved credential.
   */
  private async createClient(repoUrl: string | undefined): Promise<GithubIssueClient> {
    return new GithubIssueClient({
      repoUrl: firstNonBlank(repoUrl, this.repoUrl) ?? this.repoUrl,
      apiBaseUrl: this.apiBaseUrl,
      token: await this.resolveToken(),
      timeoutMs: this.requestTimeoutMs,
    })
  }

  /**
   * Resolve the GitHub credential once.
   *
   * The order is explicit config, then the configured environment variable,
   * then the configured command. The command runs at most once per process so
   * a keyring-backed credential is not fetched on every request, and its output
   * is never logged.
   *
   * @returns the token, or undefined when the deployment has none.
   */
  private async resolveToken(): Promise<string | undefined> {
    if (this.tokenResolved) return this.resolvedToken
    this.tokenResolved = true
    const direct = firstNonBlank(this.token)
    if (direct !== undefined) return (this.resolvedToken = direct)
    const fromEnv = this.tokenEnv.length === 0 ? undefined : firstNonBlank(process.env[this.tokenEnv])
    if (fromEnv !== undefined) return (this.resolvedToken = fromEnv)
    if (this.tokenCommand.trim().length === 0) return undefined
    try {
      const { stdout } = await execAsync(this.tokenCommand, {
        timeout: this.tokenCommandTimeoutMs,
        windowsHide: true,
        maxBuffer: 64 * 1024,
      })
      const fromCommand = firstNonBlank(stdout)
      if (fromCommand !== undefined) return (this.resolvedToken = fromCommand)
    } catch (error) {
      this.warn('token command failed: ' + describeError(error))
    }
    return undefined
  }

  /**
   * The telemetry feature anchor for one intake action.
   * @param action - the method the event belongs to.
   * @returns the stable feature-code reference.
   */
  private featureCode(action: string): string {
    return TELEMETRY_PLUGIN_ID + ':' + action
  }

  /**
   * Log one non-fatal intake problem.
   * @param message - what went wrong and what it costs.
   */
  private warn(message: string): void {
    const logger = (this.ctx as unknown as { logger?: { warn(message: string): void } }).logger
    logger?.warn('github-issue: ' + message)
  }

  /**
   * Report one model failure and return the business failure.
   *
   * The preserved DSH code goes into both the message and the telemetry event:
   * the message is what a user reads, and the event is what a later analysis
   * groups on. Reporting either as a bare "the model produced no output" is how
   * an unroutable provider was mistaken for a model that answered nothing.
   *
   * @param action - the method the failure happened in, and its telemetry action.
   * @param route - the route the call was sent to.
   * @param failure - the preserved DSH failure facts.
   * @returns the business failure to return to the caller.
   */
  private llmFailure(
    action: 'generateReport' | 'optimizeIssue',
    route: LlmRoute,
    failure: LlmTextResult & { ok: false },
  ): { ok: false; error: { code: 'llm-failure'; message: string } } {
    const detail = failure.failure
    const message = `model call to provider "${route.provider}" model "${route.model}" failed: ${detail.code}: ${detail.message}`
    this.trackError(
      action,
      { code: detail.code, message: detail.message, featureCodeRef: `${TELEMETRY_PLUGIN_ID}:${action}` },
      { ...this.routeFacts(route), ...(detail.status === undefined ? {} : { status: detail.status }) },
    )
    return { ok: false, error: { code: 'llm-failure', message } }
  }

  /**
   * Report a call that arrived with no resolvable route.
   *
   * Recorded as a failure rather than silently skipped: this is the defect that
   * produced an empty model response from every click of the issue editor's
   * optimize button, and it left no trace anywhere, so it was found by a user
   * report instead of by the telemetry it should have written.
   *
   * @param action - the method the call was made to, and its telemetry action.
   * @returns the business failure to return to the caller.
   */
  private routeMissing(action: 'generateReport' | 'optimizeIssue') {
    this.trackError(
      action,
      { code: NO_MODEL_ROUTE_CODE, message: ROUTE_MISSING.error.message, featureCodeRef: `${TELEMETRY_PLUGIN_ID}:${action}` },
      {},
    )
    return ROUTE_MISSING
  }

  /**
   * The route facts every AI-related telemetry event carries.
   *
   * Success events carry them for the same reason failures do: a record that
   * names the route only when it broke cannot say which route served the calls
   * that worked, so a later analysis cannot tell whether the route changed.
   *
   * @param route - the route the call used.
   * @returns the provider and model to merge into an event's metadata.
   */
  private routeFacts(route: LlmRoute): { provider: string; model: string } {
    return { provider: route.provider, model: route.model }
  }

  /**
   * Record one completed call, when this deployment has telemetry mounted.
   *
   * @param action - the method the call was made to.
   * @param result - whether it succeeded.
   * @param metadata - structured context, such as the route.
   */
  private track(action: string, result: 'success' | 'failure', metadata?: Record<string, unknown>): void {
    const telemetry = this.ctx.get('telemetry') as TelemetrySink | undefined
    telemetry?.track({
      pluginId: TELEMETRY_PLUGIN_ID,
      action,
      result,
      ...(metadata === undefined ? {} : { metadata }),
    })
  }

  /**
   * Record one failure, when this deployment has telemetry mounted.
   *
   * @param action - the method the failure happened in.
   * @param error - the failure code, message, and feature anchor.
   * @param metadata - structured context, such as the attempted route.
   */
  private trackError(
    action: string,
    error: { code: string; message: string; featureCodeRef?: string },
    metadata?: Record<string, unknown>,
  ): void {
    const telemetry = this.ctx.get('telemetry') as TelemetrySink | undefined
    telemetry?.trackError({
      pluginId: TELEMETRY_PLUGIN_ID,
      action,
      error,
      ...(metadata === undefined ? {} : { metadata }),
    })
  }
}

/**
 * The first argument that carries a non-blank value.
 *
 * @param values - candidate values, most specific first.
 * @returns the trimmed value, or `undefined` when all are blank or absent.
 */
function firstNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

/**
 * Build the user-facing prompt from a telemetry analysis, listing every
 * failure group with its feature-code anchor, error code, and message.
 *
 * The facts are stated flatly and dated: a report that receives only totals and
 * error codes can say nothing about whether a failure still happens, and a model
 * asked to explain it will invent mechanisms the plugin does not have. Every
 * line here is one the plugin actually recorded, and a missing fact is labelled
 * as missing rather than omitted, so the model can tell "not recorded" from
 * "nothing to report".
 *
 * @param request - the analysis input.
 * @returns the structured prompt text.
 */
function buildReportUserPrompt(request: GithubIssueGenerateReportRequest): string {
  const groups = request.failureGroups.map(group => {
    const lines = [`- featureCodeRef: ${group.featureCodeRef}`, `  count: ${group.count}`]
    if (group.errorCode !== undefined) lines.push(`  errorCode: ${group.errorCode}`)
    if (group.errorMessage !== undefined) lines.push(`  errorMessage: ${group.errorMessage}`)
    lines.push(`  route: ${group.route === undefined ? NOT_RECORDED : `${group.route.provider} / ${group.route.model}${group.route.status === undefined ? '' : ` (status ${group.route.status})`}`}`)
    lines.push(`  lastFailureAt: ${group.lastFailureAt === undefined ? NOT_RECORDED : new Date(group.lastFailureAt).toISOString()}`)
    lines.push(`  attemptsAfterLastFailure: ${group.attemptsAfterLastFailure ?? NOT_RECORDED}`)
    return lines.join('\n')
  }).join('\n')
  const window = request.window === undefined
    ? `Analysis window: ${NOT_RECORDED}`
    : `Analysis window: ${new Date(request.window.firstEventAt).toISOString()} .. ${new Date(request.window.lastEventAt).toISOString()}`
  return [
    `Plugins: ${request.pluginIds.length === 0 ? NOT_RECORDED : request.pluginIds.join(', ')}`,
    window,
    `Total events: ${request.totalEvents}`,
    `Total failures: ${request.totalFailures}`,
    '',
    'Failure groups:',
    groups.length === 0 ? '(none)' : groups,
  ].join('\n')
}

/**
 * Extract a title from the first Markdown heading of the body, if present.
 * @param body - the Markdown body.
 * @returns the heading text without the `## ` prefix, or `undefined`.
 */
function extractTitle(body: string): string | undefined {
  const match = /^##\s+(.+?)$/mu.exec(body)
  return match?.[1]?.trim()
}

/**
 * Upper bound on the shortening passes in {@link buildPrefillUrl}. Each pass
 * removes at least the overflow it measured, so a handful of passes converge;
 * the bound exists only so a pathological input cannot spin.
 */
const MAX_PREFILL_TRUNCATION_PASSES = 32

/**
 * Build the pre-filled new-issue URL, shortening the body so the URL stays
 * within `maxLength`.
 *
 * The budget is checked on the composed URL rather than on the body alone,
 * because the title and labels spend the same budget and percent-encoding
 * inflates whatever they contain; a body-length rule would still emit a URL
 * GitHub refuses. Each pass removes at least the overflow it measured, which
 * can overshoot when characters encode to more than one URL character, and
 * overshooting only shortens the body further.
 *
 * @param repoUrl - the repository URL, already validated by the caller.
 * @param report - the report to prefill.
 * @param maxLength - the longest acceptable URL; `0` or less disables shortening.
 * @param note - appended to the body when shortening was necessary.
 * @returns the pre-filled issue URL.
 */
function buildPrefillUrl(repoUrl: string, report: GithubIssueReport, maxLength: number, note: string): string {
  const compose = (body: string): string => {
    const params = new URLSearchParams()
    params.set('title', report.title)
    params.set('body', body)
    if (report.labels.length > 0) params.set('labels', report.labels.join(','))
    return `${repoUrl}/issues/new?${params.toString()}`
  }

  const full = compose(report.body)
  if (maxLength <= 0 || full.length <= maxLength) return full

  let keep = report.body.length
  let candidate = compose(`${report.body.slice(0, keep)}${note}`)
  for (
    let pass = 0;
    pass < MAX_PREFILL_TRUNCATION_PASSES && candidate.length > maxLength && keep > 0;
    pass += 1
  ) {
    keep = Math.max(0, keep - Math.max(1, candidate.length - maxLength))
    candidate = compose(`${report.body.slice(0, keep)}${note}`)
  }
  // Reachable only when the note alone exceeds the limit. Sending the note is
  // then the most that fits, which beats emitting a URL GitHub rejects.
  return candidate.length <= maxLength ? candidate : compose(note)
}

/**
 * Read one optional host service by its Cordis key.
 *
 * The intake loop works with services this package does not depend on: a
 * deployment may mount no storage, no Session controller, or no Agent registry.
 * Reading them by key keeps those features optional without turning the plugin
 * into a hard dependency of the whole Web composition.
 *
 * @param ctx - the host context.
 * @param name - the service key.
 * @returns the service, or undefined when this deployment mounts none.
 */
function optionalService<T>(ctx: Context, name: string): T | undefined {
  const get = ctx.get as unknown as (key: string) => unknown
  return get.call(ctx, name) as T | undefined
}

/**
 * Bound one requested issue count to the accepted range.
 * @param value - the requested count.
 * @returns an integer from 1 through 100.
 */
function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(100, Math.max(1, Math.trunc(value)))
}

/**
 * Render an unknown thrown value as a message.
 * @param error - the thrown value.
 * @returns a non-empty message.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export default GithubIssueService
