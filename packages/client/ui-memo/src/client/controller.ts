/**
 * Browser-local controller for the memo panel. Calls Host Remote methods
 * through the Connection RPC channel (no generated TYPERT_REMOTE descriptor
 * required). Publishes immutable views through a subscribe/getSnapshot pair.
 *
 * ## Cross-package references (supplement 1)
 *
 * The controller calls **two** Host services through the same RPC channel:
 *
 * - `memo/*` — the memo service (dsh-memo), which itself depends on
 *   dsh-telemetry and dsh-github-issue internally for log analysis.
 * - `githubIssue/*` — the GitHub-issue service (dsh-github-issue), called
 *   directly from the client for the "Add Issue" editor (req 11) and the
 *   pre-fill URL (req 9). This is the direct cross-package reference that
 *   supplement 1 asks about: ui-memo declares dsh-github-issue as a
 *   workspace peer and imports its client types.
 *
 * ## Wire shape
 *
 * The Connection RPC channel returns the transport envelope:
 * `{ ok: true, value: <businessResult> }`.
 *
 * Each Remote method returns its own business result:
 * `{ ok: true, value: MemoWeek | MemoWeek[] | MemoAnalysis | string }`.
 *
 * So the full wire shape after `rpc.call()` is:
 * ```
 * { ok: true, value: { ok: true, value: MemoWeek } }
 *          ^transport              ^business
 * ```
 *
 * `callRemote` unwraps the transport envelope and returns the business result.
 * The controller then reads `.value` from the business result.
 *
 * Each Remote method's single parameter is named `request` in the typert
 * descriptor, so all args are passed as `{ request: { ...fields } }`.
 *
 * @module dsh-client-ui-memo/client/controller
 */

import type { MemoWeek, MemoAnalysisType, MemoAnalysisPeriod, MemoEntry } from 'dsh-memo/client'
import type { GithubIssueReport } from 'dsh-github-issue/client'

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
const PROVIDER = 'custom'
const MODEL = 'glm-5-2-260617'

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
    return { ok: false, error: { code: 'rpc-failure', message: e instanceof Error ? e.message : String(e) } }
  }
}

/**
 * Call one memo Remote method (convenience wrapper for backward compatibility).
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
 * Call one githubIssue Remote method (direct cross-package reference).
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

export interface MemoViewState {
  status: 'cold' | 'loading' | 'ready' | 'error'
  weeks: MemoWeek[]
  /** Currently selected week index (0 = newest). */
  selectedWeekIndex: number
  error: string | null
  analysis: string | null
  report: string | null
  /** Optimized issue report from the "Add Issue" editor (req 11). */
  issueReport: GithubIssueReport | null
  /** Log analysis result with prefill URL (req 8, 9). */
  logAnalysis: { report: GithubIssueReport; issueUrl: string } | null
  busy: boolean
}

export function createInitialState(): MemoViewState {
  return {
    status: 'cold',
    weeks: [],
    selectedWeekIndex: 0,
    error: null,
    analysis: null,
    report: null,
    issueReport: null,
    logAnalysis: null,
    busy: false,
  }
}

// ── Controller ─────────────────────────────────────────────────────────────

export class MemoController {
  private _state: MemoViewState = createInitialState()
  private listeners = new Set<() => void>()
  private disposed = false

  constructor(private readonly rpc: RpcCaller) {}

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

  /** The currently selected week (defaults to the newest). */
  get currentWeek(): MemoWeek | undefined {
    return this._state.weeks[this._state.selectedWeekIndex]
  }

  /** Select a different week from the list (req 3: view history). */
  selectWeek(index: number): void {
    if (index < 0 || index >= this._state.weeks.length) return
    this.set({ selectedWeekIndex: index, analysis: null, report: null })
  }

  async refresh(): Promise<void> {
    this.set({ status: 'loading', error: null })
    try {
      const r = await callMemo<readonly MemoWeek[]>(this.rpc, 'listWeeks', {})
      if (r.ok) {
        const weeks = Array.isArray(r.value) ? [...r.value] : []
        this.set({ status: 'ready', weeks, busy: false })
      } else {
        this.set({ status: 'error', error: r.error.message, busy: false })
      }
    } catch (e) {
      this.set({ status: 'error', error: e instanceof Error ? e.message : String(e), busy: false })
    }
  }

  async addEntry(content: string): Promise<void> {
    if (!content.trim()) return
    this.set({ busy: true, error: null })
    try {
      const wk = await callMemo<MemoWeek>(this.rpc, 'getOrCreateCurrentWeek', {})
      if (!wk.ok) { this.set({ busy: false, error: wk.error.message }); return }

      const week = wk.value
      if (!week?.weekId) { this.set({ busy: false, error: 'getOrCreateCurrentWeek: missing weekId' }); return }

      const add = await callMemo<MemoEntry>(this.rpc, 'addEntry', { weekId: week.weekId, type: 'text', content: content.trim() })
      if (add.ok) {
        await this.refresh()
      } else {
        this.set({ busy: false, error: add.error.message })
      }
    } catch (e) {
      this.set({ busy: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  /**
   * Update an entry's content. If the week is not the current week, the
   * backend requires force=true (req 3: past-week force gate). The controller
   * passes force through so the UI can prompt the user.
   * @param weekId - the week containing the entry.
   * @param entryId - the entry to update.
   * @param content - the new content.
   * @param force - must be true for past weeks (acknowledges stale analysis).
   */
  async updateEntry(weekId: string, entryId: string, content: string, force: boolean): Promise<boolean> {
    if (!content.trim()) return false
    this.set({ busy: true, error: null })
    try {
      const r = await callMemo<MemoEntry>(this.rpc, 'updateEntry', { weekId, entryId, content: content.trim(), force })
      if (r.ok) {
        await this.refresh()
        return true
      }
      this.set({ busy: false, error: r.error.message })
      return false
    } catch (e) {
      this.set({ busy: false, error: e instanceof Error ? e.message : String(e) })
      return false
    }
  }

  /**
   * Delete an entry from a week. Past weeks require force=true (req 3).
   * @param weekId - the week containing the entry.
   * @param entryId - the entry to delete.
   * @param force - must be true for past weeks.
   */
  async deleteEntry(weekId: string, entryId: string, force: boolean): Promise<boolean> {
    this.set({ busy: true, error: null })
    try {
      const r = await callMemo<boolean>(this.rpc, 'deleteEntry', { weekId, entryId, force })
      if (r.ok) {
        await this.refresh()
        return true
      }
      this.set({ busy: false, error: r.error.message })
      return false
    } catch (e) {
      this.set({ busy: false, error: e instanceof Error ? e.message : String(e) })
      return false
    }
  }

  /**
   * Analyze memo entries for the selected week or a broader period (req 4).
   * @param analysisType - 梳理 (organize), 总结 (summarize), or 分析 (analyze).
   * @param period - the analysis period (week/month/quarter/year).
   */
  async analyze(analysisType: MemoAnalysisType, period: MemoAnalysisPeriod = 'week'): Promise<void> {
    this.set({ busy: true, error: null, analysis: null })
    try {
      const cw = this.currentWeek
      if (!cw) { this.set({ busy: false, error: 'No week selected' }); return }

      const r = await callMemo<{ summary: string }>(this.rpc, 'analyze', {
        period,
        periodLabel: cw.weekId,
        analysisType,
        provider: PROVIDER,
        model: MODEL,
      })
      if (r.ok && r.value) {
        this.set({ busy: false, analysis: r.value.summary })
      } else {
        this.set({ busy: false, error: r.error.message })
      }
    } catch (e) {
      this.set({ busy: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  /**
   * Export a work report as Markdown and trigger a .md file download (req 6).
   * @param period - the report period (week/month/quarter/year).
   */
  async exportReport(period: MemoAnalysisPeriod = 'week'): Promise<void> {
    this.set({ busy: true, error: null, report: null })
    try {
      const cw = this.currentWeek
      if (!cw) { this.set({ busy: false, error: 'No week selected' }); return }

      const r = await callMemo<string>(this.rpc, 'exportReport', {
        period,
        periodLabel: cw.weekId,
        provider: PROVIDER,
        model: MODEL,
      })
      if (r.ok) {
        this.set({ busy: false, report: r.value })
        downloadMarkdown(r.value, `memo-report-${cw.weekId}.md`)
      } else {
        this.set({ busy: false, error: r.error.message })
      }
    } catch (e) {
      this.set({ busy: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  /**
   * Optimize a natural-language issue description into a structured GitHub
   * issue report (req 11). Calls the githubIssue service directly — this is
   * the cross-package reference that supplement 1 asks about.
   * @param description - the user's raw natural-language description.
   */
  async optimizeIssue(description: string): Promise<void> {
    if (!description.trim()) return
    this.set({ busy: true, error: null, issueReport: null })
    try {
      const r = await callGithubIssue<GithubIssueReport>(this.rpc, 'optimizeIssue', {
        description: description.trim(),
        provider: PROVIDER,
        model: MODEL,
      })
      if (r.ok) {
        this.set({ busy: false, issueReport: r.value })
      } else {
        this.set({ busy: false, error: r.error.message })
      }
    } catch (e) {
      this.set({ busy: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  /**
   * Analyze telemetry logs for the memo plugin and generate a GitHub issue
   * report with a pre-filled issue-creation URL (req 8, 9). Calls the memo
   * service's analyzeLogs method, which internally uses dsh-telemetry and
   * dsh-github-issue.
   */
  async analyzeLogs(): Promise<void> {
    this.set({ busy: true, error: null, logAnalysis: null })
    try {
      const r = await callMemo<{ report: GithubIssueReport; issueUrl: string }>(this.rpc, 'analyzeLogs', {
        provider: PROVIDER,
        model: MODEL,
      })
      if (r.ok && r.value) {
        this.set({ busy: false, logAnalysis: r.value })
      } else {
        this.set({ busy: false, error: r.error.message })
      }
    } catch (e) {
      this.set({ busy: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Open a URL in a new tab (req 9: jump to GitHub pre-filled issue page). */
  openUrl(url: string): void {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
  }

  dispose(): void { this.disposed = true; this.listeners.clear() }
}

// ── Utilities ──────────────────────────────────────────────────────────────

/**
 * Trigger a Markdown file download in the browser (req 6: export as .md).
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

// ── Export types for tests ─────────────────────────────────────────────────

export type { TransportEnvelope, BusinessResult, MemoWeek, MemoAnalysisType, MemoAnalysisPeriod, MemoEntry, GithubIssueReport }
