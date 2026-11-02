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

import type { DomainSpec } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

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

/**
 * Build the storage-domain form of the intake state, on demand.
 *
 * The import is dynamic so this package stays loadable without
 * `@deepseek-ai/dsh-storage-domain`: that package is an optional peer, and a
 * deployment that does not ship it must lose the daily check, not the whole
 * plugin. Every DSH installation includes it, so the failure path is a
 * defence rather than a routine route.
 *
 * @returns the declared domain, ready for `storageDomain.open`.
 */
export async function createIntakeDomain(): Promise<DomainSpec> {
  const { defineDomain, domainTable } = await import('@deepseek-ai/dsh-storage-domain')
  return defineDomain({
    name: 'github_issue_intake',
    version: 0,
    tables: {
      state: domainTable<string, IntakeStateRow>(intakeStateSchema),
    },
  })
}
