/**
 * Pure types of the GitHub-issue domain: the one home of the issue report
 * template, request/response contracts, and the built-in optimization prompt
 * identity. Free of this package's host-side value imports.
 *
 * The issue report template is pinned Markdown so reports are uniform: every
 * generated report follows the same section structure, which is what makes the
 * GitHub prefill and human review consistent.
 *
 * @module @zhangj1164/dsh-github-issue/types
 */

/** Input for generating a GitHub issue report from telemetry analysis. */
export interface GithubIssueGenerateReportRequest {
  /**
   * The plugin ids whose failures were analyzed, in the order they were read.
   *
   * A list rather than one id because a suite is what a reader cares about: a
   * report covering only `memo` cannot mention a `github-issue` failure, and the
   * packages of one deployment fail and get fixed together.
   */
  readonly pluginIds: readonly string[]
  /** Total events recorded for the analyzed plugins. */
  readonly totalEvents: number
  /** Total failure events recorded for the analyzed plugins. */
  readonly totalFailures: number
  /** Failure groups from the telemetry analysis, joined on feature-code anchor. */
  readonly failureGroups: readonly GithubIssueFailureGroupInput[]
  /**
   * Provider route override; omit to use this service's `Config` or the
   * deployment's `agentDefaultModel`.
   */
  readonly provider?: string
  /** Model id override; omit to follow the same fallback as `provider`. */
  readonly model?: string
  /**
   * Time range the analysis read, when it read any events. A report without it
   * cannot be told apart from one about a live incident.
   */
  readonly window?: GithubIssueAnalysisWindow
}

/** The time range one telemetry analysis covered. */
export interface GithubIssueAnalysisWindow {
  /** Timestamp (epoch ms) of the oldest event considered. */
  readonly firstEventAt: number
  /** Timestamp (epoch ms) of the newest event considered. */
  readonly lastEventAt: number
}

/** One failure group input — the analysis projection of a feature-code group. */
export interface GithubIssueFailureGroupInput {
  /** The feature-code anchor shared by every event in this group. */
  readonly featureCodeRef: string
  /** Number of failures in this group. */
  readonly count: number
  /** The most recent failure's error code, when known. */
  readonly errorCode?: string
  /** The most recent failure's error message. */
  readonly errorMessage?: string
  /** Timestamp (epoch ms) of the most recent failure, when the analysis knew it. */
  readonly lastFailureAt?: number
  /** Attempts of the same action recorded after the most recent failure. */
  readonly attemptsAfterLastFailure?: number
  /** Route the most recent failure ran on, when those events recorded one. */
  readonly route?: GithubIssueFailureRoute
}

/** The model route a failure group ran on. */
export interface GithubIssueFailureRoute {
  /** Provider id the failing call used. */
  readonly provider: string
  /** Model id the failing call used. */
  readonly model: string
  /** HTTP-style status the adapter reported, when it reported one. */
  readonly status?: number
}

/** The generated GitHub issue report. */
export interface GithubIssueReport {
  /** Issue title (concise summary). */
  readonly title: string
  /** Full issue body in Markdown, following the pinned template. */
  readonly body: string
  /** Labels for the issue. */
  readonly labels: readonly string[]
}

/** Result of report generation. */
export type GithubIssueGenerateReportResult =
  | { readonly ok: true; readonly value: GithubIssueReport }
  | { readonly ok: false; readonly error: { readonly code: 'llm-failure' | 'route-missing'; readonly message: string } }

/** Request to build a pre-filled GitHub issue creation URL. */
export interface GithubIssuePrefillRequest {
  /** The repository URL (e.g. `https://github.com/owner/repo`). */
  readonly repoUrl: string
  /** The report to prefill. */
  readonly report: GithubIssueReport
}

/** Result of the prefill URL construction. */
export type GithubIssuePrefillResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: { readonly code: 'invalid-url'; readonly message: string } }

/** Input for optimizing a natural-language issue description with the model. */
export interface GithubIssueOptimizeRequest {
  /** The user's raw natural-language description of the problem. */
  readonly description: string
  /**
   * Provider route override; omit to use this service's `Config` or the
   * deployment's `agentDefaultModel`.
   */
  readonly provider?: string
  /** Model id override; omit to follow the same fallback as `provider`. */
  readonly model?: string
}

/** Result of issue optimization. */
export type GithubIssueOptimizeResult =
  | { readonly ok: true; readonly value: GithubIssueReport }
  | { readonly ok: false; readonly error: { readonly code: 'llm-failure' | 'empty-input' | 'route-missing'; readonly message: string } }
/** One open issue a session can claim and work on. */
export interface GithubIssueTask {
  /** Issue number inside its repository. */
  readonly number: number
  /** Issue title. */
  readonly title: string
  /** Issue body in Markdown; empty when the issue has none. */
  readonly body: string
  /** Canonical browser URL of the issue. */
  readonly url: string
  /** Every label name the issue carries. */
  readonly labels: readonly string[]
}

/**
 * Stable failure codes the issue intake calls report.
 *
 * The codes are the contract: a caller decides what to do from the code, and
 * the message exists for the human reading the failure. `auth-missing` is
 * separate from `auth-failure` because no credential and a rejected credential
 * are different deployment problems with different fixes.
 */
export type GithubIssueFailureCode =
  | 'auth-missing'
  | 'auth-failure'
  | 'rate-limited'
  | 'invalid-repo'
  | 'invalid-request'
  | 'http-failure'
  | 'network-failure'
  | 'session-unavailable'
  | 'dispatch-failed'

/** One failed issue intake call. */
export interface GithubIssueFailure {
  /** Failure discriminator. */
  readonly ok: false
  /** The code and the user-facing message. */
  readonly error: { readonly code: GithubIssueFailureCode; readonly message: string }
}

/** Request to create one issue from an optimized report. */
export interface GithubIssueCreateRequest {
  /** Repository URL override; omit to use this service's configured `repoUrl`. */
  readonly repoUrl?: string
  /** The report to file. */
  readonly report: GithubIssueReport
}

/** The issue GitHub created. */
export interface GithubIssueCreated {
  /** Issue number inside the repository. */
  readonly number: number
  /** Canonical browser URL of the new issue. */
  readonly url: string
}

/** Result of filing one issue. */
export type GithubIssueCreateResult =
  | { readonly ok: true; readonly value: GithubIssueCreated }
  | GithubIssueFailure

/** Request to list the open issues carrying the claim label. */
export interface GithubIssueListRequest {
  /** Repository URL override; omit to use this service's configured `repoUrl`. */
  readonly repoUrl?: string
  /** Claim label override; omit to use the configured `claimLabel`. */
  readonly claimLabel?: string
  /** Largest number of issues to request; omit to use `maxIssuesPerRun`. */
  readonly max?: number
}

/** Result of listing claimable issues. */
export type GithubIssueListResult =
  | { readonly ok: true; readonly value: readonly GithubIssueTask[] }
  | GithubIssueFailure

/** Request to hand one issue to a new Session. */
export interface GithubIssueDispatchRequest {
  /** The issue to work on. */
  readonly issue: GithubIssueTask
  /** Working directory the Session owns; omit to use the configured default. */
  readonly cwd?: string
  /** Agent preset the Session runs; omit to use the configured default. */
  readonly agentPreset?: string
}

/** Result of dispatching one issue. */
export type GithubIssueDispatchResult =
  | { readonly ok: true; readonly value: { readonly sessionId: string } }
  | GithubIssueFailure

/** Request to run one intake pass over the configured repository. */
export interface GithubIssueIntakeRequest {
  /** Repository URL override; omit to use this service's configured `repoUrl`. */
  readonly repoUrl?: string
  /** Claim label override; omit to use the configured `claimLabel`. */
  readonly claimLabel?: string
  /** Largest number of issues to dispatch in this pass. */
  readonly max?: number
  /** Working directory each dispatched Session owns. */
  readonly cwd?: string
  /** Agent preset each dispatched Session runs. */
  readonly agentPreset?: string
}

/** One issue handed to a Session during an intake pass. */
export interface GithubIssueDispatched {
  /** Issue number. */
  readonly number: number
  /** Session created for it. */
  readonly sessionId: string
}

/** One issue an intake pass selected but could not dispatch. */
export interface GithubIssueIntakeFailure {
  /** Issue number. */
  readonly number: number
  /** Stable failure code. */
  readonly code: GithubIssueFailureCode
  /** User-facing explanation. */
  readonly message: string
}

/** What one intake pass did. */
export interface GithubIssueIntakeValue {
  /** Wall-clock time the pass ran, in epoch milliseconds. */
  readonly checkedAt: number
  /** Repository the pass read. */
  readonly repoUrl: string
  /** Issues the claim label selected. */
  readonly claimable: readonly GithubIssueTask[]
  /** Issues handed to a Session in this pass. */
  readonly dispatched: readonly GithubIssueDispatched[]
  /** Issue numbers skipped because an earlier pass already dispatched them. */
  readonly skipped: readonly number[]
  /** Issues the pass selected but could not dispatch. */
  readonly failures: readonly GithubIssueIntakeFailure[]
}

/** Result of one intake pass. */
export type GithubIssueIntakeResult =
  | { readonly ok: true; readonly value: GithubIssueIntakeValue }
  | GithubIssueFailure
