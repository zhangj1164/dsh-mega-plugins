/**
 * GitHub-issue generation service: builds uniform GitHub issue reports from
 * telemetry analysis, constructs pre-filled issue-creation URLs, and optimizes
 * natural-language issue descriptions with the configured model.
 *
 * Extends `TypertRemoteService` because the client issue-editor UI calls
 * `optimizeIssue` and `prefilledIssueUrl` directly, and the memo log-analysis
 * flow calls `generateReport`.
 *
 * @module dsh-github-issue
 */

import { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { StreamChunk, GenerateOptions } from '@deepseek-ai/dsh-llm'
import { createUserMessage, type Message } from '@deepseek-ai/dsh-llm'
import type {
  GithubIssueGenerateReportRequest,
  GithubIssueGenerateReportResult,
  GithubIssueOptimizeRequest,
  GithubIssueOptimizeResult,
  GithubIssuePrefillRequest,
  GithubIssuePrefillResult,
  GithubIssueReport,
} from './types.ts'

export type * from './types.ts'

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
}

/** Schemastery configuration for the GitHub-issue service. */
export const Config: s<Config> = s.object({
  repoUrl: s.string().default('https://github.com/zhangj1164/dsh-mega-plugins'),
  maxPrefillUrlLength: s.number().default(7000),
  prefillTruncationNote: s.string().default('\n\n> （正文过长，已截断以适配 GitHub 的 URL 长度限制。完整正文见备忘面板的「复制完整正文」。）'),
  provider: s.string(),
  model: s.string(),
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

/**
 * GitHub-issue generation and optimization service over the configured model.
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

  /**
   * @param ctx - Host context carrying the llm service.
   * @param config - Validated deployment configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'githubIssue')
    this.repoUrl = config.repoUrl
    this.maxPrefillUrlLength = config.maxPrefillUrlLength
    this.prefillTruncationNote = config.prefillTruncationNote
    this.provider = config.provider
    this.model = config.model
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
    if (route === undefined) return ROUTE_MISSING
    const userPrompt = buildReportUserPrompt(request)
    const body = await this.streamModelText(route.provider, route.model, REPORT_SYSTEM_PROMPT, userPrompt)
    if (body === undefined) {
      return { ok: false, error: { code: 'llm-failure', message: 'the model produced no output' } }
    }
    const title = extractTitle(body) ?? `Telemetry failures in ${request.pluginId}`
    return {
      ok: true,
      value: Object.freeze({ title, body, labels: Object.freeze(['bug', 'telemetry']) }),
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
    if (route === undefined) return ROUTE_MISSING
    const body = await this.streamModelText(route.provider, route.model, OPTIMIZE_SYSTEM_PROMPT, request.description)
    if (body === undefined) {
      return { ok: false, error: { code: 'llm-failure', message: 'the model produced no output' } }
    }
    const title = extractTitle(body) ?? 'New issue'
    return {
      ok: true,
      value: Object.freeze({ title, body, labels: Object.freeze(['bug']) }),
    }
  }

  /**
   * Stream one model call and collect the text output. Returns `undefined`
   * when the stream produced no text or terminated with an error.
   * @param provider - registered provider route.
   * @param model - model id.
   * @param system - system prompt text.
   * @param userText - user message text.
   * @returns the concatenated text, or `undefined` on empty or errored output.
   */
  private async streamModelText(provider: string, model: string, system: string, userText: string): Promise<string | undefined> {
    const llm = this.ctx.get('llm')
    if (llm === undefined) return undefined
    const message = createUserMessage({
      content: [{ type: 'text', text: userText }],
      source: { kind: 'user' },
    })
    const options: GenerateOptions = {
      provider,
      model,
      messages: [message as Message],
      system,
    }
    let text = ''
    for await (const chunk of llm.stream(options) as AsyncIterable<StreamChunk>) {
      if (chunk.type === 'text-delta') {
        text += chunk.text
      } else if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
        return undefined
      }
    }
    return text.length > 0 ? text : undefined
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
    `Plugin: ${request.pluginId}`,
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

export default GithubIssueService
