/**
 * Durable declaration for the issue intake loop's local state.
 *
 * The state is one row: the local day a pass last completed, and which issues
 * already reached a Session. Persisting it is what makes "the first startup of
 * the day" true across restarts — without it a second restart would either
 * repeat the check or, worse, open a second Session for the same issue.
 *
 * @module @zhangj1164/dsh-github-issue/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** One issue an earlier pass already handed to a Session. */
export interface IntakeDispatchedRow {
  /** Issue number inside the repository. */
  readonly number: number
  /** Local day the pass ran, as `YYYY-MM-DD`. */
  readonly day: string
  /** Session created for the issue. */
  readonly sessionId: string
}

/** The single persisted intake state row. */
export interface IntakeStateRow {
  /** Local day the last completed pass ran; empty before the first pass. */
  readonly lastCheckedDay: string
  /** Issues already dispatched, newest last. */
  readonly dispatched: readonly IntakeDispatchedRow[]
}

/** Table key of the single intake state row. */
export const INTAKE_STATE_KEY = 'intake'

/** Runtime schema for one dispatched issue. */
export const intakeDispatchedSchema = z.object({
  number: z.number().int().positive(),
  day: z.string().min(1),
  sessionId: z.string().min(1),
})

/** Runtime schema for the persisted intake state. */
export const intakeStateSchema = z.object({
  lastCheckedDay: z.string(),
  dispatched: z.array(intakeDispatchedSchema),
}) as unknown as z.ZodType<IntakeStateRow>

/** The intake state row, durable under the storage-domain KV table. */
export const intakeDomainSpec = defineDomain({
  name: 'github_issue_intake',
  version: 0,
  tables: {
    state: domainTable<string, IntakeStateRow>(intakeStateSchema),
  },
})
