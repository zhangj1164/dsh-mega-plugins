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
import type { StreamChunk, GenerateOptions } from '@deepseek-ai/dsh-llm'
import { createUserMessage, type Message } from '@deepseek-ai/dsh-llm'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { TelemetryFailureGroup } from 'dsh-telemetry/types'
import { memoDomainSpec } from './spec.ts'
import type { MemoWeekRow } from './spec.ts'
import type {
  MemoAddEntryRequest,
  MemoAddEntryResult,
  MemoAnalyzeLogsRequest,
  MemoAnalyzeLogsResult,
  MemoAnalyzeRequest,
  MemoAnalyzeResult,
  MemoAnalysis,
  MemoAnalysisType,
  MemoDeleteEntryRequest,
  MemoDeleteEntryResult,
  MemoEntry,
  MemoExportReportRequest,
  MemoExportReportResult,
  MemoGetCurrentWeekRequest,
  MemoGetCurrentWeekResult,
  MemoGetWeekRequest,
  MemoGetWeekResult,
  MemoListWeeksRequest,
  MemoListWeeksResult,
  MemoLogAnalysisResult,
  MemoMemoFailure,
  MemoReadExternalPathRequest,
  MemoUpdateEntryRequest,
  MemoUpdateEntryResult,
  MemoWeek,
  MemoMemoryEntry,
  MemoLedger,
  MemoListMemoryRequest,
  MemoListMemoryResult,
} from './types.ts'

export type * from './types.ts'
export { memoDomainSpec, memoWeekSchema, memoEntrySchema, memoAnalysisSchema } from './spec.ts'
export type { MemoWeekRow } from './spec.ts'

/** Deployment configuration for the memo service. */
export interface Config {
  /**
   * The GitHub repository URL for the log-analysis prefill. The deployment
   * sets this to the memo plugin's GitHub project address.
   */
  readonly repoUrl: string
}

/** Schemastery configuration for the memo service. */
export const Config: s<Config> = s.object({
  repoUrl: s.string().default('https://github.com/zhangj1164/dsh-mega-plugins'),
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
 * Compute the ISO-8601 week id and range for a given date.
 * Monday is the start of the week; Sunday is the end.
 * @param date - the reference date (defaults to now).
 * @returns the week id, start, and end timestamps.
 */
function computeWeekBounds(date: Date = new Date()): { weekId: string; weekStart: number; weekEnd: number } {
  const dayOfWeek = date.getDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(date)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() + mondayOffset)
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  const year = monday.getFullYear()
  const thursday = new Date(monday)
  thursday.setDate(monday.getDate() + 3)
  const firstThursday = new Date(thursday.getFullYear(), 0, 4)
  const firstThursdayDay = firstThursday.getDay()
  const firstMonday = new Date(firstThursday)
  firstMonday.setDate(firstThursday.getDate() - (firstThursdayDay === 0 ? 6 : firstThursdayDay - 1))
  const weekNumber = Math.floor((thursday.getTime() - firstMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1
  const weekId = `${String(year)}-W${String(weekNumber).padStart(2, '0')}`
  return { weekId, weekStart: monday.getTime(), weekEnd: sunday.getTime() }
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
  private table?: KvTable<string, MemoWeekRow>

  /**
   * @param ctx - Host context carrying the storage-domain, telemetry, and github-issue services.
   * @param config - Validated deployment configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'memo')
    this.repoUrl = config.repoUrl
  }

  /** Open and own the one memo domain. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(memoDomainSpec)
    this.ctx.effect(() => async () => {
      await domain.close()
    }, 'memo.domainClose')
    this.table = domain.table('weeks')
  }

  /**
   * Get or create the current week's memo. If the current ISO week already
   * has a stored week, it is returned; otherwise a new empty week is created.
   * @param request - provider/model route stored for later AI calls (unused).
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
    const week: MemoWeekRow = existing === undefined
      ? { weekId: request.weekId, weekStart: 0, weekEnd: 0, entries: [entry], updatedAt: now }
      : { ...existing, entries: [...existing.entries, entry], updatedAt: now }
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
   * Analyze memo entries for a period using the configured model. The analysis
   * type controls the system prompt: 梳理 (organize), 总结 (summarize), 分析
   * (analyze).
   * @param request - period, label, analysis type, and model route.
   * @returns the analysis result.
   */
  @Remote('analyze')
  async analyze(request: MemoAnalyzeRequest): Promise<MemoAnalyzeResult> {
    const table = this.requireTable()
    const entries = this.collectEntries(table, request.period, request.periodLabel)
    if (entries.length === 0) {
      return this.failure({ code: 'no-entries', message: `no memo entries found for ${request.periodLabel}` })
    }
    const systemPrompt = ANALYSIS_PROMPTS[request.analysisType]
    const userText = entries.map(e => `- [${e.type}] ${e.content}`).join('\n')
    const body = await this.streamModelText(request.provider, request.model, systemPrompt, userText)
    if (body === undefined) {
      this.trackError('analyze', { code: 'LLM_FAILURE', message: 'model produced no output', featureCodeRef: 'memo:analyze' })
      return this.failure({ code: 'llm-failure', message: 'the model produced no output' })
    }
    const analysis: MemoAnalysis = {
      period: request.period,
      periodLabel: request.periodLabel,
      summary: body,
      generatedAt: Date.now(),
      modelProvider: request.provider,
      modelName: request.model,
    }
    this.track('analyze', 'success', { period: request.period, periodLabel: request.periodLabel, analysisType: request.analysisType })
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
   * @param request - period, label, and model route.
   * @returns the Markdown report.
   */
  @Remote('exportReport')
  async exportReport(request: MemoExportReportRequest): Promise<MemoExportReportResult> {
    const table = this.requireTable()
    const entries = this.collectEntries(table, request.period, request.periodLabel)
    if (entries.length === 0) {
      return this.failure({ code: 'no-entries', message: `no memo entries found for ${request.periodLabel}` })
    }
    const userText = entries.map(e => `- [${e.type}] ${e.content}`).join('\n')
    const body = await this.streamModelText(request.provider, request.model, REPORT_EXPORT_PROMPT, userText)
    if (body === undefined) {
      this.trackError('exportReport', { code: 'LLM_FAILURE', message: 'model produced no output', featureCodeRef: 'memo:exportReport' })
      return this.failure({ code: 'llm-failure', message: 'the model produced no output' })
    }
    this.track('exportReport', 'success', { period: request.period, periodLabel: request.periodLabel })
    return { ok: true, value: body }
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
      return this.failure({ code: 'llm-failure', message: 'the telemetry service is not available' })
    }
    const githubIssue = this.ctx.get('githubIssue')
    if (githubIssue === undefined) {
      return this.failure({ code: 'github-issue-failure', message: 'the github-issue service is not available' })
    }
    const pluginId = request.pluginId ?? TELEMETRY_PLUGIN_ID
    const analysis = telemetry.analyzeForPlugin(pluginId)
    const reportResult = await githubIssue.generateReport({
      pluginId,
      totalEvents: analysis.totalEvents,
      totalFailures: analysis.totalFailures,
      failureGroups: analysis.failureGroups.map((g: TelemetryFailureGroup) => ({
        featureCodeRef: g.featureCodeRef,
        count: g.count,
        ...(g.latest.error?.code !== undefined ? { errorCode: g.latest.error.code } : {}),
        ...(g.latest.error?.message !== undefined ? { errorMessage: g.latest.error.message } : {}),
      })),
      provider: request.provider,
      model: request.model,
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
        failureGroups: Object.freeze(analysis.failureGroups.map((g: { featureCodeRef: string; count: number; errorCodes: readonly string[] }) => ({
          featureCodeRef: g.featureCodeRef,
          count: g.count,
          errorCodes: Object.freeze(g.errorCodes),
        }))),
      }),
    })
    this.track('analyzeLogs', 'success', { pluginId })
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
   * Whether a week id matches a period label. Week periods match the full
   * weekId; month/quarter/year periods match a prefix.
   * @param weekId - the ISO week id.
   * @param period - the period kind.
   * @param periodLabel - the period label.
   * @returns whether the week belongs to the period.
   */
  private weekMatchesPeriod(weekId: string, period: string, periodLabel: string): boolean {
    if (period === 'week') return weekId === periodLabel
    if (period === 'month') return weekId.startsWith(periodLabel.slice(0, 5))
    if (period === 'quarter') return weekId.startsWith(periodLabel.slice(0, 5))
    if (period === 'year') return weekId.startsWith(periodLabel)
    return false
  }

  /**
   * Stream one model call and collect the text output.
   * @param provider - registered provider route.
   * @param model - model id.
   * @param system - system prompt text.
   * @param userText - user message text.
   * @returns the concatenated text, or `undefined` on empty or errored output.
   */
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

  private async streamModelText(provider: string, model: string, system: string, userText: string): Promise<string | undefined> {
    const llm = this.ctx.get('llm')
    if (llm === undefined) return undefined
    const message = createUserMessage({
      content: [{ type: 'text', text: userText }],
      source: { kind: 'user' },
    })
    const options: GenerateOptions = {
      provider,
      model,
      messages: [message as Message],
      system,
    }
    let text = ''
    for await (const chunk of llm.stream(options) as AsyncIterable<StreamChunk>) {
      if (chunk.type === 'text-delta') {
        text += chunk.text
      } else if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
        return undefined
      }
    }
    return text.length > 0 ? text : undefined
  }

  /** Track one telemetry event for this plugin. */
  private track(action: string, result: 'success' | 'failure', metadata?: Record<string, unknown>): void {
    const input: { pluginId: string; action: string; result: 'success' | 'failure'; metadata?: Record<string, unknown> } = {
      pluginId: TELEMETRY_PLUGIN_ID, action, result,
    }
    if (metadata !== undefined) input.metadata = metadata
    this.ctx.get('telemetry')?.track(input)
  }

  /** Track one telemetry error event for this plugin. */
  private trackError(action: string, error: { code: string; message: string; featureCodeRef?: string }): void {
    this.ctx.get('telemetry')?.trackError({ pluginId: TELEMETRY_PLUGIN_ID, action, error })
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
