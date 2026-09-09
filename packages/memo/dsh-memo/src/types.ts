/**
 * Pure types of the local memo domain: the one home of the memo entry, week,
 * and analysis types, free of this package's host-side value imports.
 *
 * A memo week is keyed by ISO-8601 week id (`YYYY-Www`, Monday start). The
 * current week is always editable; past weeks require an explicit `force`
 * flag after acknowledging that AI analysis results may change.
 *
 * @module dsh-memo/types
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
  /** Provider route for AI operations (stored for later analysis calls). */
  readonly provider: string
  /** Model id for AI operations (stored for later analysis calls). */
  readonly model: string
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
  /** Provider route for the model call. */
  readonly provider: string
  /** Model id for the model call. */
  readonly model: string
}

/** Result of analysis. */
export type MemoAnalyzeResult =
  | { readonly ok: true; readonly value: MemoAnalysis }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/** Request to export a report for a period. */
export interface MemoExportReportRequest {
  readonly period: MemoAnalysisPeriod
  readonly periodLabel: string
  /** Provider route for the model call. */
  readonly provider: string
  /** Model id for the model call. */
  readonly model: string
}

/** Result of exporting a report. */
export type MemoExportReportResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/** Request to read an external file path (requires privilege escalation). */
export interface MemoReadExternalPathRequest {
  /** The external file path to read. */
  readonly path: string
  /** Provider route (unused for the read itself, stored for analysis context). */
  readonly provider: string
  /** Model id (unused for the read itself, stored for analysis context). */
  readonly model: string
}

/** Result of reading an external path. */
export type MemoReadExternalPathResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/** Request to analyze telemetry logs for this plugin. */
export interface MemoAnalyzeLogsRequest {
  /** The plugin id whose logs to analyze (defaults to `'memo'`). */
  readonly pluginId?: string
  /** GitHub repository URL for the prefill (defaults to the service config). */
  readonly repoUrl?: string
  /** Provider route for the report generation model call. */
  readonly provider: string
  /** Model id for the report generation model call. */
  readonly model: string
}

/** Result of log analysis. */
export type MemoAnalyzeLogsResult =
  | { readonly ok: true; readonly value: MemoLogAnalysisResult }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/** The log analysis result: the issue report and the prefill URL. */
export interface MemoLogAnalysisResult {
  /** The generated GitHub issue report. */
  readonly report: { readonly title: string; readonly body: string; readonly labels: readonly string[] }
  /** The pre-filled GitHub issue-creation URL. */
  readonly issueUrl: string
  /** The telemetry analysis summary. */
  readonly analysis: { readonly totalEvents: number; readonly totalFailures: number; readonly failureGroups: readonly unknown[] }
}

/** Business failure union for memo operations. */
export type MemoMemoFailure =
  | { readonly code: 'not-initialized'; readonly message: string }
  | { readonly code: 'week-not-found'; readonly message: string; readonly weekId: string }
  | { readonly code: 'entry-not-found'; readonly message: string; readonly entryId: string }
  | { readonly code: 'past-week-requires-force'; readonly message: string; readonly weekId: string }
  | { readonly code: 'no-entries'; readonly message: string }
  | { readonly code: 'llm-failure'; readonly message: string }
  | { readonly code: 'fs-unavailable'; readonly message: string }
  | { readonly code: 'approval-denied'; readonly message: string }
  | { readonly code: 'github-issue-failure'; readonly message: string }

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
