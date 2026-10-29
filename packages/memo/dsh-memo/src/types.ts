/**
 * Pure types of the local memo domain: the one home of the memo entry, week,
 * and analysis types, free of this package's host-side value imports.
 *
 * A memo week is keyed by ISO-8601 week id (`YYYY-Www`, Monday start). The
 * current week is always editable; past weeks require an explicit `force`
 * flag after acknowledging that AI analysis results may change.
 *
 * @module @zhangj1164/dsh-memo/types
 */

/** The kind of content a memo entry holds. */
export type MemoEntryType = 'text' | 'image' | 'file'

/** One memo entry — text, an image, or a file reference. */
export interface MemoEntry {
  /** Opaque entry id (UUID). */
  readonly id: string
  /** Content kind. */
  readonly type: MemoEntryType
  /** Text content (for text entries), or a description (for image/file entries). */
  readonly content: string
  /** Attachment reference, for image/file entries. */
  readonly attachmentRef?: string
  /** External source path the entry references, when the user linked a local file. */
  readonly source?: string
  /**
   * The archived session a generated summary came from.
   *
   * Kept separate from {@link MemoEntry.source}: `source` names a local file the
   * user linked, while this names the conversation the model summarized. Dedupe
   * and later queries need to tell the two origins apart, and a single field
   * carrying both would make a file path look like a session id.
   */
  readonly originSessionId?: string
  /** Epoch milliseconds when the entry was created. */
  readonly createdAt: number
  /** Epoch milliseconds when the entry was last updated. */
  readonly updatedAt: number
}

/** One AI analysis result for a period of memo entries. */
export interface MemoAnalysis {
  /** The analysis period. */
  readonly period: MemoAnalysisPeriod
  /** The period label (e.g. `'2025-W03'` or `'2025-Q1'`). */
  readonly periodLabel: string
  /** The analysis text produced by the model. */
  readonly summary: string
  /** Epoch milliseconds when the analysis was generated. */
  readonly generatedAt: number
  /** Provider route that produced the analysis. */
  readonly modelProvider: string
  /** Model id that produced the analysis. */
  readonly modelName: string
}

/** The periods over which memo entries can be analyzed or exported. */
export type MemoAnalysisPeriod = 'week' | 'month' | 'quarter' | 'year'

/** The kind of AI operation to perform on memo entries. */
export type MemoAnalysisType = '梳理' | '总结' | '分析'

/** One memo week — the primary storage unit, keyed by ISO week id. */
export interface MemoWeek {
  /** ISO-8601 week id (`YYYY-Www`, Monday start). */
  readonly weekId: string
  /** Epoch milliseconds of the week's Monday 00:00 local time. */
  readonly weekStart: number
  /** Epoch milliseconds of the week's Sunday 23:59:59.999 local time. */
  readonly weekEnd: number
  /** Entries in this week, in creation order. */
  readonly entries: readonly MemoEntry[]
  /** The latest analysis result, when one exists. */
  readonly analysis?: MemoAnalysis
  /** Epoch milliseconds when the week was last updated. */
  readonly updatedAt: number
}

/** Request to get or create the current week. */
export interface MemoGetCurrentWeekRequest {
  /** Provider route override, stored for later analysis calls; may be omitted. */
  readonly provider?: string
  /** Model id override, stored for later analysis calls; may be omitted. */
  readonly model?: string
}

/** Result of getting or creating the current week. */
export type MemoGetCurrentWeekResult =
  | { readonly ok: true; readonly value: MemoWeek }
  | { readonly ok: false; readonly error: { readonly code: 'not-initialized'; readonly message: string } }

/** Request to get one week by id. */
export interface MemoGetWeekRequest {
  readonly weekId: string
}

/** Result of getting one week. */
export type MemoGetWeekResult =
  | { readonly ok: true; readonly value: MemoWeek | null }
  | { readonly ok: false; readonly error: { readonly code: 'not-initialized'; readonly message: string } }

/** Request to list weeks in a range. */
export interface MemoListWeeksRequest {
  /** Inclusive lower bound on week start (epoch ms). */
  readonly from?: number
  /** Exclusive upper bound on week start (epoch ms). */
  readonly to?: number
}

/** Result of listing weeks. */
export type MemoListWeeksResult =
  | { readonly ok: true; readonly value: readonly MemoWeek[] }
  | { readonly ok: false; readonly error: { readonly code: 'not-initialized'; readonly message: string } }

/** Request to add an entry to a week. */
export interface MemoAddEntryRequest {
  readonly weekId: string
  readonly type: MemoEntryType
  readonly content: string
  readonly attachmentRef?: string
  readonly source?: string
}

/** Result of adding an entry. */
export type MemoAddEntryResult =
  | { readonly ok: true; readonly value: MemoEntry }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/** Request to update an entry. */
export interface MemoUpdateEntryRequest {
  readonly weekId: string
  readonly entryId: string
  readonly content: string
  /** Must be `true` when the week is not the current week (acknowledges stale analysis). */
  readonly force?: boolean
}

/** Result of updating an entry. */
export type MemoUpdateEntryResult =
  | { readonly ok: true; readonly value: MemoEntry }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/** Request to delete an entry. */
export interface MemoDeleteEntryRequest {
  readonly weekId: string
  readonly entryId: string
  /** Must be `true` when the week is not the current week. */
  readonly force?: boolean
}

/** Result of deleting an entry. */
export type MemoDeleteEntryResult =
  | { readonly ok: true; readonly value: true }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/** Request to analyze entries in a period. */
export interface MemoAnalyzeRequest {
  /** Analysis period. */
  readonly period: MemoAnalysisPeriod
  /** Period label (e.g. `'2025-W03'` or `'2025-Q1'`). */
  readonly periodLabel: string
  /** Analysis type: 梳理 (organize), 总结 (summarize), or 分析 (analyze). */
  readonly analysisType: MemoAnalysisType
  /** Provider route override; omit to use the service Config or `agentDefaultModel`. */
  readonly provider?: string
  /** Model id override; omit to use the service Config or `agentDefaultModel`. */
  readonly model?: string
}

/** Result of analysis. */
export type MemoAnalyzeResult =
  | { readonly ok: true; readonly value: MemoAnalysis }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/** Request to export a report for a period. */
export interface MemoExportReportRequest {
  readonly period: MemoAnalysisPeriod
  readonly periodLabel: string
  /** Provider route override; omit to use the service Config or `agentDefaultModel`. */
  readonly provider?: string
  /** Model id override; omit to use the service Config or `agentDefaultModel`. */
  readonly model?: string
}

/** Result of exporting a report. */
export type MemoExportReportResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/**
 * Request to read an external file path and return its text. Nothing is
 * written: the caller decides what, if anything, to add as an entry.
 */
export interface MemoReadExternalPathRequest {
  /** The external file path to read. */
  readonly path: string
  /** Provider route override for later analysis context; may be omitted. */
  readonly provider?: string
  /** Model id override for later analysis context; may be omitted. */
  readonly model?: string
}

/** Result of reading an external path. */
export type MemoReadExternalPathResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/** Request to analyze telemetry logs for this deployment's plugins. */
export interface MemoAnalyzeLogsRequest {
  /**
   * The plugin ids whose logs to analyze, in read order. Defaults to the
   * service `Config`'s `logAnalysisPlugins`, which names the suite.
   */
  readonly pluginIds?: readonly string[]
  /** GitHub repository URL for the prefill (defaults to the service config). */
  readonly repoUrl?: string
  /** Provider route override; omit to use the service Config or `agentDefaultModel`. */
  readonly provider?: string
  /** Model id override; omit to use the service Config or `agentDefaultModel`. */
  readonly model?: string
}

/** Result of log analysis. */
export type MemoAnalyzeLogsResult =
  | { readonly ok: true; readonly value: MemoLogAnalysisResult }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/** One failure group in the log-analysis summary. */
export interface MemoLogAnalysisGroup {
  /** The feature-code anchor shared by every event in this group. */
  readonly featureCodeRef: string
  /** Number of failures in this group. */
  readonly count: number
  /** The distinct error codes observed in this group. */
  readonly errorCodes: readonly string[]
  /** Timestamp (epoch ms) of the most recent failure in this group. */
  readonly lastFailureAt: number
  /** Attempts of the same action recorded after the most recent failure. */
  readonly attemptsAfterLastFailure: number
  /** Route the failures ran on, absent when those events recorded none. */
  readonly route?: { readonly provider: string; readonly model: string; readonly status?: number }
}

/** The telemetry analysis summary that produced the report. */
export interface MemoLogAnalysisSummary {
  /** The plugin ids this analysis covered, in the order they were read. */
  readonly pluginIds: readonly string[]
  /** Total events recorded for the analyzed plugins. */
  readonly totalEvents: number
  /** Total failure events recorded for the analyzed plugins. */
  readonly totalFailures: number
  /** Time range the analysis read, absent when none of the plugins has events. */
  readonly window?: { readonly firstEventAt: number; readonly lastEventAt: number }
  /** Failure events grouped by feature-code anchor, most failures first. */
  readonly failureGroups: readonly MemoLogAnalysisGroup[]
}

/** The log analysis result: the issue report and the prefill URL. */
export interface MemoLogAnalysisResult {
  /** The generated GitHub issue report. */
  readonly report: { readonly title: string; readonly body: string; readonly labels: readonly string[] }
  /** The pre-filled GitHub issue-creation URL. */
  readonly issueUrl: string
  /** The telemetry analysis summary. */
  readonly analysis: MemoLogAnalysisSummary
}

/** Business failure union for memo operations. */
export type MemoMemoFailure =
  | { readonly code: 'not-initialized'; readonly message: string }
  | { readonly code: 'week-not-found'; readonly message: string; readonly weekId: string }
  | { readonly code: 'invalid-week-id'; readonly message: string; readonly weekId: string }
  | { readonly code: 'entry-not-found'; readonly message: string; readonly entryId: string }
  | { readonly code: 'past-week-requires-force'; readonly message: string; readonly weekId: string }
  | { readonly code: 'invalid-quarter-label'; readonly message: string; readonly label: string }
  | { readonly code: 'quarter-archived'; readonly message: string; readonly weekId: string }
  | { readonly code: 'no-entries'; readonly message: string }
  | { readonly code: 'no-plugins-configured'; readonly message: string }
  | {
    readonly code: 'llm-failure'
    /** DSH provider-neutral machine-routing code (`NO_ADAPTER`, `AUTH`, `EMPTY_RESPONSE`, …). */
    readonly failureCode?: string
    readonly message: string
    /** The provider route the failed call was sent to. */
    readonly provider?: string
    /** The model id the failed call was sent to. */
    readonly model?: string
    /** HTTP status returned by the provider, when DSH supplied one. */
    readonly status?: number
  }
  | { readonly code: 'fs-unavailable'; readonly message: string; readonly path: string }
  /** The filesystem refused the read: a permission or sandbox denial. */
  | { readonly code: 'approval-denied'; readonly message: string; readonly path: string }
  /** No such file, as reported by the filesystem rather than guessed here. */
  | { readonly code: 'path-not-found'; readonly message: string; readonly path: string }
  /** The target exists but is not a regular text file this deployment can read (a directory, a special file, or binary content). */
  | { readonly code: 'path-not-text'; readonly message: string; readonly path: string }
  /** The backend refused the read because the file exceeds its size bound. */
  | { readonly code: 'path-too-large'; readonly message: string; readonly path: string }
  /** Any other filesystem failure, including one that carried no DSH code. */
  | { readonly code: 'fs-error'; readonly message: string; readonly path: string }
  | { readonly code: 'github-issue-failure'; readonly message: string }
  /** No session archive or session query service is mounted in this deployment. */
  | { readonly code: 'session-service-unavailable'; readonly message: string; readonly service: 'workspaceRegistry' | 'sessionQuery' }
  /** A requested session id is not a non-empty string. */
  | { readonly code: 'invalid-session-id'; readonly message: string; readonly sessionId: string }
  /** The request selected no sessions. */
  | { readonly code: 'no-sessions'; readonly message: string }
  /** The request selected more sessions than one call accepts. */
  | { readonly code: 'too-many-sessions'; readonly message: string; readonly limit: number }
  /** The session is not in the official archive set, so it is out of this feature's scope. */
  | { readonly code: 'session-not-archived'; readonly message: string; readonly sessionId: string }
  /** The session log could not be read or replayed. */
  | { readonly code: 'session-unreadable'; readonly message: string; readonly sessionId: string }
  /** The session has no user/assistant text to summarize. */
  | { readonly code: 'session-empty'; readonly message: string; readonly sessionId: string }
  /** The target week already holds a summary of this session. */
  | { readonly code: 'already-summarized'; readonly message: string; readonly sessionId: string; readonly weekId: string; readonly entryId: string }

/** ── Long-term memory (persistent JSON ledger in $DSH_HOME/memo/) ── */

/** One persisted AI analysis result with its period context. */
export interface MemoMemoryEntry {
  /** Opaque entry id (UUID). */
  readonly id: string
  /** The analysis period. */
  readonly period: MemoAnalysisPeriod
  /** The period label (e.g. `'2025-W03'` or `'2025-Q1'`). */
  readonly periodLabel: string
  /** The analysis type that produced this result. */
  readonly analysisType: MemoAnalysisType
  /** The analysis text produced by the model. */
  readonly summary: string
  /** Epoch milliseconds when the analysis was generated. */
  readonly generatedAt: number
}

/** The persistent ledger structure stored in `$DSH_HOME/memo/ledger.json`. */
export interface MemoLedger {
  /** Schema version for forward-compatible migrations. */
  readonly schemaVersion: number
  /** All persisted analysis results, newest first. */
  readonly analyses: readonly MemoMemoryEntry[]
}

/** Request to list long-term memory entries (persisted AI analyses). */
export interface MemoListMemoryRequest {
  /** Optional filter by period. */
  readonly period?: MemoAnalysisPeriod
  /** Maximum number of entries to return (default: 50). */
  readonly limit?: number
}

/** Result of listing long-term memory. */
export type MemoListMemoryResult =
  | { readonly ok: true; readonly value: readonly MemoMemoryEntry[] }
  | { readonly ok: false; readonly error: { readonly code: 'ledger-error'; readonly message: string } }

/** One navigable period in the memo timeline. */
export interface MemoPeriodEntry {
  /** Stable identity of the period: the week id for week periods, the label for the rest. */
  readonly id: string
  /** The canonical period label (`2026-W36`, `2026-09`, `2026-Q3`, `2026`). */
  readonly label: string
  /** The dimension this entry belongs to. */
  readonly period: MemoAnalysisPeriod
  /** Epoch milliseconds of the period's first day, local midnight. */
  readonly start: number
  /** Epoch milliseconds of the period's last day, end of day. */
  readonly end: number
  /** Whether the period is still current at the time of the request. */
  readonly current: boolean
  /** How many stored weeks fall inside this period. */
  readonly weekCount: number
  /** The ISO week ids inside this period, ascending. */
  readonly weekIds: readonly string[]
}

/** Request to list the memo timeline in one dimension. */
export interface MemoListPeriodsRequest {
  /** The dimension to list. */
  readonly period: MemoAnalysisPeriod
  /** How many periods to return, counting back from the current one. */
  readonly limit?: number
}

/** Result of listing the memo timeline. */
export type MemoListPeriodsResult =
  | { readonly ok: true; readonly value: readonly MemoPeriodEntry[] }
  | { readonly ok: false; readonly error: { readonly code: 'not-initialized'; readonly message: string } }

/** One archived quarter, with the week ids the host resolved for it. */
export interface MemoArchivedQuarter {
  /** The canonical quarter label (`2026-Q3`). */
  readonly label: string
  /** Epoch milliseconds when the quarter was archived. */
  readonly archivedAt: number
  /**
   * The ISO week ids inside the quarter, ascending.
   *
   * Resolved by the host rather than by the caller: a client only has to build
   * a `Set` from this to know which cards are read-only, so no caller has to
   * re-derive which weeks a quarter owns across a year boundary.
   */
  readonly weekIds: readonly string[]
}

/** Request naming one quarter by its label. */
export interface MemoQuarterLabelRequest {
  /** The quarter label (`2026-Q3`). */
  readonly label: string
}

/**
 * Request for `listArchivedQuarters`.
 *
 * It carries no input of its own, and it exists only because the Remote
 * protocol binds arguments **by name**: the client always sends
 * `{ args: { request } }`, so a method that needs no input must still declare
 * the `request` parameter. An earlier revision declared none, and the call was
 * rejected before the method body ran — the archive was written while the
 * client's read of it silently returned nothing, so archiving looked like it did
 * absolutely nothing.
 */
export interface MemoListArchivedQuartersRequest {}

/** Result of archiving a quarter. */
export type MemoArchiveQuarterResult =
  | { readonly ok: true; readonly value: MemoArchivedQuarter }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/** Result of unarchiving a quarter. */
export type MemoUnarchiveQuarterResult =
  | { readonly ok: true; readonly value: { readonly label: string; readonly archived: boolean } }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/** Result of listing archived quarters. */
export type MemoListArchivedQuartersResult =
  | { readonly ok: true; readonly value: readonly MemoArchivedQuarter[] }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/** One model a provider route advertises. */
export interface MemoModelInfo {
  /** Model id to send as the call's model. */
  readonly id: string
  /** Human-readable name for selectors; a caller falls back to `id`. */
  readonly name: string
}

/**
 * One provider route a caller may switch to, with everything it advertises.
 *
 * Only providers the deployment actually registered appear here. Dormant routes
 * an adapter merely declared are deliberately absent: they cannot carry a call,
 * so offering one would offer a selection that is guaranteed to fail.
 */
export interface MemoModelProvider {
  /** Provider route key to send as the call's provider. */
  readonly id: string
  /** Human-readable provider name for selectors; a caller falls back to `id`. */
  readonly name: string
  /**
   * Models this provider advertises, in the adapter's own order.
   *
   * DSH calls this catalog advisory: membership never validates a request, so a
   * caller must not read "not listed" as "rejected".
   */
  readonly models: readonly MemoModelInfo[]
  /**
   * Why this provider's catalog is empty, when it is empty for a reason.
   *
   * Per provider on purpose: one adapter that throws must not hide the models
   * every other provider is perfectly willing to serve.
   */
  readonly error?: string
}

/**
 * Request for `listModels`.
 *
 * It carries no input, and it declares `request` for the same reason every
 * other method does: the Remote protocol binds arguments by name.
 */
export interface MemoListModelsRequest {}

/**
 * The route AI analysis would use right now, plus everything it can be switched
 * to.
 */
export interface MemoListModelsValue {
  /** Provider route the next AI call would use, or `''` when unresolved. */
  readonly provider: string
  /** Model id the next AI call would use, or `''` when unresolved. */
  readonly model: string
  /** Every registered provider route, in registration order. */
  readonly providers: readonly MemoModelProvider[]
  /**
   * Why no provider could be listed at all.
   *
   * Distinct from a provider that advertises nothing: this says the registry
   * itself could not be read, which is the deployment's problem rather than the
   * caller's choice.
   */
  readonly catalogError?: string
}

/**
 * Result of listing the routes AI calls can be switched to.
 *
 * There is deliberately no failure variant. Every degradation — no provider
 * configured, no `llm` service mounted, a catalog query that throws — is
 * reported inside a successful value, because a deployment without a model
 * route must still be able to open the memo board.
 */
export type MemoListModelsResult = { readonly ok: true; readonly value: MemoListModelsValue }

/** ── Session summaries from the official session archive ── */

/** One officially archived session the memo panel can summarize. */
export interface MemoArchivedSession {
  /** Session identity, also written to the resulting entry's `originSessionId`. */
  readonly sessionId: string
  /** Log-backed title, or a short id fallback when the session has none. */
  readonly title: string
  /** Epoch milliseconds when the session was created. */
  readonly createdAt: number
  /** The directory the session ran in, when its header recorded one. */
  readonly cwd?: string
  /**
   * Weeks that already hold a summary of this session, ascending.
   *
   * A caller uses this to mark "already summarized in the target week" and to
   * avoid offering a selection the host would refuse anyway.
   */
  readonly summarizedWeekIds: readonly string[]
}

/**
 * Request for `listArchivedSessions`.
 *
 * It carries no input, and it declares `request` because the Remote protocol
 * binds arguments by name.
 */
export interface MemoListArchivedSessionsRequest {}

/** The archived sessions plus the limits and clock the picker needs. */
export interface MemoListArchivedSessionsValue {
  /** Archived sessions, newest first. */
  readonly sessions: readonly MemoArchivedSession[]
  /** How many sessions one `summarizeSession` call accepts. */
  readonly maxSessions: number
  /** The host's current ISO week id, used as the default write target. */
  readonly currentWeekId: string
  /** Default summary length in characters offered by the picker. */
  readonly summaryMaxChars: number
  /** Largest summary length the picker may request; the host clamps to it. */
  readonly summaryMaxCharsLimit: number
}

/** Result of listing the officially archived sessions. */
export type MemoListArchivedSessionsResult =
  | { readonly ok: true; readonly value: MemoListArchivedSessionsValue }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/**
 * Output language for a generated session summary.
 *
 * The host maps the client's active UI locale to one of these before choosing
 * the prompt language; a deployment may force one through Config instead.
 */
export type MemoSessionSummaryLanguage = 'zh' | 'en'

/** Request to summarize one or more archived sessions into a memo week. */
export interface MemoSummarizeSessionRequest {
  /** Archived session ids to summarize, in order. Duplicates are collapsed. */
  readonly sessionIds: readonly string[]
  /** Week to write into; omit for the service's current ISO week. */
  readonly weekId?: string
  /** Provider route override; omit to use the service Config or `agentDefaultModel`. */
  readonly provider?: string
  /** Model id override; omit to use the service Config or `agentDefaultModel`. */
  readonly model?: string
  /**
   * Replace an existing summary of the same session in the target week.
   *
   * Without it, a session already summarized in that week is reported as
   * `already-summarized` so a repeated click cannot silently duplicate entries.
   */
  readonly force?: boolean
  /**
   * Output language for the summary.
   *
   * The browser sends its active UI language; a Config value of `zh` or `en`
   * overrides it. When omitted, the service follows `auto` and falls back to
   * Chinese, matching the default source annotation.
   */
  readonly language?: MemoSessionSummaryLanguage
  /**
   * Target summary length in characters.
   *
   * The service clamps it to `[100, Config.sessionSummaryMaxCharsLimit]` and
   * substitutes the result into the prompt's `{maxChars}` placeholder.
   */
  readonly maxChars?: number
}

/** What happened to one session in a summarize request. */
export interface MemoSessionSummaryOutcome {
  /** The session this outcome describes. */
  readonly sessionId: string
  /** The session's title, or the short-id fallback. */
  readonly title: string
  /** The entry written (or replaced) on success. */
  readonly entry?: MemoEntry
  /** Why this session produced no entry. */
  readonly error?: MemoMemoFailure
}

/** The per-session outcomes of one summarize request. */
export interface MemoSummarizeSessionValue {
  /** The week every successful outcome was written to. */
  readonly weekId: string
  /** One outcome per requested session, in request order. */
  readonly outcomes: readonly MemoSessionSummaryOutcome[]
}

/** Result of summarizing archived sessions. */
export type MemoSummarizeSessionResult =
  | { readonly ok: true; readonly value: MemoSummarizeSessionValue }
  | { readonly ok: false; readonly error: MemoMemoFailure }
