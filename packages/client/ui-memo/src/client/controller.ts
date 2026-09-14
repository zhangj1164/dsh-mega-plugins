/**
 * Browser-local controller for the memo board. Calls Host Remote methods over
 * the Connection RPC channel (no generated TYPERT_REMOTE descriptor needed)
 * and publishes immutable views through a subscribe/getSnapshot pair.
 *
 * ## What the controller deliberately does not do
 *
 * It does not choose a model route. `provider`/`model` are absent from every
 * request here: the host service resolves the route from its own `Config` or
 * from the deployment's `agentDefaultModel`. Hardcoding them in the browser
 * was the original defect: the browser cannot know which adapters a
 * deployment has registered, and a wrong guess surfaces as an opaque failure.
 *
 * It also does not compute which weeks a period contains. The host's
 * `listPeriods` returns each period with its week ids, so the board and the
 * timeline share one calendar instead of two that can drift apart.
 *
 * ## Wire shape
 *
 * `rpc.call` returns the transport envelope `{ ok, value }`. Each Remote
 * method returns its own business result `{ ok, value | error }`, so the full
 * shape is `{ ok, value: { ok, value } }`. `callRemote` unwraps the transport
 * envelope and the caller reads `.value` from the business result.
 *
 * Each Remote method's single parameter is named `request`, so arguments are
 * always passed as `{ args: { request } }`.
 *
 * @module dsh-client-ui-memo/client/controller
 */

import type {
  MemoAnalysisPeriod,
  MemoAnalysisType,
  MemoEntry,
  MemoPeriodEntry,
  MemoWeek,
} from 'dsh-memo/client'
import type { GithubIssueReport } from 'dsh-github-issue/client'
import {
  cardsInPeriod,
  readSelection,
  toCards,
  targetWeekId,
  writeSelection,
  type MemoCard,
  type MemoSelection,
  type StorageLike,
} from './logic.ts'

// ── RPC types ──────────────────────────────────────────────────────────────

/** Transport envelope returned by `rpc.call`. */
interface TransportEnvelope<T> { ok: boolean; value?: T; error?: { code: string; message: string } }

/** Business result from Remote methods. */
type BusinessResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** Minimal RPC caller interface (matches ConnectionHandle.rpc). */
export interface RpcCaller {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

const API_CHANNEL = '/api'

/** How many periods of each dimension the board offers as history. */
const PERIOD_HISTORY_LIMIT = 24

/**
 * Call one Remote method on any service, unwrapping the transport envelope.
 * @param rpc - the RPC caller.
 * @param service - the service key (e.g. `'memo'` or `'githubIssue'`).
 * @param method - the Remote method name.
 * @param request - the request payload.
 * @returns the business result `{ ok, value | error }`.
 */
export async function callRemote<T>(
  rpc: RpcCaller,
  service: string,
  method: string,
  request: Record<string, unknown>,
): Promise<BusinessResult<T>> {
  try {
    const envelope = await rpc.call(API_CHANNEL, `${service}/${method}`, { args: { request } }) as TransportEnvelope<BusinessResult<T>>
    if (envelope.ok && envelope.value !== undefined) {
      return envelope.value
    }
    return { ok: false, error: envelope.error ?? { code: 'transport-failure', message: 'unknown transport error' } }
  } catch (e) {
    return { ok: false, error: { code: 'rpc-failure', message: describeError(e) } }
  }
}

/**
 * Call one memo Remote method.
 * @param rpc - the RPC caller.
 * @param method - the Remote method name.
 * @param request - the request payload.
 * @returns the business result `{ ok, value | error }`.
 */
export async function callMemo<T>(
  rpc: RpcCaller,
  method: string,
  request: Record<string, unknown>,
): Promise<BusinessResult<T>> {
  return callRemote<T>(rpc, 'memo', method, request)
}

/**
 * Call one githubIssue Remote method (the cross-package reference the memo
 * issue editor depends on).
 * @param rpc - the RPC caller.
 * @param method - the Remote method name.
 * @param request - the request payload.
 * @returns the business result `{ ok, value | error }`.
 */
export async function callGithubIssue<T>(
  rpc: RpcCaller,
  method: string,
  request: Record<string, unknown>,
): Promise<BusinessResult<T>> {
  return callRemote<T>(rpc, 'githubIssue', method, request)
}

// ── View state ─────────────────────────────────────────────────────────────

/** Published view state of the memo board. */
export interface MemoViewState {
  /** Load lifecycle of the board data. */
  status: 'cold' | 'loading' | 'ready' | 'error'
  /** Every stored week, newest first. */
  weeks: MemoWeek[]
  /** The active dimension and label. */
  selection: MemoSelection
  /** Navigable periods of the active dimension, newest first. */
  periods: MemoPeriodEntry[]
  /** Cards in the active period, newest first. */
  cards: MemoCard[]
  /** Total number of stored cards, so the UI can distinguish "empty" from "all gone". */
  totalCards: number
  /** Last error message, or `null`. */
  error: string | null
  /** AI analysis text for the active period. */
  analysis: string | null
  /** Exported Markdown report. */
  report: string | null
  /** Optimized issue report from the issue editor. */
  issueReport: GithubIssueReport | null
  /** Log-analysis report plus its pre-filled issue URL. */
  logAnalysis: { report: GithubIssueReport; issueUrl: string } | null
  /** Whether a request is in flight. */
  busy: boolean
}

/** Options for constructing a controller. */
export interface MemoControllerOptions {
  /** The RPC caller from the connection service. */
  readonly rpc: RpcCaller
  /** Storage for the last-viewed selection. Defaults to `localStorage`. */
  readonly storage?: StorageLike | undefined
  /** Injectable clock, so period defaults are testable. */
  readonly now?: (() => Date) | undefined
}

/** Create the initial view state. */
export function createInitialState(): MemoViewState {
  return {
    status: 'cold',
    weeks: [],
    selection: { period: 'week', label: '' },
    periods: [],
    cards: [],
    totalCards: 0,
    error: null,
    analysis: null,
    report: null,
    issueReport: null,
    logAnalysis: null,
    busy: false,
  }
}

// ── Controller ─────────────────────────────────────────────────────────────

/** Drives the memo board: data loading, period navigation, and card edits. */
export class MemoController {
  private _state: MemoViewState = createInitialState()
  private listeners = new Set<() => void>()
  private disposed = false
  private readonly rpc: RpcCaller
  private readonly storage: StorageLike | undefined
  private readonly now: () => Date

  /**
   * @param options - the RPC caller plus optional storage and clock overrides.
   */
  constructor(options: MemoControllerOptions) {
    this.rpc = options.rpc
    this.storage = options.storage ?? defaultStorage()
    this.now = options.now ?? (() => new Date())
  }

  getSnapshot = (): MemoViewState => this._state

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private emit(): void {
    if (this.disposed) return
    for (const fn of this.listeners) fn()
  }

  private set(patch: Partial<MemoViewState>): void {
    this._state = { ...this._state, ...patch }
    this.emit()
  }

  /** The week a new card would be stored in for the active selection. */
  get targetWeek(): string | undefined {
    const weekIds = this._state.periods.find(entry => entry.label === this._state.selection.label)?.weekIds ?? []
    return targetWeekId(this._state.selection, weekIds, this._state.weeks[0]?.weekId)
  }

  /** The period entry for the active selection, when the host listed it. */
  get activePeriod(): MemoPeriodEntry | undefined {
    return this._state.periods.find(entry => entry.label === this._state.selection.label)
  }

  /**
   * Load weeks, the timeline of the active dimension, and recompute the cards.
   *
   * The selection defaults to the host's current period of that dimension and
   * is restored from storage when a previous selection is still valid.
   *
   * @param period - optional dimension to switch to before loading.
   */
  async refresh(period?: MemoAnalysisPeriod): Promise<void> {
    const dimension = period ?? this._state.selection.period
    this.set({ status: 'loading', error: null, selection: { ...this._state.selection, period: dimension } })
    try {
      const weeksResult = await callMemo<readonly MemoWeek[]>(this.rpc, 'listWeeks', {})
      if (!weeksResult.ok) {
        this.set({ status: 'error', error: weeksResult.error.message, busy: false })
        return
      }
      const weeks = Array.isArray(weeksResult.value) ? [...weeksResult.value] : []

      const periodsResult = await callMemo<readonly MemoPeriodEntry[]>(this.rpc, 'listPeriods', {
        period: dimension,
        limit: PERIOD_HISTORY_LIMIT,
      })
      const periods = periodsResult.ok && Array.isArray(periodsResult.value) ? [...periodsResult.value] : []
      if (!periodsResult.ok) {
        this.set({ status: 'error', error: periodsResult.error.message, busy: false })
        return
      }

      const fallbackLabel = periods[0]?.label ?? ''
      const restored = period === undefined
        ? readSelection(this.storage, { period: dimension, label: fallbackLabel })
        : { period: dimension, label: fallbackLabel }
      const label = periods.some(entry => entry.label === restored.label) ? restored.label : fallbackLabel
      const selection: MemoSelection = { period: dimension, label }

      const cards = toCards(weeks)
      const active = periods.find(entry => entry.label === label)
      this.set({
        status: 'ready',
        weeks,
        periods,
        selection,
        cards: cardsInPeriod(cards, active?.weekIds ?? []),
        totalCards: cards.length,
        busy: false,
        error: null,
      })
      writeSelection(this.storage, selection)
    } catch (e) {
      this.set({ status: 'error', error: describeError(e), busy: false })
    }
  }

  /**
   * Switch the active dimension, keeping the host's current period for it.
   * @param period - the dimension to show.
   */
  async selectPeriod(period: MemoAnalysisPeriod): Promise<void> {
    if (period === this._state.selection.period) return
    this.set({ analysis: null, report: null })
    await this.refresh(period)
  }

  /**
   * Show another period of the active dimension.
   * @param label - the period label to select.
   */
  async selectLabel(label: string): Promise<void> {
    if (label === this._state.selection.label) return
    const selection: MemoSelection = { period: this._state.selection.period, label }
    const active = this._state.periods.find(entry => entry.label === label)
    const cards = toCards(this._state.weeks)
    this.set({
      selection,
      cards: cardsInPeriod(cards, active?.weekIds ?? []),
      analysis: null,
      report: null,
      error: null,
    })
    writeSelection(this.storage, selection)
  }

  /**
   * Add a card to the active period.
   * @param content - the card text.
   * @returns whether the card was stored.
   */
  async addCard(content: string): Promise<boolean> {
    const trimmed = content.trim()
    if (!trimmed) return false
    this.set({ busy: true, error: null })
    try {
      const weekId = this.targetWeek
      if (weekId === undefined) {
        this.set({ busy: false, error: 'no target week for the selected period' })
        return false
      }
      const result = await callMemo<MemoEntry>(this.rpc, 'addEntry', { weekId, type: 'text', content: trimmed })
      if (!result.ok) {
        this.set({ busy: false, error: result.error.message })
        return false
      }
      await this.refresh()
      return true
    } catch (e) {
      this.set({ busy: false, error: describeError(e) })
      return false
    }
  }

  /**
   * Update a card's content.
   * @param card - the card to update.
   * @param content - the new text.
   * @returns whether the update succeeded.
   */
  async updateCard(card: MemoCard, content: string): Promise<boolean> {
    const trimmed = content.trim()
    if (!trimmed) return false
    this.set({ busy: true, error: null })
    try {
      const result = await callMemo<MemoEntry>(this.rpc, 'updateEntry', {
        weekId: card.weekId,
        entryId: card.id,
        content: trimmed,
        force: true,
      })
      if (!result.ok) {
        this.set({ busy: false, error: result.error.message })
        return false
      }
      await this.refresh()
      return true
    } catch (e) {
      this.set({ busy: false, error: describeError(e) })
      return false
    }
  }

  /**
   * Duplicate a card into the same period.
   * @param card - the card to copy.
   * @param suffix - text appended so the copy is visibly distinct.
   * @returns whether the copy was stored.
   */
  async duplicateCard(card: MemoCard, suffix: string): Promise<boolean> {
    return this.addCard(duplicateText(card.content, suffix))
  }

  /**
   * Delete a card.
   * @param card - the card to delete.
   * @returns whether the delete succeeded.
   */
  async deleteCard(card: MemoCard): Promise<boolean> {
    this.set({ busy: true, error: null })
    try {
      const result = await callMemo<boolean>(this.rpc, 'deleteEntry', {
        weekId: card.weekId,
        entryId: card.id,
        force: true,
      })
      if (!result.ok) {
        this.set({ busy: false, error: result.error.message })
        return false
      }
      await this.refresh()
      return true
    } catch (e) {
      this.set({ busy: false, error: describeError(e) })
      return false
    }
  }

  /**
   * Analyze the active period.
   * @param analysisType - organize (梳理), summarize (总结), or analyze (分析).
   */
  async analyze(analysisType: MemoAnalysisType): Promise<void> {
    this.set({ busy: true, error: null, analysis: null })
    try {
      const result = await callMemo<{ summary: string }>(this.rpc, 'analyze', {
        period: this._state.selection.period,
        periodLabel: this._state.selection.label,
        analysisType,
      })
      if (result.ok && result.value) {
        this.set({ busy: false, analysis: result.value.summary })
      } else {
        this.set({ busy: false, error: result.ok ? 'analysis returned no text' : result.error.message })
      }
    } catch (e) {
      this.set({ busy: false, error: describeError(e) })
    }
  }

  /**
   * Export a Markdown report for the active period and download it.
   * @returns the report text, or `undefined` on failure.
   */
  async exportReport(): Promise<string | undefined> {
    this.set({ busy: true, error: null, report: null })
    try {
      const result = await callMemo<string>(this.rpc, 'exportReport', {
        period: this._state.selection.period,
        periodLabel: this._state.selection.label,
      })
      if (!result.ok) {
        this.set({ busy: false, error: result.error.message })
        return undefined
      }
      this.set({ busy: false, report: result.value })
      downloadMarkdown(result.value, `memo-report-${this._state.selection.label}.md`)
      return result.value
    } catch (e) {
      this.set({ busy: false, error: describeError(e) })
      return undefined
    }
  }

  /**
   * Optimize a natural-language description into a GitHub issue report.
   * @param description - the raw description.
   */
  async optimizeIssue(description: string): Promise<void> {
    const trimmed = description.trim()
    if (!trimmed) return
    this.set({ busy: true, error: null, issueReport: null })
    try {
      const result = await callGithubIssue<GithubIssueReport>(this.rpc, 'optimizeIssue', { description: trimmed })
      if (result.ok) {
        this.set({ busy: false, issueReport: result.value })
      } else {
        this.set({ busy: false, error: result.error.message })
      }
    } catch (e) {
      this.set({ busy: false, error: describeError(e) })
    }
  }

  /** Analyze this plugin's telemetry failures and build a pre-filled issue. */
  async analyzeLogs(): Promise<void> {
    this.set({ busy: true, error: null, logAnalysis: null })
    try {
      const result = await callMemo<{ report: GithubIssueReport; issueUrl: string }>(this.rpc, 'analyzeLogs', {})
      if (result.ok && result.value) {
        this.set({ busy: false, logAnalysis: result.value })
      } else {
        this.set({ busy: false, error: result.ok ? 'log analysis returned no report' : result.error.message })
      }
    } catch (e) {
      this.set({ busy: false, error: describeError(e) })
    }
  }

  /** Clear the last error. */
  clearError(): void {
    this.set({ error: null })
  }

  /** Stop publishing state. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }
}

/** The browser's localStorage, when the environment provides one. */
function defaultStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/**
 * Render a thrown value as a message for the error banner.
 * @param error - the thrown value.
 * @returns a human-readable description.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Append a suffix that marks a duplicated card as a copy. */
function duplicateText(content: string, suffix: string): string {
  return `${content}\n\n${suffix}`
}

/**
 * Trigger a Markdown file download in the browser.
 * @param content - the Markdown text.
 * @param filename - the download filename.
 */
export function downloadMarkdown(content: string, filename: string): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export type { TransportEnvelope, BusinessResult, MemoWeek, MemoAnalysisType, MemoAnalysisPeriod, MemoEntry, GithubIssueReport, MemoPeriodEntry, MemoCard, MemoSelection }
