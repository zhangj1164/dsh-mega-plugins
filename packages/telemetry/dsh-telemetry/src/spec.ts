/**
 * Durable storage-domain declaration for local telemetry events.
 *
 * The telemetry log is keyed by opaque event id (UUID). The schema validates
 * every stored record at the durable boundary, so a corrupted medium fails loud
 * on reopen rather than silently serving malformed events.
 *
 * @module @zhangj1164/dsh-telemetry/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { TelemetryEvent } from './types.ts'

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** Runtime schema for the error record embedded in a failure event. */
export const telemetryErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  stack: z.string().optional(),
  featureCodeRef: z.string().optional(),
})

/**
 * Persisted telemetry event — the current format, plus records written before
 * `seq` existed, which validate without it. `seq` is optional here and required
 * on {@link TelemetryEvent} on purpose: a row has to keep other rows readable
 * even when it predates the field, while every event handed to a caller comes
 * back with a number.
 */
export type TelemetryEventRow = Omit<TelemetryEvent, 'seq'> & { readonly seq?: number }

/** Runtime schema for one telemetry event — the agreed log format. */
export const telemetryEventSchema = z.object({
  id: z.string().min(1),
  timestamp: nonNegativeSafeInteger,
  // Optional on the medium: making it required would reject the whole unit, and
  // the log with it, the first time a store written before the field is opened.
  seq: nonNegativeSafeInteger.optional(),
  pluginId: z.string().min(1),
  action: z.string().min(1),
  category: z.union([z.literal('user-action'), z.literal('system'), z.literal('error')]),
  result: z.union([z.literal('success'), z.literal('failure')]),
  sessionId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  error: telemetryErrorSchema.optional(),
}).refine(event => event.result !== 'failure' || event.error !== undefined, {
  message: 'a failure telemetry event must carry an error record',
  path: ['error'],
}) as unknown as z.ZodType<TelemetryEventRow>

/** One telemetry event per id, durable under the storage-domain KV table. */
export const telemetryDomainSpec = defineDomain({
  name: 'memo_telemetry',
  version: 0,
  tables: {
    events: domainTable<string, TelemetryEventRow>(telemetryEventSchema),
  },
})
