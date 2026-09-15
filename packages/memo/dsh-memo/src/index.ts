/**
 * Local memo service: a week-keyed personal memo store over the storage-domain
 * KV backend, with AI-powered analysis, report export, external-path reading
 * (privilege-gated), and telemetry-backed log analysis.
 *
 * Data is local-only: every entry, week, and analysis lives in the local
 * storage-domain table. The AI capability is optional — the service degrades
 * gracefully when no model provider is configured.
 *
 * Extends `TypertRemoteService` because the client memo panel calls its
 * methods through the API Gateway.
 *
 * @module dsh-memo
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { TelemetryFailureGroup } from 'dsh-telemetry/types'
import { streamLlmText, type LlmRoute, type LlmTextResult, type LlmTextSource } from './llm-text.ts'
import {
  isoWeekParts,
  mondayOfWeekId,
  periodBounds,
  periodLabelFor,
  shiftPeriod,
  startOfIsoWeek,
  weekIdBelongsToPeriod,
  weekIdsInPeriod,
} from './period.ts'
import { memoArchiveDomainSpec, memoDomainSpec } from './spec.ts'
import type { ArchivedQuarterRow, MemoWeekRow } from './spec.ts'
import type {
  MemoAddEntryRequest,
  MemoAddEntryResult,
  MemoAnalyzeLogsRequest,
  MemoAnalyzeLogsResult,
  MemoAnalyzeRequest,
  MemoAnalyzeResult,
  MemoAnalysis,
  MemoAnalysisType,
  MemoArchiveQuarterResult,
  MemoArchivedQuarter,
  MemoDeleteEntryRequest,
  MemoDeleteEntryResult,
  MemoEntry,
  MemoExportReportRequest,
  MemoExportReportResult,
  MemoGetCurrentWeekRequest,
  MemoGetCurrentWeekResult,
  MemoGetWeekRequest,
  MemoGetWeekResult,
  MemoListArchivedQuartersResult,
  MemoListArchivedQuartersRequest,
  MemoListModelsRequest,
  MemoListModelsResult,
  MemoModelProvider,
  MemoListWeeksRequest,
  MemoListWeeksResult,
  MemoLogAnalysisResult,
  MemoListPeriodsRequest,
  MemoListPeriodsResult,
  MemoMemoFailure,
  MemoQuarterLabelRequest,
  MemoReadExternalPathRequest,
  MemoUnarchiveQuarterResult,
  MemoUpdateEntryRequest,
  MemoUpdateEntryResult,
  MemoWeek,
  MemoMemoryEntry,
  MemoLedger,
  MemoListMemoryRequest,
  MemoListMemoryResult,
} from './types.ts'

export type * from './types.ts'
export { memoArchiveDomainSpec, memoDomainSpec, memoWeekSchema, memoEntrySchema, memoAnalysisSchema, archivedQuarterSchema } from './spec.ts'
export type { ArchivedQuarterRow, MemoWeekRow } from './spec.ts'
export { streamLlmText } from './llm-text.ts'
export type { LlmRoute, LlmTextFailure, LlmTextResult, LlmTextSource } from './llm-text.ts'
export {
  isPeriodLabel,
  isoWeekParts,
  mondayOfWeekId,
  periodBounds,
  periodLabelFor,
  shiftPeriod,
  startOfIsoWeek,
  weekIdBelongsToPeriod,
  weekIdsInPeriod,
} from './period.ts'

/** Deployment configuration for the memo service. */
export interface Config {
  /**
   * The GitHub repository URL for the log-analysis prefill. The deployment
   * sets this to the memo plugin's GitHub project address.
   */
  readonly repoUrl: string
  /**
   * The registered DSH provider route that AI analysis calls use. Leave it
   * unset to follow this deployment's `agentDefaultModel` selection; set it
   * to pin memo analysis to a specific route.
   */
  readonly provider?: string
  /**
   * The model id that AI analysis calls use. Leave it unset to follow this
   * deployment's `agentDefaultModel` selection.
   */
  readonly model?: string
}

/** Schemastery configuration for the memo service. */
export const Config: s<Config> = s.object({
  repoUrl: s.string().default('https://github.com/zhangj1164/dsh-mega-plugins'),
  provider: s.string(),
  model: s.string(),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    memo: MemoService
  }
}

/** The service key under which telemetry events are recorded for this plugin. */
const TELEMETRY_PLUGIN_ID = 'memo'

/** Ledger schema version for forward-compatible migrations. */
const LEDGER_SCHEMA_VERSION = 1

/** Canonical quarter label, the only key shape the archive accepts. */
const QUARTER_LABEL_PATTERN = /^\d{4}-Q[1-4]$/u

/**
 * Resolve the DSH home directory: the environment override wins, the platform
 * home fallback follows. Mirrors the task-board's dsh-home.ts pattern.
 * @param env - process environment to read DSH_HOME from.
 * @param home - platform home directory fallback (test seam).
 * @returns the absolute DSH home path.
 */
function resolveDshHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return env.DSH_HOME ?? home
}

/** Resolve the memo ledger file path under $DSH_HOME/memo/. */
function ledgerFile(): string {
  return join(resolveDshHome(), 'memo', 'ledger.json')
}

/** Read the persistent ledger from disk (returns an empty ledger when absent). */
function readLedger(): MemoLedger {
  try {
    const file = ledgerFile()
    if (!existsSync(file)) return { schemaVersion: LEDGER_SCHEMA_VERSION, analyses: [] }
    const raw = readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as Partial<MemoLedger>
    if (parsed.schemaVersion !== LEDGER_SCHEMA_VERSION || !Array.isArray(parsed.analyses)) {
      return { schemaVersion: LEDGER_SCHEMA_VERSION, analyses: [] }
    }
    return { schemaVersion: parsed.schemaVersion, analyses: parsed.analyses }
  } catch {
    return { schemaVersion: LEDGER_SCHEMA_VERSION, analyses: [] }
  }
}

/** Write the persistent ledger to disk (creates the directory if missing). */
function writeLedger(ledger: MemoLedger): void {
  try {
    const file = ledgerFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify(ledger, null, 2), 'utf8')
  } catch {
    // Best-effort: if the ledger write fails (disk full, permissions),
    // the in-memory analysis is still returned to the caller. The next
    // successful write will re-serialize the full list.
  }
}

/** Append one analysis result to the persistent ledger. */
function appendToLedger(entry: MemoMemoryEntry): void {
  const ledger = readLedger()
  const updated: MemoLedger = {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    analyses: [entry, ...ledger.analyses].slice(0, 500),
  }
  writeLedger(updated)
}

/**
 * Start and end-of-day timestamps for the ISO week beginning at `monday`.
 *
 * The end is the Sunday's last millisecond, which is what makes stored bounds
 * satisfy the week schema's `weekEnd > weekStart` refinement.
 * @param monday - the week's Monday at local midnight.
 * @returns the week's start and end timestamps.
 */
function weekBoundsFromMonday(monday: Date): { weekStart: number; weekEnd: number } {
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { weekStart: monday.getTime(), weekEnd: sunday.getTime() }
}

/**
 * Compute the ISO-8601 week id and range for a given date.
 * Monday is the start of the week; Sunday is the end. The week-year comes
 * from the week's Thursday, so a week at a year boundary is labelled with the
 * year that owns it rather than the calendar year of its Monday.
 * @param date - the reference date (defaults to now).
 * @returns the week id, start, and end timestamps.
 */
function computeWeekBounds(date: Date = new Date()): { weekId: string; weekStart: number; weekEnd: number } {
  const { weekYear, week } = isoWeekParts(date)
  const weekId = `${String(weekYear)}-W${String(week).padStart(2, '0')}`
  return { weekId, ...weekBoundsFromMonday(startOfIsoWeek(date)) }
}

/** Built-in system prompts for each analysis type. */
const ANALYSIS_PROMPTS: Record<MemoAnalysisType, string> = {
  '梳理': 'You are a work organizer. Organize the following memo entries into a clear, structured outline. Group related items, identify themes, and present them as a numbered list. Return only the structured text.',
  '总结': 'You are a work summarizer. Summarize the following memo entries into a concise paragraph highlighting the key points. Return only the summary text.',
  '分析': 'You are a work analyst. Analyze the following memo entries for patterns, progress, blockers, and priorities. Return a structured analysis with sections for each aspect.',
}

/** Built-in system prompt for report export. */
const REPORT_EXPORT_PROMPT = [
  'You are a professional work-report generator. Given the memo entries for a',
  'period, produce a structured work report in Markdown following standard',
  'annual/quarterly report conventions. Include sections for: summary of work',
  'completed, key achievements, challenges and blockers, priorities for the next',
  'period, and metrics if available. Return only the Markdown text.',
].join('\n')

/**
 * Local memo service: week-keyed personal memos with AI analysis and export.
 */
export class MemoService extends TypertRemoteService {
  static inject = ['storageDomain', 'telemetry', 'githubIssue']
  static Config = Config

  private readonly repoUrl: string
  /** Configured provider route, or `undefined` to follow `agentDefaultModel`. */
  private readonly provider?: string
  /** Configured model id, or `undefined` to follow `agentDefaultModel`. */
  private readonly model?: string
  private table?: KvTable<string, MemoWeekRow>
  private archiveTable?: KvTable<string, ArchivedQuarterRow>

  /**
   * @param ctx - Host context carrying the storage-domain, telemetry, and github-issue services.
   * @param config - Validated deployment configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'memo')
    this.repoUrl = config.repoUrl
    this.provider = config.provider
    this.model = config.model
  }

  /** Open and own the memo domain and the archive domain beside it. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(memoDomainSpec)
    this.ctx.effect(() => async () => {
      await domain.close()
    }, 'memo.domainClose')
    this.table = domain.table('weeks')

    const archiveDomain = await this.ctx.storageDomain.open(memoArchiveDomainSpec)
    this.ctx.effect(() => async () => {
      await archiveDomain.close()
    }, 'memo.archiveDomainClose')
    this.archiveTable = archiveDomain.table('quarters')
  }

  /**
   * Archive one quarter by its label.
   *
   * The caller names a quarter label rather than a period it happens to be
   * viewing: only a quarter label identifies a quarter. A year spans four of
   * them, and a week's Monday can sit in the previous quarter while the week
   * itself belongs to the quarter holding its Thursday — so "the quarter
   * containing the period you are looking at" has no single answer, and
   * guessing one from a period's start would archive the wrong quarter.
   *
   * @param request - the quarter label.
   * @returns the archived quarter, with the week ids the host resolved.
   */
  @Remote('archiveQuarter')
  async archiveQuarter(request: MemoQuarterLabelRequest): Promise<MemoArchiveQuarterResult> {
    const label = request?.label
    if (typeof label !== 'string' || !QUARTER_LABEL_PATTERN.test(label)) {
      return this.failure({
        code: 'invalid-quarter-label',
        message: `memo: "${String(label)}" is not a quarter label`,
        label: String(label ?? ''),
      })
    }
    const archivedAt = Date.now()
    await this.requireArchiveTable().put(label, { label, archivedAt })
    this.track('archiveQuarter', 'success', { label })
    return { ok: true, value: this.archivedQuarter(label, archivedAt) }
  }

  /**
   * Remove a quarter from the archive, restoring its cards to editable.
   * @param request - the quarter label.
   * @returns the label and whether a row was actually removed.
   */
  @Remote('unarchiveQuarter')
  async unarchiveQuarter(request: MemoQuarterLabelRequest): Promise<MemoUnarchiveQuarterResult> {
    const label = request?.label
    if (typeof label !== 'string' || !QUARTER_LABEL_PATTERN.test(label)) {
      return this.failure({
        code: 'invalid-quarter-label',
        message: `memo: "${String(label)}" is not a quarter label`,
        label: String(label ?? ''),
      })
    }
    const archived = await this.requireArchiveTable().delete(label)
    this.track('unarchiveQuarter', 'success', { label, archived })
    return { ok: true, value: { label, archived } }
  }

  /**
   * List every archived quarter, oldest first.
   *
   * Each entry carries the quarter's week ids resolved through the host's own
   * calendar, so a client decides read-only cards by building a `Set` and never
   * by re-deriving which weeks a quarter owns.
   *
   * @param request - carries no input; the Remote protocol binds arguments by
   * name, so the client's `{ args: { request } }` needs this parameter to exist.
   * @returns the archived quarters, oldest first.
   */
  @Remote('listArchivedQuarters')
  listArchivedQuarters(request: MemoListArchivedQuartersRequest): MemoListArchivedQuartersResult {
    void request
    const rows = [...this.requireArchiveTable().entries()]
      .map(([label, row]) => ({ label, archivedAt: row.archivedAt }))
      .sort((a, b) => a.label.localeCompare(b.label))
    const quarters = rows.map(row => this.archivedQuarter(row.label, row.archivedAt))
    this.track('listArchivedQuarters', 'success', { count: quarters.length })
    return { ok: true, value: Object.freeze(quarters) }
  }

  /** Build one archived quarter with its week ids resolved by the host calendar. */
  private archivedQuarter(label: string, archivedAt: number): MemoArchivedQuarter {
    return Object.freeze({
      label,
      archivedAt,
      weekIds: Object.freeze(weekIdsInPeriod('quarter', label)),
    })
  }

  /**
   * The failure to return for a write that targets a week inside an archived
   * quarter, or `undefined` when the week is writable.
   *
   * Read-only is enforced here rather than only in the browser because the same
   * Remote methods are reachable by any client, and because an archive can land
   * while a dialog is already open. The quarter a week belongs to is decided by
   * {@link weekIdBelongsToPeriod} — the same Thursday rule that decides which
   * weeks a quarter owns — so the guard cannot drift from the calendar that
   * resolved those weeks in the first place.
   * @param weekId - the week the write targets.
   * @returns the failure, or `undefined` when the week may be written.
   */
  private archivedWeekFailure(weekId: string): MemoMemoFailure | undefined {
    const archived = [...this.requireArchiveTable().entries()]
      .some(([label]) => weekIdBelongsToPeriod(weekId, 'quarter', label))
    if (!archived) return undefined
    return {
      code: 'quarter-archived',
      message: `week "${weekId}" is inside an archived quarter; unarchive the quarter before changing its memos`,
      weekId,
    }
  }

  /** Resolve the initialized archive table or fail a broken service lifecycle. */
  private requireArchiveTable(): KvTable<string, ArchivedQuarterRow> {
    if (this.archiveTable === undefined) {
      throw new Error('memo: archive domain is not initialized')
    }
    return this.archiveTable
  }

  /**
   * Get or create the current week's memo. If the current ISO week already
   * has a stored week, it is returned; otherwise a new empty week is created.
   * @param request - optional provider/model route override, unused by this call.
   * @returns the current week.
   */
  @Remote('getOrCreateCurrentWeek')
  async getOrCreateCurrentWeek(request: MemoGetCurrentWeekRequest): Promise<MemoGetCurrentWeekResult> {
    const table = this.requireTable()
    const { weekId, weekStart, weekEnd } = computeWeekBounds()
    const existing = table.get(weekId)
    if (existing !== undefined) {
      this.track('getOrCreateCurrentWeek', 'success')
      return { ok: true, value: snapshotWeek(existing) }
    }
    const week: MemoWeekRow = {
      weekId,
      weekStart,
      weekEnd,
      entries: [],
      updatedAt: Date.now(),
    }
    await table.put(weekId, week)
    this.track('getOrCreateCurrentWeek', 'success')
    return { ok: true, value: snapshotWeek(week) }
  }

  /**
   * Get one week by id.
   * @param request - the week id to load.
   * @returns the week, or `undefined` when it does not exist.
   */
  @Remote('getWeek')
  getWeek(request: MemoGetWeekRequest): MemoGetWeekResult {
    const table = this.requireTable()
    const week = table.get(request.weekId)
    this.track('getWeek', 'success', { weekId: request.weekId })
    return { ok: true, value: week !== undefined ? snapshotWeek(week) : null }
  }

  /**
   * List weeks in a range, newest first.
   * @param request - optional range bounds.
   * @returns matching weeks.
   */
  @Remote('listWeeks')
  listWeeks(request: MemoListWeeksRequest): MemoListWeeksResult {
    const table = this.requireTable()
    const weeks: MemoWeek[] = []
    for (const [, row] of table.entries()) {
      if (request.from !== undefined && row.weekStart < request.from) continue
      if (request.to !== undefined && row.weekStart >= request.to) continue
      weeks.push(snapshotWeek(row))
    }
    weeks.sort((a, b) => b.weekStart - a.weekStart)
    this.track('listWeeks', 'success')
    return { ok: true, value: Object.freeze(weeks) }
  }

  /**
   * Add an entry to a week. Creates the week if it does not exist.
   * @param request - the week id and entry content.
   * @returns the created entry.
   */
  @Remote('addEntry')
  async addEntry(request: MemoAddEntryRequest): Promise<MemoAddEntryResult> {
    const table = this.requireTable()
    const archived = this.archivedWeekFailure(request.weekId)
    if (archived !== undefined) return this.failure(archived)
    const existing = table.get(request.weekId)
    const now = Date.now()
    const entry: MemoEntry = {
      id: randomUUID(),
      type: request.type,
      content: request.content,
      ...(request.attachmentRef === undefined ? {} : { attachmentRef: request.attachmentRef }),
      ...(request.source === undefined ? {} : { source: request.source }),
      createdAt: now,
      updatedAt: now,
    }
    // A back-filled week has no stored row yet, so its bounds must come from its
    // id. Writing zeros here — as an earlier revision did — produced a row that
    // the week schema rejects, and because the storage domain validates every
    // record on open, that one row then stopped the whole plugin from booting.
    let week: MemoWeekRow
    if (existing === undefined) {
      const monday = mondayOfWeekId(request.weekId)
      if (monday === undefined) {
        return this.failure({
          code: 'invalid-week-id',
          message: `"${request.weekId}" is not an ISO week id (expected YYYY-Www)`,
          weekId: request.weekId,
        })
      }
      week = { weekId: request.weekId, ...weekBoundsFromMonday(monday), entries: [entry], updatedAt: now }
    } else {
      week = { ...existing, entries: [...existing.entries, entry], updatedAt: now }
    }
    await table.put(request.weekId, week)
    this.track('addEntry', 'success', { weekId: request.weekId, entryId: entry.id })
    return { ok: true, value: Object.freeze({ ...entry }) }
  }

  /**
   * Update an entry's content. Editing a past week (not the current week)
   * requires `force: true` to acknowledge that AI analysis may change.
   * @param request - the week id, entry id, new content, and force flag.
   * @returns the updated entry.
   */
  @Remote('updateEntry')
  async updateEntry(request: MemoUpdateEntryRequest): Promise<MemoUpdateEntryResult> {
    const table = this.requireTable()
    const archived = this.archivedWeekFailure(request.weekId)
    if (archived !== undefined) return this.failure(archived)
    const row = table.get(request.weekId)
    if (row === undefined) {
      return this.failure({ code: 'week-not-found', message: `week "${request.weekId}" not found`, weekId: request.weekId })
    }
    const { weekId: currentWeekId } = computeWeekBounds()
    if (request.weekId !== currentWeekId && !request.force) {
      return this.failure({
        code: 'past-week-requires-force',
        message: `editing week "${request.weekId}" (not the current week) requires force=true; AI analysis results may change`,
        weekId: request.weekId,
      })
    }
    const entryIndex = row.entries.findIndex(e => e.id === request.entryId)
    if (entryIndex === -1) {
      return this.failure({ code: 'entry-not-found', message: `entry "${request.entryId}" not found in week "${request.weekId}"`, entryId: request.entryId })
    }
    const now = Date.now()
    const entries = [...row.entries]
    const old = entries[entryIndex]
    if (old === undefined) throw new Error('memo: entry disappeared between find and update')
    const updated: MemoEntry = {
      id: old.id,
      type: old.type,
      content: request.content,
      ...(old.attachmentRef !== undefined ? { attachmentRef: old.attachmentRef } : {}),
      ...(old.source !== undefined ? { source: old.source } : {}),
      createdAt: old.createdAt,
      updatedAt: now,
    }
    entries[entryIndex] = updated
    await table.put(request.weekId, { ...row, entries, updatedAt: now })
    this.track('updateEntry', 'success', { weekId: request.weekId, entryId: request.entryId, force: request.force ?? false })
    return { ok: true, value: Object.freeze({ ...updated }) }
  }

  /**
   * Delete an entry from a week. Deleting from a past week requires `force: true`.
   * @param request - the week id, entry id, and force flag.
   * @returns success.
   */
  @Remote('deleteEntry')
  async deleteEntry(request: MemoDeleteEntryRequest): Promise<MemoDeleteEntryResult> {
    const table = this.requireTable()
    const archived = this.archivedWeekFailure(request.weekId)
    if (archived !== undefined) return this.failure(archived)
    const row = table.get(request.weekId)
    if (row === undefined) {
      return this.failure({ code: 'week-not-found', message: `week "${request.weekId}" not found`, weekId: request.weekId })
    }
    const { weekId: currentWeekId } = computeWeekBounds()
    if (request.weekId !== currentWeekId && !request.force) {
      return this.failure({
        code: 'past-week-requires-force',
        message: `deleting from week "${request.weekId}" (not the current week) requires force=true`,
        weekId: request.weekId,
      })
    }
    const entry = row.entries.find(e => e.id === request.entryId)
    if (entry === undefined) {
      return this.failure({ code: 'entry-not-found', message: `entry "${request.entryId}" not found in week "${request.weekId}"`, entryId: request.entryId })
    }
    const entries = row.entries.filter(e => e.id !== request.entryId)
    await table.put(request.weekId, { ...row, entries, updatedAt: Date.now() })
    this.track('deleteEntry', 'success', { weekId: request.weekId, entryId: request.entryId, force: request.force ?? false })
    return { ok: true, value: true }
  }

  /**
   * Resolve the model route for one AI call. The caller's explicit request
   * wins, then this service's validated `Config`, then the deployment's
   * `agentDefaultModel` selection — the single existing source of truth for
   * "which model does this deployment use". Nothing is hardcoded, so a
   * deployment can retarget memo analysis from `cordis.yml` alone.
   * @param request - the caller's optional route override.
   * @returns the provider and model to call, either of which may be empty.
   */
  private resolveRoute(request: { readonly provider?: string; readonly model?: string }): LlmRoute {
    const configured = { provider: this.provider, model: this.model }
    const fallback = this.ctx.get('agentDefaultModel')?.currentSelection()
    return {
      provider: request.provider ?? configured.provider ?? fallback?.provider ?? '',
      model: request.model ?? configured.model ?? fallback?.model ?? '',
    }
  }

  /**
   * Turn one failed model call into this service's business failure, keeping
   * the DSH machine-routing code and message so a misconfigured route is
   * distinguishable from a genuinely empty model response.
   * @param feature - the telemetry action name the failure is recorded under.
   * @param route - the route that was attempted.
   * @param failure - the preserved DSH failure facts.
   * @returns the business failure to return to the caller.
   */
  private llmFailure(feature: string, route: LlmRoute, failure: LlmTextResult & { ok: false }): MemoMemoFailure {
    const detail = failure.failure
    const message = `model call to provider "${route.provider}" model "${route.model}" failed: ${detail.code}: ${detail.message}`
    this.trackError(
      feature,
      { code: detail.code, message: detail.message, featureCodeRef: `memo:${feature}` },
      { provider: route.provider, model: route.model, ...(detail.status === undefined ? {} : { status: detail.status }) },
    )
    return this.failure({
      code: 'llm-failure',
      failureCode: detail.code,
      message,
      provider: route.provider,
      model: route.model,
      ...(detail.status === undefined ? {} : { status: detail.status }),
    })
  }

  /**
   * Report the route AI analysis would use now, plus every route it can be
   * switched to and what each one advertises.
   *
   * The catalog comes from the `llm` service because DSH exposes `listModels`
   * and `listProviders` to the host only: a browser cannot enumerate providers
   * or their models, and handing it a hardcoded list is the defect this feature
   * exists to avoid — the browser cannot know which adapters a deployment
   * registered. Only *registered* routes are listed. An adapter may also declare
   * providers it could activate through configuration, but a dormant one cannot
   * carry a call, so offering it would offer a selection that must fail.
   *
   * Each provider's catalog is fetched independently: one adapter that throws
   * must not hide the models every other provider is willing to serve. Anything
   * that leaves the list empty is reported as data inside a successful result,
   * so a deployment without a model route still opens the board.
   *
   * @param request - carries no input; the Remote protocol binds arguments by
   * name, so the client's `{ args: { request } }` needs this parameter to exist.
   * @returns the resolved route and every registered provider with its models.
   */
  @Remote('listModels')
  async listModels(request: MemoListModelsRequest): Promise<MemoListModelsResult> {
    void request
    const route = this.resolveRoute({})
    const llm = this.ctx.get('llm') as LlmModelCatalog | undefined
    if (llm === undefined) {
      this.track('listModels', 'failure', { ...this.routeFacts(route), reason: 'llm-unavailable' })
      return { ok: true, value: { ...route, providers: [], catalogError: 'the llm service is not mounted' } }
    }
    let registered: readonly { readonly id: string; readonly name: string }[]
    try {
      registered = llm.listProviders()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.track('listModels', 'failure', { ...this.routeFacts(route), reason: 'providers-threw' })
      return { ok: true, value: { ...route, providers: [], catalogError: message } }
    }
    if (registered.length === 0) {
      this.track('listModels', 'failure', { ...this.routeFacts(route), reason: 'no-provider' })
      return { ok: true, value: { ...route, providers: [], catalogError: 'no provider route is registered' } }
    }
    // Fetched together rather than one after another: an unreachable provider
    // should cost the board one slow catalog, not a queue of them.
    const providers = await Promise.all(registered.map(async (entry): Promise<MemoModelProvider> => {
      const name = entry.name.length > 0 ? entry.name : entry.id
      try {
        const advertised = await llm.listModels(entry.id)
        const models = Object.freeze(advertised.map(model => Object.freeze({ id: model.id, name: model.name })))
        return Object.freeze({ id: entry.id, name, models })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return Object.freeze({ id: entry.id, name, models: Object.freeze([]), error: message })
      }
    }))
    const count = providers.reduce((total, provider) => total + provider.models.length, 0)
    this.track('listModels', 'success', { ...this.routeFacts(route), providers: providers.length, count })
    return { ok: true, value: { ...route, providers: Object.freeze(providers) } }
  }

  /**
   * Analyze memo entries for a period using the configured model. The analysis
   * type controls the system prompt: 梳理 (organize), 总结 (summarize), 分析
   * (analyze).
   * @param request - period, label, analysis type, and optional model route.
   * @returns the analysis result.
   */
  @Remote('analyze')
  async analyze(request: MemoAnalyzeRequest): Promise<MemoAnalyzeResult> {
    const table = this.requireTable()
    const entries = this.collectEntries(table, request.period, request.periodLabel)
    if (entries.length === 0) {
      return this.failure({ code: 'no-entries', message: `no memo entries found for ${request.periodLabel}` })
    }
    const route = this.resolveRoute(request)
    const systemPrompt = ANALYSIS_PROMPTS[request.analysisType]
    const userText = entries.map(e => `- [${e.type}] ${e.content}`).join('\n')
    const result = await streamLlmText(this.ctx.get('llm') as LlmTextSource | undefined, route, systemPrompt, userText)
    if (!result.ok) {
      return this.llmFailure('analyze', route, result)
    }
    const body = result.text
    const analysis: MemoAnalysis = {
      period: request.period,
      periodLabel: request.periodLabel,
      summary: body,
      generatedAt: Date.now(),
      modelProvider: route.provider,
      modelName: route.model,
    }
    this.track('analyze', 'success', { ...this.routeFacts(route), period: request.period, periodLabel: request.periodLabel, analysisType: request.analysisType })
    appendToLedger({
      id: randomUUID(),
      period: request.period,
      periodLabel: request.periodLabel,
      analysisType: request.analysisType,
      summary: body,
      generatedAt: Date.now(),
    })
    return { ok: true, value: Object.freeze(analysis) }
  }

  /**
   * Export a work report for a period as Markdown.
   * @param request - period, label, and optional model route.
   * @returns the Markdown report.
   */
  @Remote('exportReport')
  async exportReport(request: MemoExportReportRequest): Promise<MemoExportReportResult> {
    const table = this.requireTable()
    const entries = this.collectEntries(table, request.period, request.periodLabel)
    if (entries.length === 0) {
      return this.failure({ code: 'no-entries', message: `no memo entries found for ${request.periodLabel}` })
    }
    const route = this.resolveRoute(request)
    const userText = entries.map(e => `- [${e.type}] ${e.content}`).join('\n')
    const result = await streamLlmText(this.ctx.get('llm') as LlmTextSource | undefined, route, REPORT_EXPORT_PROMPT, userText)
    if (!result.ok) {
      return this.llmFailure('exportReport', route, result)
    }
    this.track('exportReport', 'success', { ...this.routeFacts(route), period: request.period, periodLabel: request.periodLabel })
    return { ok: true, value: result.text }
  }

  /**
   * Read an external file path. This is the privilege-escalation boundary
   * (req 5): the client UI must show a consent dialog before calling this
   * method. The fs service's sandbox policy is the actual security boundary.
   * @param request - the path to read and the model route for context.
   * @returns the file text, or a failure.
   */
  @Remote('readExternalPath')
  async readExternalPath(request: MemoReadExternalPathRequest): Promise<ReadExternalPathResult> {
    const fs = this.ctx.get('fs')
    if (fs === undefined) {
      this.trackError('readExternalPath', { code: 'FS_UNAVAILABLE', message: 'fs service not available', featureCodeRef: 'memo:readExternalPath' })
      return this.failure({ code: 'fs-unavailable', message: 'the filesystem service is not available' })
    }
    try {
      const target = await fs.resolve(request.path)
      const text = await fs.readText(target)
      this.track('readExternalPath', 'success', { path: request.path })
      return { ok: true, value: text }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.trackError('readExternalPath', { code: 'FS_ERROR', message, featureCodeRef: 'memo:readExternalPath' })
      return this.failure({ code: 'approval-denied', message: `could not read "${request.path}": ${message}` })
    }
  }

  /**
   * Analyze telemetry logs for this plugin and generate a GitHub issue report.
   * Calls the telemetry service for the failure analysis, then the github-issue
   * service for the report and prefill URL.
   * @param request - plugin id, repo URL, and model route.
   * @returns the issue report, prefill URL, and analysis summary.
   */
  @Remote('analyzeLogs')
  async analyzeLogs(request: MemoAnalyzeLogsRequest): Promise<MemoAnalyzeLogsResult> {
    const telemetry = this.ctx.get('telemetry')
    if (telemetry === undefined) {
      return this.failure({ code: 'github-issue-failure', message: 'the telemetry service is not available' })
    }
    const githubIssue = this.ctx.get('githubIssue')
    if (githubIssue === undefined) {
      return this.failure({ code: 'github-issue-failure', message: 'the github-issue service is not available' })
    }
    const pluginId = request.pluginId ?? TELEMETRY_PLUGIN_ID
    const analysis = telemetry.analyzeForPlugin(pluginId)
    const route = this.resolveRoute(request)
    const reportResult = await githubIssue.generateReport({
      pluginId,
      totalEvents: analysis.totalEvents,
      totalFailures: analysis.totalFailures,
      // The window and the per-group timing are what let the report say whether
      // a failure is still happening; the route is what lets it say where.
      ...(analysis.window === undefined ? {} : { window: analysis.window }),
      failureGroups: analysis.failureGroups.map((g: TelemetryFailureGroup) => ({
        featureCodeRef: g.featureCodeRef,
        count: g.count,
        ...(g.latest.error?.code !== undefined ? { errorCode: g.latest.error.code } : {}),
        ...(g.latest.error?.message !== undefined ? { errorMessage: g.latest.error.message } : {}),
        lastFailureAt: g.latest.timestamp,
        attemptsAfterLastFailure: g.attemptsAfterLastFailure,
        ...(g.route === undefined ? {} : { route: g.route }),
      })),
      provider: route.provider,
      model: route.model,
    })
    if (!reportResult.ok) {
      return this.failure({ code: 'github-issue-failure', message: reportResult.error.message })
    }
    const urlResult = githubIssue.prefilledIssueUrl({
      repoUrl: request.repoUrl ?? this.repoUrl,
      report: reportResult.value,
    })
    if (!urlResult.ok) {
      return this.failure({ code: 'github-issue-failure', message: urlResult.error.message })
    }
    const result: MemoLogAnalysisResult = Object.freeze({
      report: reportResult.value,
      issueUrl: urlResult.value,
      analysis: Object.freeze({
        totalEvents: analysis.totalEvents,
        totalFailures: analysis.totalFailures,
        ...(analysis.window === undefined ? {} : { window: analysis.window }),
        failureGroups: Object.freeze(analysis.failureGroups.map((g: TelemetryFailureGroup) => ({
          featureCodeRef: g.featureCodeRef,
          count: g.count,
          errorCodes: Object.freeze(g.errorCodes),
          lastFailureAt: g.latest.timestamp,
          attemptsAfterLastFailure: g.attemptsAfterLastFailure,
          ...(g.route === undefined ? {} : { route: g.route }),
        }))),
      }),
    })
    this.track('analyzeLogs', 'success', { ...this.routeFacts(route), pluginId })
    return { ok: true, value: result }
  }

  /**
   * Collect entries across weeks for a period label. Week periods match the
   * weekId directly; month/quarter/year periods match the weekId prefix.
   * @param table - the storage table.
   * @param period - the analysis period.
   * @param periodLabel - the period label (e.g. `'2025-W03'`, `'2025-01'`, `'2025-Q1'`, `'2025'`).
   * @returns matching entries, in chronological order.
   */
  private collectEntries(table: KvTable<string, MemoWeekRow>, period: string, periodLabel: string): MemoEntry[] {
    const entries: MemoEntry[] = []
    for (const [, row] of table.entries()) {
      if (this.weekMatchesPeriod(row.weekId, period, periodLabel)) {
        entries.push(...row.entries.map(e => Object.freeze({ ...e })))
      }
    }
    return entries.sort((a, b) => a.createdAt - b.createdAt)
  }

  /**
   * List the memo timeline in one dimension, newest period first.
   *
   * This is the host-side source of truth for four-dimension navigation: the
   * UI asks for `week`/`month`/`quarter`/`year` and receives the navigable
   * periods **plus** the week ids each one contains, so the UI never has to
   * re-implement calendar math that could disagree with storage.
   *
   * Periods that contain no stored week are still listed — an empty period is
   * a valid place to add the first card, and omitting it would make the
   * timeline skip months the user can see on a calendar.
   *
   * @param request - the dimension and how many periods to return.
   * @returns the periods, newest first.
   */
  @Remote('listPeriods')
  listPeriods(request: MemoListPeriodsRequest): MemoListPeriodsResult {
    const table = this.requireTable()
    const stored = new Set<string>()
    for (const [weekId] of table.entries()) stored.add(weekId)

    const limit = Math.max(1, Math.min(request.limit ?? 26, 400))
    const now = new Date()
    const currentLabel = periodLabelFor(request.period, now)
    const periods: MemoPeriodEntry[] = []
    for (let offset = 0; offset < limit; offset += 1) {
      const label = shiftPeriod(request.period, currentLabel, -offset)
      if (label === undefined) break
      const weekIds = weekIdsInPeriod(request.period, label)
      const range = periodBounds(request.period, label) ?? { start: 0, end: 0 }
      periods.push(Object.freeze({
        id: label,
        label,
        period: request.period,
        start: range.start,
        end: range.end,
        current: label === currentLabel,
        weekCount: weekIds.filter(weekId => stored.has(weekId)).length,
        weekIds: Object.freeze(weekIds),
      }))
    }
    this.track('listPeriods', 'success', { period: request.period, limit })
    return { ok: true, value: Object.freeze(periods) }
  }

  /**
   * Whether a week id is attributed to a period label.
   * @param weekId - the ISO week id.
   * @param period - the period kind.
   * @param periodLabel - the period label.
   * @returns whether the week's Monday falls inside the period.
   */
  private weekMatchesPeriod(weekId: string, period: string, periodLabel: string): boolean {
    if (period !== 'week' && period !== 'month' && period !== 'quarter' && period !== 'year') return false
    return weekIdBelongsToPeriod(weekId, period, periodLabel)
  }

  /**
   * List long-term memory entries (persisted AI analyses from the JSON ledger).
   * This is the "long-term memory" feature: every successful `analyze` call
   * appends its result to `$DSH_HOME/memo/ledger.json`, and this method
   * reads them back for review and cross-period comparison.
   * @param request - optional period filter and limit.
   * @returns the memory entries, newest first.
   */
  @Remote('listMemory')
  listMemory(request: MemoListMemoryRequest): MemoListMemoryResult {
    try {
      const ledger = readLedger()
      let entries = [...ledger.analyses]
      if (request.period !== undefined) {
        entries = entries.filter(e => e.period === request.period)
      }
      const limit = request.limit ?? 50
      entries = entries.slice(0, limit)
      return { ok: true, value: Object.freeze(entries) }
    } catch (e) {
      this.trackError('listMemory', { code: 'LEDGER_ERROR', message: e instanceof Error ? e.message : String(e), featureCodeRef: 'memo:ledger' })
      return { ok: false, error: { code: 'ledger-error', message: e instanceof Error ? e.message : String(e) } }
    }
  }

  /**
   * The route facts every AI-related telemetry event carries.
   *
   * A failure event has always named the route it failed on, which left the
   * answer to "was this a route problem?" recoverable only from failures: a
   * successful call recorded no route at all, so a later analysis could not
   * say which route served the calls that worked, nor whether the route in
   * force had changed since a failure. Both halves are needed to compare, and
   * the route is already resolved by the time either is recorded.
   *
   * A resolved but empty route is recorded as an empty string: `''` means
   * nothing resolved, while an event that lacks the keys predates this and
   * genuinely did not record a route.
   *
   * @param route - the route the call used, or would have used.
   * @returns the provider and model to merge into an event's metadata.
   */
  private routeFacts(route: LlmRoute): { provider: string; model: string } {
    return { provider: route.provider, model: route.model }
  }

  /** Track one telemetry event for this plugin. */
  private track(action: string, result: 'success' | 'failure', metadata?: Record<string, unknown>): void {
    const input: { pluginId: string; action: string; result: 'success' | 'failure'; metadata?: Record<string, unknown> } = {
      pluginId: TELEMETRY_PLUGIN_ID, action, result,
    }
    if (metadata !== undefined) input.metadata = metadata
    this.ctx.get('telemetry')?.track(input)
  }

  /**
   * Track one telemetry failure for this plugin.
   * @param action - the feature that failed.
   * @param error - the failure code, message, and optional feature anchor.
   * @param metadata - extra structured context, such as the attempted route.
   */
  private trackError(
    action: string,
    error: { code: string; message: string; featureCodeRef?: string },
    metadata?: Record<string, unknown>,
  ): void {
    this.ctx.get('telemetry')?.trackError({
      pluginId: TELEMETRY_PLUGIN_ID,
      action,
      error,
      ...(metadata === undefined ? {} : { metadata }),
    })
  }

  /** Build a frozen failure result from code and message. */
  private failure<T extends MemoMemoFailure>(error: T): { ok: false; error: T } {
    return { ok: false, error: Object.freeze(error) }
  }

  /** Resolve the initialized durable table or fail a broken service lifecycle. */
  private requireTable(): KvTable<string, MemoWeekRow> {
    if (this.table === undefined) {
      throw new Error('memo: durable domain is not initialized')
    }
    return this.table
  }
}

/** Result type for readExternalPath (mirrors the pattern but named locally). */
type ReadExternalPathResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: MemoMemoFailure }

/**
 * Minimal shape of the DSH `llm` service this service needs in order to
 * enumerate routes and models. Declared structurally so nothing here depends on
 * the concrete service class, and typed `readonly` because the registry and its
 * catalogs are external data that must be copied rather than held.
 */
interface LlmModelCatalog {
  listProviders(): readonly { readonly id: string; readonly name: string }[]
  listModels(provider: string): Promise<readonly { readonly id: string; readonly name: string }[]>
}

/** Copy one stored week row into an owned, frozen {@link MemoWeek}. */
function snapshotWeek(row: MemoWeekRow): MemoWeek {
  return Object.freeze({
    weekId: row.weekId,
    weekStart: row.weekStart,
    weekEnd: row.weekEnd,
    entries: Object.freeze(row.entries.map(e => Object.freeze({ ...e }))),
    ...(row.analysis === undefined ? {} : { analysis: Object.freeze({ ...row.analysis }) }),
    updatedAt: row.updatedAt,
  })
}

export default MemoService
