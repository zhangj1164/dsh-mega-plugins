/**
 * Local telemetry service: an in-process, local-only event tracker over the
 * storage-domain KV backend. Feature plugins record user-action and error
 * events through `ctx.telemetry.track()` / `ctx.telemetry.trackError()`; the
 * log-analysis feature reads them through `listEvents()` and
 * `analyzeForPlugin()`.
 *
 * This service is host-side only — it does not extend `TypertRemoteService`
 * because the client never calls it directly. The memo service's
 * `analyzeLogs()` Remote method reads telemetry internally and returns the
 * result to the client.
 *
 * @module @zhangj1164/dsh-telemetry
 */

import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { telemetryDomainSpec } from './spec.ts'
import type { TelemetryEventRow } from './spec.ts'
import {
  compileRules,
  DEFAULT_REDACTION_MARKER,
  DEFAULT_REDACTION_RULES,
  redactMetadata,
  redactText,
  type RedactionRule,
} from './redaction.ts'
import type {
  TelemetryAnalysis,
  TelemetryErrorInput,
  TelemetryErrorRecord,
  TelemetryEvent,
  TelemetryEventInput,
  TelemetryFailureGroup,
  TelemetryFailureRoute,
  TelemetryQuery,
} from './types.ts'

export type * from './types.ts'
export { telemetryDomainSpec, telemetryEventSchema } from './spec.ts'
export type { TelemetryEventRow } from './spec.ts'
export {
  compileRules,
  DEFAULT_REDACTION_MARKER,
  DEFAULT_REDACTION_RULES,
  redactMetadata,
  redactText,
  redactValue,
} from './redaction.ts'
export type { RedactionOptions, RedactionRule } from './redaction.ts'

/** Deployment policy for local telemetry retention. */
export interface Config {
  /**
   * Maximum number of events returned by one `listEvents` call. Bounds memory
   * when the log is large; the deployment raises it for deeper analysis.
   */
  readonly maxEventsPerQuery: number
  /**
   * Whether to redact sensitive text before an event is stored. Disabling it
   * stores events verbatim, which is what a deployment debugging its own
   * redaction rules needs — and what makes those records unsafe to paste into
   * an issue.
   */
  readonly redact: boolean
  /**
   * Replacement written in place of every match. `{rule}` is substituted with
   * the matching rule's name, so a reader sees which family was removed rather
   * than only that something was.
   */
  readonly redactionMarker: string
  /**
   * The rule set. Applied in order, so the defaults put the more specific
   * patterns — a token is also long and base64-shaped — ahead of the generic
   * ones and give the more informative marker.
   */
  readonly redactionRules: readonly RedactionRule[]
  /**
   * Extra attempts after a durable write fails with a transient filesystem
   * error. The JSON backend publishes a unit by writing a temp file and
   * renaming it over the target; Windows refuses that rename while another
   * handle (an antivirus scan, an indexer) holds the target open, and the
   * same rename usually succeeds a moment later. `0` disables retrying.
   */
  readonly storageWriteRetries: number
  /**
   * First backoff delay in milliseconds; each retry doubles it, capped at
   * 5000 ms so a misconfiguration cannot stall a write for minutes. Only waits
   * between attempts that failed transiently, so the normal path never sleeps.
   */
  readonly storageWriteRetryDelayMs: number
}

/** Schemastery configuration for the telemetry service. */
export const Config: s<Config> = s.object({
  maxEventsPerQuery: s.number().step(1).min(1).default(500),
  redact: s.boolean().default(true),
  redactionMarker: s.string().default(DEFAULT_REDACTION_MARKER),
  redactionRules: s.array(s.object({
    name: s.string().required(),
    pattern: s.string().required(),
    flags: s.string(),
  })).default([...DEFAULT_REDACTION_RULES]),
  storageWriteRetries: s.number().step(1).min(0).max(10).default(4),
  storageWriteRetryDelayMs: s.number().step(1).min(0).max(5000).default(50),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    telemetry: TelemetryService
  }
}

/** Default cap when the caller omits a limit. */
const DEFAULT_QUERY_LIMIT = 200

/**
 * Local-only telemetry tracker. Records events into a storage-domain KV table
 * and answers synchronous reads for log analysis.
 */
export class TelemetryService extends Service {
  static inject = ['storageDomain']
  static Config = Config

  private readonly maxEventsPerQuery: number
  private readonly redactionRules: ReturnType<typeof compileRules>
  private readonly storageWriteRetries: number
  private readonly storageWriteRetryDelayMs: number
  private table?: KvTable<string, TelemetryEventRow>
  private readonly pendingWrites: Set<Promise<void>> = new Set()
  /**
   * Next write-sequence number, seeded from the stored maximum when the domain
   * opens. Restarting it at 1 would hand a new event a number an older record
   * already holds, and the ordering would silently fall back to timestamps.
   */
  private nextSeq = 1

  /**
   * @param ctx - Host context carrying the storage-domain form.
   * @param config - Validated deployment policy.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'telemetry')
    this.maxEventsPerQuery = config.maxEventsPerQuery
    this.storageWriteRetries = config.storageWriteRetries
    this.storageWriteRetryDelayMs = config.storageWriteRetryDelayMs
    // Compiled once: rules are read on every user action, and a write path is
    // the wrong place to rebuild regular expressions.
    this.redactionRules = config.redact
      ? compileRules({
          enabled: config.redact,
          marker: config.redactionMarker,
          rules: config.redactionRules,
        })
      : []
  }

  /** Open and own the one telemetry domain. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(telemetryDomainSpec)
    this.ctx.effect(() => async () => {
      await domain.close()
    }, 'telemetry.domainClose')
    const table = domain.table('events')
    this.table = table
    // The sequence brings the log's write order back after a restart, so it has
    // to continue from the stored maximum rather than from 1 — one full scan of
    // the table at open, which is the price of a number that is never reused.
    this.nextSeq = 1
    for (const [, row] of table.entries()) {
      const seq = row.seq ?? 0
      if (seq >= this.nextSeq) this.nextSeq = seq + 1
    }
  }

  /**
   * Record one telemetry event. The id, timestamp, and write sequence are
   * assigned by the service; the caller supplies the plugin id, action,
   * category, result, and optional metadata. The write is durable and queued on
   * the domain's write chain, so concurrent calls never interleave.
   * @param input - event fields without the id, timestamp, and sequence.
   */
  track(input: TelemetryEventInput): void {
    const event: TelemetryEventRow = {
      id: randomUUID(),
      timestamp: Date.now(),
      seq: this.nextSeq++,
      pluginId: input.pluginId,
      action: input.action,
      category: input.category ?? 'user-action',
      result: input.result ?? 'success',
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...this.redactedMetadata(input.metadata),
    }
    void this.trackWrite(this.writeWithRetry(() => this.requireTable().put(event.id, event)))
  }

  /**
   * Record one error event. The category is forced to `'error'` and the result
   * to `'failure'`; the caller supplies the error record with its agreed
   * `featureCodeRef`.
   * @param input - error fields including the feature-code anchor.
   */
  trackError(input: TelemetryErrorInput): void {
    const event: TelemetryEventRow = {
      id: randomUUID(),
      timestamp: Date.now(),
      seq: this.nextSeq++,
      pluginId: input.pluginId,
      action: input.action,
      category: 'error',
      result: 'failure',
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...this.redactedMetadata(input.metadata),
      error: this.redactedError(input.error),
    }
    void this.trackWrite(this.writeWithRetry(() => this.requireTable().put(event.id, event)))
  }

  /**
   * Read telemetry events matching a query, newest first by write order. The
   * result is a snapshot copy; callers may freely hold or mutate it.
   * @param query - optional filters and limit.
   * @returns matching events, newest first, capped at the deployment limit.
   */
  listEvents(query: TelemetryQuery = {}): TelemetryEvent[] {
    const table = this.requireTable()
    const limit = Math.min(query.limit ?? DEFAULT_QUERY_LIMIT, this.maxEventsPerQuery)
    const events: TelemetryEvent[] = []
    for (const [, row] of table.entries()) {
      if (query.pluginId !== undefined && row.pluginId !== query.pluginId) continue
      if (query.category !== undefined && row.category !== query.category) continue
      if (query.result !== undefined && row.result !== query.result) continue
      if (query.from !== undefined && row.timestamp < query.from) continue
      if (query.to !== undefined && row.timestamp >= query.to) continue
      events.push(snapshotEvent(row))
    }
    // Sort before cutting, so the limit selects the newest events. Cutting during
    // the walk would return the oldest ones, because the table iterates in
    // insertion order and "newest first" is a property of the sequence, not of
    // the order the rows happen to come back in.
    return events.sort((a, b) => compareOrder(b, a)).slice(0, limit)
  }

  /**
   * Analyze failure events for one plugin, grouped by feature-code anchor.
   *
   * The report this feeds used to say only "5 failures out of 458", which reads
   * the same whether the failures stopped a week ago or are happening now, and
   * gave the model nothing to explain them with beyond an error code. So each
   * group also carries the route the failure ran on and how many attempts of the
   * same action followed it, and the analysis carries the window it read.
   *
   * "Followed" is write order, not millisecond order: a retry can start inside
   * the same millisecond as the failure it follows, and reporting that as zero
   * attempts is what made a current defect read as an old one.
   *
   * @param pluginId - the plugin whose failures to analyze.
   * @returns total counts, the analysis window, and grouped failure patterns.
   */
  analyzeForPlugin(pluginId: string): TelemetryAnalysis {
    const table = this.requireTable()
    let totalEvents = 0
    let totalFailures = 0
    let firstEventAt: number | undefined
    let lastEventAt: number | undefined
    const events: TelemetryEvent[] = []
    const groups = new Map<string, { count: number; latest: TelemetryEvent; codes: Set<string>; actions: Set<string> }>()
    for (const [, row] of table.entries()) {
      if (row.pluginId !== pluginId) continue
      totalEvents++
      if (firstEventAt === undefined || row.timestamp < firstEventAt) firstEventAt = row.timestamp
      if (lastEventAt === undefined || row.timestamp > lastEventAt) lastEventAt = row.timestamp
      const event = snapshotEvent(row)
      events.push(event)
      if (row.result !== 'failure') continue
      totalFailures++
      const ref = row.error?.featureCodeRef ?? 'unknown'
      const existing = groups.get(ref)
      if (existing === undefined) {
        groups.set(ref, { count: 1, latest: event, codes: new Set([row.error?.code ?? 'unknown']), actions: new Set([row.action]) })
      } else {
        existing.count++
        // Every attempt at the same action counts, not just the last one: the
        // group is an error pattern, and the pattern can recur from more than
        // one entry point.
        existing.actions.add(row.action)
        if (compareOrder(event, existing.latest) > 0) existing.latest = event
        existing.codes.add(row.error?.code ?? 'unknown')
      }
    }
    const failureGroups: TelemetryFailureGroup[] = [...groups.entries()]
      .map(([featureCodeRef, g]) => {
        const route = routeFromMetadata(g.latest.metadata)
        return {
          featureCodeRef,
          count: g.count,
          // Re-read through the rules on the way out: a record stored before a
          // rule existed holds verbatim whatever that rule would have removed,
          // and this analysis is the last point before that text becomes a
          // model prompt and a pre-filled issue.
          latest: this.redactedEvent(g.latest),
          errorCodes: [...g.codes],
          attemptsAfterLastFailure: events.filter(event => compareOrder(event, g.latest) > 0 && g.actions.has(event.action)).length,
          ...(route === undefined ? {} : { route }),
        }
      })
      .sort((a, b) => b.count - a.count)
    return Object.freeze({
      pluginId,
      totalEvents,
      totalFailures,
      failureGroups: Object.freeze(failureGroups),
      ...(firstEventAt === undefined || lastEventAt === undefined
        ? {}
        : { window: Object.freeze({ firstEventAt, lastEventAt }) }),
    })
  }

  /**
   * Wait for all in-flight fire-and-forget writes to settle. Tests call this
   * before reading to avoid a timing race between the write chain and the
   * synchronous read.
   *
   * A write that failed after its retry budget is rethrown here, so a test
   * cannot silently observe a shorter event list and call it a pass; `track()`
   * itself still never throws, because its callers are fire-and-forget.
   */
  async flush(): Promise<void> {
    while (this.pendingWrites.size > 0) {
      await Promise.all([...this.pendingWrites])
    }
  }

  /** Register one fire-and-forget write so {@link flush} can later await it. */
  private trackWrite(write: Promise<void>): void {
    this.pendingWrites.add(write)
    void write.then(() => { this.pendingWrites.delete(write) }, () => { this.pendingWrites.delete(write) })
  }

  /**
   * Replay one durable write while the failure is transient.
   *
   * Replaying the exact same operation, rather than rebuilding the event, is
   * what keeps the retry safe: the id and sequence were already assigned, and
   * a successful first attempt followed by a retry would write the event
   * twice under different ids. The loop stops at the first non-transient
   * failure so a real permission problem is reported, not slept through.
   *
   * @param operation - the write to attempt.
   * @returns the operation's result once it succeeds.
   */
  private async writeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        if (attempt >= this.storageWriteRetries || !isTransientStorageWriteError(error)) throw error
        await delay(Math.min(this.storageWriteRetryDelayMs * (2 ** attempt), MAX_STORAGE_WRITE_RETRY_DELAY_MS))
      }
    }
  }

  /**
   * Redact a metadata map for storage.
   *
   * Spread into the row, so an absent map contributes no key at all rather than
   * an `undefined` one — the durable schema treats those differently.
   * @param metadata - the caller-supplied metadata, if any.
   * @returns the spreadable fragment.
   */
  private redactedMetadata(metadata: Record<string, unknown> | undefined): { metadata?: Record<string, unknown> } {
    const redacted = redactMetadata(metadata, this.redactionRules)
    return redacted === undefined ? {} : { metadata: redacted }
  }

  /**
   * Redact an error record for storage.
   *
   * Only the free text is redacted. `code` and `featureCodeRef` are the plugin's
   * own grouping keys: redacting them would not protect anything the plugin did
   * not already choose to publish, and would destroy the grouping that makes the
   * log analyzable.
   * @param error - the error record to redact.
   * @returns the redacted record.
   */
  private redactedError(error: TelemetryErrorRecord): TelemetryErrorRecord {
    if (this.redactionRules.length === 0) return error
    return {
      code: error.code,
      message: redactText(error.message, this.redactionRules),
      ...(error.stack === undefined ? {} : { stack: redactText(error.stack, this.redactionRules) }),
      ...(error.featureCodeRef === undefined ? {} : { featureCodeRef: error.featureCodeRef }),
    }
  }

  /**
   * Re-apply the redaction rules to one stored event on the way out.
   *
   * Redaction on the way in cannot reach a record written before the rule set
   * grew: the store holds it verbatim, and the analysis is the last point before
   * that text becomes a model prompt and a pre-filled issue. So the same rules
   * run again on read.
   *
   * Two properties keep this cheap and safe. It is applied to the one event each
   * group carries, not to every stored event, so the cost is per failure pattern
   * rather than per row; and it is idempotent, because a value that already
   * carries a marker matches no default rule and comes back unchanged.
   *
   * Only the free text is re-read. `code` and `featureCodeRef` stay legible for
   * the same reason they are not redacted on write: they are the grouping keys,
   * and the analysis has nothing to group without them.
   * @param event - a stored event, already copied out of the row.
   * @returns the event with its free text re-read through the rules.
   */
  private redactedEvent(event: TelemetryEvent): TelemetryEvent {
    if (this.redactionRules.length === 0) return event
    const metadata = redactMetadata(event.metadata, this.redactionRules)
    return Object.freeze({
      ...event,
      ...(metadata === undefined ? {} : { metadata }),
      ...(event.error === undefined ? {} : { error: this.redactedError(event.error) }),
    })
  }

  /** Resolve the initialized durable table or fail a broken service lifecycle. */
  private requireTable(): KvTable<string, TelemetryEventRow> {
    if (this.table === undefined) {
      throw new Error('telemetry: durable domain is not initialized')
    }
    return this.table
  }
}

/** Filesystem errors that a later identical write can plausibly survive. */
const TRANSIENT_STORAGE_WRITE_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY'])

/** Ceiling for one retry delay; a large configured base cannot grow without bound. */
const MAX_STORAGE_WRITE_RETRY_DELAY_MS = 5_000

/**
 * Whether a failed write is the Windows rename-over-open-handle race.
 *
 * `dsh-storage-json` publishes a unit with `rename(tmp, target)`. On Windows
 * that fails with `EPERM` while an antivirus, an indexer, or another reader
 * holds the target open; the error is a pure timing race, so an identical
 * retry is the right response. `EACCES` is deliberately absent: it is the
 * signature of a real permission problem that waiting does not fix.
 *
 * @param error - the value a write rejected with.
 * @returns true when the write is worth replaying.
 */
function isTransientStorageWriteError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { readonly code?: unknown }).code
  return typeof code === 'string' && TRANSIENT_STORAGE_WRITE_CODES.has(code)
}

/**
 * Order two events by write order.
 *
 * `timestamp` alone cannot order a log: `Date.now()` counts milliseconds, so an
 * attempt recorded in the same millisecond as the failure it follows compares as
 * "not later", and the analysis then reports zero attempts after a failure that
 * did happen again. {@link TelemetryEvent.seq} is the number that says which
 * event was written first; `timestamp` breaks ties only among records stored
 * before the sequence existed, where nothing better was ever recorded. Two such
 * legacy rows in the same millisecond stay unorderable; the helper exists so the
 * three call sites — the `latest` pick, the attempt count, and `listEvents` —
 * cannot drift into three subtly different notions of "later".
 *
 * @param a - one event, or the stored row carrying it.
 * @param b - the other event.
 * @returns negative when `a` is older, positive when it is newer, and 0 only for
 *   two pre-sequence records stamped with the same millisecond.
 */
function compareOrder(
  a: { readonly seq?: number; readonly timestamp: number },
  b: { readonly seq?: number; readonly timestamp: number },
): number {
  const bySeq = (a.seq ?? 0) - (b.seq ?? 0)
  return bySeq !== 0 ? bySeq : a.timestamp - b.timestamp
}

/** Copy one stored row into an owned, frozen {@link TelemetryEvent}. */
function snapshotEvent(row: TelemetryEventRow): TelemetryEvent {
  return Object.freeze({
    id: row.id,
    timestamp: row.timestamp,
    // A row stored before the sequence existed has no number of its own, and 0
    // is the honest reading: it is older than anything the service writes.
    seq: row.seq ?? 0,
    pluginId: row.pluginId,
    action: row.action,
    category: row.category as TelemetryEvent['category'],
    result: row.result as TelemetryEvent['result'],
    ...(row.sessionId === undefined ? {} : { sessionId: row.sessionId }),
    ...(row.metadata === undefined ? {} : { metadata: row.metadata }),
    ...(row.error === undefined ? {} : { error: snapshotError(row.error) }),
  })
}

/** Copy one stored error record into an owned, frozen {@link TelemetryErrorRecord}. */
function snapshotError(error: TelemetryErrorRecord): TelemetryErrorRecord {
  return Object.freeze({
    code: error.code,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    ...(error.featureCodeRef === undefined ? {} : { featureCodeRef: error.featureCodeRef }),
  })
}

/**
 * Extract the model route a failure ran on, by allowlist.
 *
 * `metadata` is an open map that a plugin fills with anything it likes, and the
 * report built from this analysis leaves the machine as a GitHub issue. Copying
 * the map wholesale would export whatever a plugin happened to put there, so
 * only these named keys cross the boundary — adding a key is a deliberate act,
 * not a side effect of a caller's choice.
 *
 * @param metadata - the event's metadata, when it has any.
 * @returns the route, or `undefined` when the event did not record a full one.
 */
function routeFromMetadata(metadata: Record<string, unknown> | undefined): TelemetryFailureRoute | undefined {
  if (metadata === undefined) return undefined
  const { provider, model, status } = metadata
  if (typeof provider !== 'string' || provider.length === 0) return undefined
  if (typeof model !== 'string' || model.length === 0) return undefined
  return Object.freeze({
    provider,
    model,
    ...(typeof status === 'number' && Number.isFinite(status) ? { status } : {}),
  })
}

export default TelemetryService