/**
 * Pure types of the GitHub-issue domain: the one home of the issue report
 * template, request/response contracts, and the built-in optimization prompt
 * identity. Free of this package's host-side value imports.
 *
 * The issue report template is pinned Markdown so reports are uniform: every
 * generated report follows the same section structure, which is what makes the
 * GitHub prefill and human review consistent.
 *
 * @module dsh-github-issue/types
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
