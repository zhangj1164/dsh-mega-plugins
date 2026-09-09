/**
 * Durable storage-domain declaration for local memo weeks.
 *
 * One memo week is keyed by ISO-8601 week id (`YYYY-Www`). The schema validates
 * every stored week at the durable boundary, including its entries and optional
 * analysis, so a corrupted medium fails loud on reopen.
 *
 * @module dsh-memo/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { MemoAnalysis, MemoEntry, MemoWeek } from './types.ts'

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

const entryTypeSchema = z.union([z.literal('text'), z.literal('image'), z.literal('file')])

/** Runtime schema for one memo entry. */
export const memoEntrySchema = z.object({
  id: z.string().min(1),
  type: entryTypeSchema,
  content: z.string(),
  attachmentRef: z.string().optional(),
  source: z.string().optional(),
  createdAt: nonNegativeSafeInteger,
  updatedAt: nonNegativeSafeInteger,
}).refine(entry => entry.updatedAt >= entry.createdAt, {
  path: ['updatedAt'],
  message: 'memo entry updatedAt must not precede createdAt',
}) as unknown as z.ZodType<MemoEntry>

const analysisPeriodSchema = z.union([z.literal('week'), z.literal('month'), z.literal('quarter'), z.literal('year')])

/** Runtime schema for one analysis result. */
export const memoAnalysisSchema = z.object({
  period: analysisPeriodSchema,
  periodLabel: z.string().min(1),
  summary: z.string(),
  generatedAt: nonNegativeSafeInteger,
  modelProvider: z.string().min(1),
  modelName: z.string().min(1),
}) as unknown as z.ZodType<MemoAnalysis>

/** Runtime schema for one memo week — the primary storage unit. */
export const memoWeekSchema = z.object({
  weekId: z.string().min(1),
  weekStart: nonNegativeSafeInteger,
  weekEnd: nonNegativeSafeInteger,
  entries: z.array(memoEntrySchema),
  analysis: memoAnalysisSchema.optional(),
  updatedAt: nonNegativeSafeInteger,
}).refine(week => week.weekEnd > week.weekStart, {
  path: ['weekEnd'],
  message: 'memo week weekEnd must follow weekStart',
}) as unknown as z.ZodType<MemoWeek>

/** Persisted memo week inferred from {@link memoWeekSchema}. */
export type MemoWeekRow = z.infer<typeof memoWeekSchema>

/** One memo week per ISO week id, durable under the storage-domain KV table. */
export const memoDomainSpec = defineDomain({
  name: 'memo',
  version: 0,
  tables: {
    weeks: domainTable<string, MemoWeekRow>(memoWeekSchema),
  },
})

// Re-export the analysis types consumed by host callers so they resolve from one home.
export type { MemoAnalysisPeriod, MemoAnalysisType, MemoEntryType } from './types.ts'
