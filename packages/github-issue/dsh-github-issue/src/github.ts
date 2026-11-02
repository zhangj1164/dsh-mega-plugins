/**
 * GitHub REST client for the issue intake loop.
 *
 * Two operations only: create one issue from an optimized report, and list the
 * open issues that carry the configured claim label. Every failure is reported
 * as one of the stable codes in `GithubIssueFailureCode`, so the service above
 * never has to interpret a raw `fetch` error or an HTTP status on its own.
 *
 * @module @zhangj1164/dsh-github-issue/github
 */

import type {
  GithubIssueCreateResult,
  GithubIssueFailure,
  GithubIssueListResult,
  GithubIssueReport,
  GithubIssueTask,
} from './types.ts'

/** Where one repository lives. */
export interface GithubRepository {
  /** Repository owner (user or organization). */
  readonly owner: string
  /** Repository name. */
  readonly repo: string
}

/** One API request the client sends. */
export interface GithubRequest {
  /** HTTP verb. */
  readonly method: 'GET' | 'POST'
  /** Path below the API base, already percent-encoded where needed. */
  readonly path: string
  /** JSON body for a write request. */
  readonly body?: unknown
}

/** One decoded API response, either JSON or a stable failure. */
export type GithubApiResult<T> = { readonly ok: true; readonly value: T } | GithubIssueFailure

/** Construction options for {@link GithubIssueClient}. */
export interface GithubIssueClientOptions {
  /** Repository URL the calls address. */
  readonly repoUrl: string
  /** API origin: `https://api.github.com` for github.com, or an Enterprise origin. */
  readonly apiBaseUrl: string
  /** Bearer token, or `undefined` when the deployment has no credential. */
  readonly token: string | undefined
  /** Fetch implementation; defaults to the process-wide `fetch`. */
  readonly fetchImpl?: typeof fetch
  /** Request deadline in milliseconds. */
  readonly timeoutMs: number
}

/**
 * The GitHub REST API version this client speaks.
 *
 * Pinned rather than configurable: it is the protocol the request shape was
 * written against, and a deployment that changed it would silently receive a
 * different response schema.
 */
const GITHUB_API_VERSION = '2022-11-28'

/** User-Agent GitHub requires on every REST request. */
const USER_AGENT = '@zhangj1164/dsh-github-issue'

/** Repository URLs of the form `https://host/owner/repo`, with one optional trailing slash. */
const REPOSITORY_URL = /^https?:\/\/[^/\s]+\/([^/\s]+)\/([^/\s]+?)\/?$/u

/**
 * Split a repository URL into owner and name.
 * @param repoUrl - the configured repository URL.
 * @returns the repository parts, or `undefined` when the URL is not one.
 */
export function parseRepository(repoUrl: string): GithubRepository | undefined {
  const match = REPOSITORY_URL.exec(repoUrl.trim())
  if (match?.[1] === undefined || match[2] === undefined) return undefined
  return { owner: match[1], repo: match[2] }
}

/**
 * GitHub issue intake over the REST API.
 *
 * The class owns request construction, authentication, and response
 * classification. It holds no state and caches nothing, so one instance can
 * serve every repository a deployment configures.
 */
export class GithubIssueClient {
  private readonly repoUrl: string
  private readonly repository: GithubRepository | undefined
  private readonly apiBaseUrl: string
  private readonly token: string | undefined
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  /**
   * @param options - repository, credential, and transport policy.
   */
  constructor(options: GithubIssueClientOptions) {
    this.repoUrl = options.repoUrl
    this.repository = parseRepository(options.repoUrl)
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/u, '')
    this.token = options.token
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs
  }

  /**
   * Create one issue in the configured repository.
   *
   * @param report - the optimized issue report; its title becomes the issue
   *   title and its body the issue body.
   * @returns the created issue's number and URL, or a stable failure.
   */
  async createIssue(report: GithubIssueReport): Promise<GithubIssueCreateResult> {
    const repository = this.repository
    if (repository === undefined) return this.fail('invalid-repo', `"${this.repoUrl}" is not a repository URL`)
    if (this.token === undefined) {
      return this.fail('auth-missing', 'no GitHub token is configured; set the configured token environment variable or token command')
    }
    const title = report.title.trim()
    if (title.length === 0) return this.fail('invalid-request', 'the issue report has no title')
    const response = await this.send({
      method: 'POST',
      path: `/repos/${repository.owner}/${repository.repo}/issues`,
      body: {
        title,
        body: report.body,
        labels: [...report.labels],
      },
    })
    if (!response.ok) return response
    const payload = response.value
    const number = readNumber(payload, 'number')
    const url = readString(payload, 'html_url')
    if (number === undefined || url === undefined) {
      return this.fail('http-failure', 'GitHub accepted the issue but the response carried no number or URL')
    }
    return { ok: true, value: Object.freeze({ number, url }) }
  }

  /**
   * List open issues carrying one claim label.
   *
   * Pull requests are excluded explicitly: GitHub's issue endpoints return
   * them, and a pull request is never an issue a session should claim.
   *
   * @param label - the claim label every returned issue carries.
   * @param max - the largest number of issues to request.
   * @returns the matching issues, or a stable failure.
   */
  async listClaimable(label: string, max: number): Promise<GithubIssueListResult> {
    const repository = this.repository
    if (repository === undefined) return this.fail('invalid-repo', `"${this.repoUrl}" is not a repository URL`)
    if (this.token === undefined) {
      return this.fail('auth-missing', 'no GitHub token is configured; set the configured token environment variable or token command')
    }
    const query = new URLSearchParams({ state: 'open', labels: label, per_page: String(max) })
    const response = await this.send({
      method: 'GET',
      path: `/repos/${repository.owner}/${repository.repo}/issues?${query.toString()}`,
    })
    if (!response.ok) return response
    if (!Array.isArray(response.value)) {
      return this.fail('http-failure', 'GitHub returned a list response that is not an array')
    }
    const tasks: GithubIssueTask[] = []
    for (const entry of response.value) {
      const task = asTask(entry, label)
      if (task !== undefined) tasks.push(task)
    }
    return { ok: true, value: Object.freeze(tasks) }
  }

  /**
   * Send one request and decode its JSON body.
   * @param request - verb, path, and optional body.
   * @returns the decoded payload or a classified failure.
   */
  private async send(request: GithubRequest): Promise<GithubApiResult<unknown>> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${request.path}`, {
        method: request.method,
        headers: this.headers(),
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      return this.fail('network-failure', `the request to GitHub failed: ${describeError(error)}`)
    }
    if (!response.ok) return this.httpFailure(response)
    try {
      const text = await response.text()
      return { ok: true, value: text.trim().length === 0 ? {} : JSON.parse(text) }
    } catch (error) {
      return this.fail('http-failure', `GitHub returned a response that could not be read: ${describeError(error)}`)
    }
  }

  /**
   * Classify one non-success HTTP response.
   * @param response - the failed response.
   * @returns the stable failure for its status.
   */
  private async httpFailure(response: Response): Promise<GithubIssueFailure> {
    const detail = await readErrorMessage(response)
    if (response.status === 401) {
      return this.fail('auth-failure', `GitHub rejected the token (401)${detail}`)
    }
    if (response.status === 403) {
      const remaining = response.headers.get('x-ratelimit-remaining')
      if (remaining === '0') {
        return this.fail('rate-limited', `GitHub rate limit exhausted (403)${detail}`)
      }
      return this.fail('auth-failure', `GitHub refused the request (403)${detail}`)
    }
    if (response.status === 422) {
      return this.fail('invalid-request', `GitHub rejected the request as invalid (422)${detail}`)
    }
    return this.fail('http-failure', `GitHub returned HTTP ${response.status}${detail}`)
  }

  /**
   * The headers every request carries.
   * @returns the header map, including the bearer token when one is configured.
   */
  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
      'x-github-api-version': GITHUB_API_VERSION,
    }
    if (this.token !== undefined) headers.authorization = `Bearer ${this.token}`
    return headers
  }

  /**
   * Build one failure result.
   * @param code - stable failure code.
   * @param message - user-facing explanation.
   * @returns the failure result.
   */
  private fail(code: GithubIssueFailure['error']['code'], message: string): GithubIssueFailure {
    return { ok: false, error: { code, message } }
  }
}

/**
 * Read a string member from an unknown JSON object.
 * @param value - decoded JSON.
 * @param key - member name.
 * @returns the string value, or `undefined`.
 */
function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined
  const member = value[key]
  return typeof member === 'string' ? member : undefined
}

/**
 * Read a numeric member from an unknown JSON object.
 * @param value - decoded JSON.
 * @param key - member name.
 * @returns the number value, or `undefined`.
 */
function readNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined
  const member = value[key]
  return typeof member === 'number' && Number.isFinite(member) ? member : undefined
}

/**
 * Narrow one decoded API entry into a claimable task.
 *
 * Malformed entries and pull requests are skipped rather than failing the whole
 * list: one unexpected row must not hide every real task behind it.
 *
 * @param entry - one array member of the issues response.
 * @param label - the claim label the entry must carry.
 * @returns the task, or `undefined` when the entry is not claimable.
 */
function asTask(entry: unknown, label: string): GithubIssueTask | undefined {
  if (!isRecord(entry)) return undefined
  if ('pull_request' in entry) return undefined
  const number = readNumber(entry, 'number')
  const title = readString(entry, 'title')
  const url = readString(entry, 'html_url')
  if (number === undefined || title === undefined || url === undefined) return undefined
  const labels = readLabels(entry['labels'])
  if (!labels.some(name => name.toLowerCase() === label.toLowerCase())) return undefined
  const body = readString(entry, 'body') ?? ''
  return Object.freeze({ number, title, body, url, labels: Object.freeze(labels) })
}

/**
 * Read the label names of one issue.
 * @param value - untyped `labels` member.
 * @returns the non-empty names, in response order.
 */
function readLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const entry of value) {
    const name = isRecord(entry) ? readString(entry, 'name') : undefined
    if (name !== undefined && name.length > 0) names.push(name)
  }
  return names
}

/**
 * Read the message GitHub attached to a failed response.
 * @param response - the failed response.
 * @returns `: message` for the failure text, or an empty string.
 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text()
    if (text.length === 0) return ''
    const parsed: unknown = JSON.parse(text)
    const message = isRecord(parsed) ? readString(parsed, 'message') : undefined
    return message === undefined || message.length === 0 ? '' : `: ${message}`
  } catch {
    return ''
  }
}

/**
 * Report whether an unknown value is a plain object.
 * @param value - candidate value.
 * @returns true for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
