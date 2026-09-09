/**
 * Pure types of the local telemetry domain: the one home of {@link TelemetryEvent}
 * and its query/analysis projections, free of this package's host-side value
 * imports (dsh-storage-domain, zod). Two namespace projections serve it —
 * `./types` for host consumers, `./client` (the browser half-entry's re-export)
 * for client aggregates — with zero content duplication.
 *
 * The telemetry log format is the agreed contract between feature plugins and
 * the log-analysis feature: every {@link TelemetryEvent} carries a
 * {@link TelemetryErrorRecord.featureCodeRef} that names the exact code section
 * that produced it, so the log-analysis step can correlate recorded events
 * against the plugin's feature code and produce a uniform report.
 *
 * @module dsh-telemetry/types
 */

/** The categories a telemetry event can belong to. */
export type TelemetryCategory = 'user-action' | 'system' | 'error'

/** Whether an action succeeded or failed. */
export type TelemetryResult = 'success' | 'failure'

/** Structured error facts recorded on a failure event. */
export interface TelemetryErrorRecord {
  /** Stable machine-routing code, if known. */
  readonly code: string
  /** Human-readable error message. */
  readonly message: string
  /** Optional stack trace, if available from the caught error. */
  readonly stack?: string
  /**
   * Agreed code-section anchor that names the feature that failed (e.g.
   * `"memo:addEntry"`). The log-analysis step correlates this against the
   * plugin's feature code to produce a uniform report.
   */
  readonly featureCodeRef?: string
}

/** One tracked telemetry event — the agreed log format for all feature plugins. */
export interface TelemetryEvent {
  /** Opaque event id (UUID). */
  readonly id: string
  /** Epoch milliseconds when the event was recorded. */
  readonly timestamp: number
  /** The plugin that produced this event (its Cordis service key or package name). */
  readonly pluginId: string
  /** The action that was performed or attempted. */
  readonly action: string
  /** Event category. */
  readonly category: TelemetryCategory
  /** Whether the action succeeded or failed. */
  readonly result: TelemetryResult
  /** Owning session id, when the event belongs to one. */
  readonly sessionId?: string
  /** Arbitrary structured metadata about the action, JSON-serializable. */
  readonly metadata?: Record<string, unknown>
  /** Error facts, present only on failure events. */
  readonly error?: TelemetryErrorRecord
}

/** Input for tracking one event — the id and timestamp are assigned by the service. */
export interface TelemetryEventInput {
  /** The plugin that produced this event. */
  readonly pluginId: string
  /** The action that was performed or attempted. */
  readonly action: string
  /** Event category; defaults to `'user-action'` when omitted. */
  readonly category?: TelemetryCategory
  /** Whether the action succeeded or failed; defaults to `'success'` when omitted. */
  readonly result?: TelemetryResult
  /** Owning session id, when the event belongs to one. */
  readonly sessionId?: string
  /** Arbitrary structured metadata about the action, JSON-serializable. */
  readonly metadata?: Record<string, unknown>
}

/** Input for tracking one error event. */
export interface TelemetryErrorInput {
  /** The plugin that produced this error. */
  readonly pluginId: string
  /** The action that failed. */
  readonly action: string
  /** Error facts, including the agreed feature-code anchor. */
  readonly error: TelemetryErrorRecord
  /** Owning session id, when the error belongs to one. */
  readonly sessionId?: string
  /** Arbitrary structured metadata, JSON-serializable. */
  readonly metadata?: Record<string, unknown>
}

/** Query for listing telemetry events. */
export interface TelemetryQuery {
  /** Filter by plugin id, when provided. */
  readonly pluginId?: string
  /** Filter by category, when provided. */
  readonly category?: TelemetryCategory
  /** Filter by result, when provided. */
  readonly result?: TelemetryResult
  /** Inclusive lower bound on timestamp (epoch ms). */
  readonly from?: number
  /** Exclusive upper bound on timestamp (epoch ms). */
  readonly to?: number
  /** Maximum number of events to return; the service applies a deployment cap. */
  readonly limit?: number
}

/** One grouped failure pattern, joined on {@link TelemetryErrorRecord.featureCodeRef}. */
export interface TelemetryFailureGroup {
  /** The feature-code anchor shared by every event in this group. */
  readonly featureCodeRef: string
  /** Number of failures in this group. */
  readonly count: number
  /** The most recent failure event in this group. */
  readonly latest: TelemetryEvent
  /** The distinct error codes observed in this group. */
  readonly errorCodes: readonly string[]
}

/** Result of analyzing telemetry for one plugin. */
export interface TelemetryAnalysis {
  /** The plugin id that was analyzed. */
  readonly pluginId: string
  /** Total number of events recorded. */
  readonly totalEvents: number
  /** Total number of failure events. */
  readonly totalFailures: number
  /** Failure events grouped by feature-code anchor. */
  readonly failureGroups: readonly TelemetryFailureGroup[]
}
