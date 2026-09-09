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
}

/** Schemastery configuration for the GitHub-issue service. */
export const Config: s<Config> = s.object({
  repoUrl: s.string().default('https://github.com/zhangj1164/dsh-mega-plugins'),
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

/** The built-in system prompt that generates a report from telemetry analysis. */
const REPORT_SYSTEM_PROMPT = [
  'You are a diagnostic report generator. Given a plugin\'s telemetry failure',
  'analysis, produce a GitHub issue report that correlates each failure group',
  'against the plugin\'s feature code. For each group, state the feature-code',
  'anchor, the error code and message, the likely cause, and a suggested fix.',
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

  /**
   * @param ctx - Host context carrying the llm service.
   * @param config - Validated deployment configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'githubIssue')
    this.repoUrl = config.repoUrl
  }

  /**
   * Generate a uniform GitHub issue report from a telemetry failure analysis.
   * Calls the configured model with a built-in structuring prompt.
   * @param request - the analysis input from the telemetry service.
   * @returns the generated report or an LLM failure.
   */
  @Remote('generateReport')
  async generateReport(request: GithubIssueGenerateReportRequest): Promise<GithubIssueGenerateReportResult> {
    const userPrompt = buildReportUserPrompt(request)
    const body = await this.streamModelText(request.provider, request.model, REPORT_SYSTEM_PROMPT, userPrompt)
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
   * @param request - the repository URL and the report to prefill.
   * @returns the prefill URL or an invalid-URL failure.
   */
  @Remote('prefilledIssueUrl')
  prefilledIssueUrl(request: GithubIssuePrefillRequest): GithubIssuePrefillResult {
    const repoUrl = request.repoUrl.length > 0 ? request.repoUrl : this.repoUrl
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/u.test(repoUrl)) {
      return { ok: false, error: { code: 'invalid-url', message: `repoUrl "${repoUrl}" is not a valid GitHub repository URL` } }
    }
    const params = new URLSearchParams()
    params.set('title', request.report.title)
    params.set('body', request.report.body)
    params.set('labels', request.report.labels.join(','))
    return { ok: true, value: `${repoUrl}/issues/new?${params.toString()}` }
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
    const body = await this.streamModelText(request.provider, request.model, OPTIMIZE_SYSTEM_PROMPT, request.description)
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
 * Build the user-facing prompt from a telemetry analysis, listing every
 * failure group with its feature-code anchor, error code, and message.
 * @param request - the analysis input.
 * @returns the structured prompt text.
 */
function buildReportUserPrompt(request: GithubIssueGenerateReportRequest): string {
  const groups = request.failureGroups.map(group => {
    const lines = [`- featureCodeRef: ${group.featureCodeRef}`, `  count: ${group.count}`]
    if (group.errorCode !== undefined) lines.push(`  errorCode: ${group.errorCode}`)
    if (group.errorMessage !== undefined) lines.push(`  errorMessage: ${group.errorMessage}`)
    return lines.join('\n')
  }).join('\n')
  return [
    `Plugin: ${request.pluginId}`,
    `Total events: ${request.totalEvents}`,
    `Total failures: ${request.totalFailures}`,
    '',
    'Failure groups:',
    groups,
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

export default GithubIssueService
