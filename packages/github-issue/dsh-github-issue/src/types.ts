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
  /** The plugin id whose failures were analyzed. */
  readonly pluginId: string
  /** Total events recorded for the plugin. */
  readonly totalEvents: number
  /** Total failure events recorded for the plugin. */
  readonly totalFailures: number
  /** Failure groups from the telemetry analysis, joined on feature-code anchor. */
  readonly failureGroups: readonly GithubIssueFailureGroupInput[]
  /** Provider route for the model call. */
  readonly provider: string
  /** Model id for the model call. */
  readonly model: string
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
  | { readonly ok: false; readonly error: { readonly code: 'llm-failure'; readonly message: string } }

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
  /** Provider route for the model call. */
  readonly provider: string
  /** Model id for the model call. */
  readonly model: string
}

/** Result of issue optimization. */
export type GithubIssueOptimizeResult =
  | { readonly ok: true; readonly value: GithubIssueReport }
  | { readonly ok: false; readonly error: { readonly code: 'llm-failure' | 'empty-input'; readonly message: string } }
