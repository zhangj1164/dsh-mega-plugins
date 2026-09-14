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
 * @module dsh-telemetry
 */

import { randomUUID } from 'node:crypto'
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
  private table?: KvTable<string, TelemetryEventRow>
  private readonly pendingWrites: Set<Promise<void>> = new Set()

  /**
   * @param ctx - Host context carrying the storage-domain form.
   * @param config - Validated deployment policy.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'telemetry')
    this.maxEventsPerQuery = config.maxEventsPerQuery
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
    this.table = domain.table('events')
  }

  /**
   * Record one telemetry event. The id and timestamp are assigned by the
   * service; the caller supplies the plugin id, action, category, result, and
   * optional metadata. The write is durable and queued on the domain's write
   * chain, so concurrent calls never interleave.
   * @param input - event fields without the id and timestamp.
   */
  track(input: TelemetryEventInput): void {
    const event: TelemetryEventRow = {
      id: randomUUID(),
      timestamp: Date.now(),
      pluginId: input.pluginId,
      action: input.action,
      category: input.category ?? 'user-action',
      result: input.result ?? 'success',
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...this.redactedMetadata(input.metadata),
    }
    void this.trackWrite(this.requireTable().put(event.id, event))
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
      pluginId: input.pluginId,
      action: input.action,
      category: 'error',
      result: 'failure',
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...this.redactedMetadata(input.metadata),
      error: this.redactedError(input.error),
    }
    void this.trackWrite(this.requireTable().put(event.id, event))
  }

  /**
   * Read telemetry events matching a query, newest first. The result is a
   * snapshot copy; callers may freely hold or mutate it.
   * @param query - optional filters and limit.
   * @returns matching events, newest first, capped at the deployment limit.
   */
  listEvents(query: TelemetryQuery = {}): TelemetryEvent[] {
    const table = this.requireTable()
    const limit = Math.min(query.limit ?? DEFAULT_QUERY_LIMIT, this.maxEventsPerQuery)
    const events: TelemetryEvent[] = []
    for (const [, row] of table.entries()) {
      if (events.length >= limit) break
      if (query.pluginId !== undefined && row.pluginId !== query.pluginId) continue
      if (query.category !== undefined && row.category !== query.category) continue
      if (query.result !== undefined && row.result !== query.result) continue
      if (query.from !== undefined && row.timestamp < query.from) continue
      if (query.to !== undefined && row.timestamp >= query.to) continue
      events.push(snapshotEvent(row))
    }
    return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit)
  }

  /**
   * Analyze failure events for one plugin, grouped by feature-code anchor.
   * @param pluginId - the plugin whose failures to analyze.
   * @returns total counts and grouped failure patterns.
   */
  analyzeForPlugin(pluginId: string): TelemetryAnalysis {
    const table = this.requireTable()
    let totalEvents = 0
    let totalFailures = 0
    const groups = new Map<string, { count: number; latest: TelemetryEvent; codes: Set<string> }>()
    for (const [, row] of table.entries()) {
      if (row.pluginId !== pluginId) continue
      totalEvents++
      if (row.result !== 'failure') continue
      totalFailures++
      const ref = row.error?.featureCodeRef ?? 'unknown'
      const existing = groups.get(ref)
      const event = snapshotEvent(row)
      if (existing === undefined) {
        groups.set(ref, { count: 1, latest: event, codes: new Set([row.error?.code ?? 'unknown']) })
      } else {
        existing.count++
        if (event.timestamp > existing.latest.timestamp) existing.latest = event
        existing.codes.add(row.error?.code ?? 'unknown')
      }
    }
    const failureGroups: TelemetryFailureGroup[] = [...groups.entries()]
      .map(([featureCodeRef, g]) => ({
        featureCodeRef,
        count: g.count,
        latest: g.latest,
        errorCodes: [...g.codes],
      }))
      .sort((a, b) => b.count - a.count)
    return Object.freeze({ pluginId, totalEvents, totalFailures, failureGroups })
  }

  /**
   * Wait for all in-flight fire-and-forget writes to settle. Tests call this
   * before reading to avoid a timing race between the write chain and the
   * synchronous read.
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

  /** Resolve the initialized durable table or fail a broken service lifecycle. */
  private requireTable(): KvTable<string, TelemetryEventRow> {
    if (this.table === undefined) {
      throw new Error('telemetry: durable domain is not initialized')
    }
    return this.table
  }
}

/** Copy one stored row into an owned, frozen {@link TelemetryEvent}. */
function snapshotEvent(row: TelemetryEventRow): TelemetryEvent {
  return Object.freeze({
    id: row.id,
    timestamp: row.timestamp,
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

export default TelemetryService