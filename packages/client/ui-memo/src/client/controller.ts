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
  MemoArchivedQuarter,
  MemoEntry,
  MemoModelProvider,
  MemoPeriodEntry,
  MemoWeek,
} from 'dsh-memo/client'
import type { GithubIssueReport } from 'dsh-github-issue/client'
import {
  cardsInPeriod,
  readModelChoice,
  readSelection,
  selectableYears,
  toCards,
  targetWeekId,
  visiblePeriods,
  writeModelChoice,
  writeSelection,
  yearOf,
  type MemoCard,
  type MemoModelChoice,
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

/**
 * How many periods of each dimension the board fetches.
 *
 * The host clamps this to 400, and the board asks for all of it: the tag rule
 * and the year switcher are computed from this one timeline, so a shorter
 * window would silently hide years the switcher should offer. 400 weeks is
 * about 7.7 years, which is the whole history of a personal memo store.
 */
const PERIOD_HISTORY_LIMIT = 400

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
  /** Every period of the active dimension, newest first, unfiltered. */
  periods: MemoPeriodEntry[]
  /** The tags to render for the active dimension and year. */
  visiblePeriods: MemoPeriodEntry[]
  /** Years offered by the switcher, newest first. */
  years: readonly string[]
  /** The active year. */
  year: string
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
  /**
   * The week ids inside archived quarters, resolved by the host.
   *
   * A membership test, not a calendar: the host already decided which weeks a
   * quarter owns, so a card is read-only exactly when its own week id is in
   * here — which is what makes archiving hold across all four dimensions.
   */
  archivedWeekIds: ReadonlySet<string>
  /** The archived quarters themselves, oldest first. */
  archivedQuarters: readonly MemoArchivedQuarter[]
  /**
   * Provider route the next AI call would use, as the host resolved it.
   *
   * Read from the host rather than guessed: only the host knows which adapters
   * this deployment registered.
   */
  routeProvider: string
  /** Model the next AI call would use **without** an override, or `''`. */
  routeModel: string
  /**
   * Every provider route this deployment registered, in registration order.
   *
   * The whole registry, not just the resolved route: switching across providers
   * is the point, and only the host may say which providers exist.
   */
  providers: readonly MemoModelProvider[]
  /**
   * Why no provider could be listed, when the registry itself could not be read.
   *
   * Distinct from a provider that advertises nothing: this one says the list is
   * unknown rather than empty, so a remembered choice must survive it.
   */
  catalogError: string | undefined
  /**
   * The model this browser pinned, together with the provider it belongs to,
   * or `undefined` to follow the deployment's resolved route.
   */
  modelChoice: MemoModelChoice | undefined
  /** Provider of the model that produced {@link MemoViewState.analysis}. */
  analysisProvider: string
  /** Model that produced {@link MemoViewState.analysis}, or `''` when unknown. */
  analysisModel: string
  /** Whether a request is in flight. */
  busy: boolean
}

/** Options for constructing a controller. */
export interface MemoControllerOptions {
  /** The RPC caller from the connection service. */
  readonly rpc: RpcCaller
  /** Repository that receives issues created from the board. */
  readonly repoUrl: string
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
    visiblePeriods: [],
    years: [],
    year: '',
    cards: [],
    totalCards: 0,
    error: null,
    analysis: null,
    report: null,
    issueReport: null,
    logAnalysis: null,
    archivedWeekIds: new Set<string>(),
    archivedQuarters: [],
    routeProvider: '',
    routeModel: '',
    providers: [],
    catalogError: undefined,
    modelChoice: undefined,
    analysisProvider: '',
    analysisModel: '',
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
  private readonly repoUrl: string
  private readonly storage: StorageLike | undefined
  private readonly now: () => Date

  /**
   * @param options - the RPC caller plus optional storage and clock overrides.
   */
  constructor(options: MemoControllerOptions) {
    this.rpc = options.rpc
    this.repoUrl = options.repoUrl
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

      const archived = await this.readArchivedQuarters()
      const route = await this.readRoute()

      const fallbackLabel = periods[0]?.label ?? ''
      const restored = period === undefined
        ? readSelection(this.storage, { period: dimension, label: fallbackLabel })
        : { period: dimension, label: fallbackLabel }

      const cards = toCards(weeks)
      const currentYear = yearOf(fallbackLabel)
      const years = selectableYears(periods, cards, currentYear)
      // A tag only exists for a period with memos (plus the current period), so
      // a restored label is honoured only when its year offers a tag at all.
      const restoredYear = restored.label.length > 0 ? yearOf(restored.label) : ''
      const year = years.includes(restoredYear) ? restoredYear : (years[0] ?? '')
      const tags = visiblePeriods(periods, cards, year)
      // Restored-but-invisible (its memos were deleted) lands on the newest tag
      // of the same year rather than on a period the user cannot see or leave.
      const label = tags.some(entry => entry.label === restored.label)
        ? restored.label
        : (tags[0]?.label ?? fallbackLabel)
      const selection: MemoSelection = { period: dimension, label }

      const active = periods.find(entry => entry.label === label)
      this.set({
        status: 'ready',
        weeks,
        periods,
        visiblePeriods: tags,
        years,
        year,
        selection,
        cards: cardsInPeriod(cards, active?.weekIds ?? []),
        totalCards: cards.length,
        archivedWeekIds: archived.weekIds,
        archivedQuarters: archived.quarters,
        routeProvider: route.provider,
        routeModel: route.model,
        providers: route.providers,
        catalogError: route.catalogError,
        modelChoice: this.usableChoice(route),
        busy: false,
        // A board that cannot tell "archived" from "not archived" would let an
        // archived quarter be edited without any sign of why. Say so.
        error: archived.ok ? null : 'the archived quarters could not be read; cards are shown as editable',
      })
      writeSelection(this.storage, selection)
    } catch (e) {
      this.set({ status: 'error', error: describeError(e), busy: false })
    }
  }

  /**
   * Read the archived quarters and the week ids they cover.
   *
   * A failure here still reports no archive, because the archive is a read-only
   * overlay on the cards and a missing answer must never hide memos the user can
   * otherwise see. It is not silent, though: an archive that cannot be read is
   * indistinguishable from "nothing is archived", and that ambiguity once hid a
   * complete feature — 13 successful archives on the host, zero reads on the
   * client, and nothing on screen to say why. The caller surfaces a warning.
   *
   * @returns the archived quarters, the merged week ids, and whether the read
   * actually succeeded.
   */
  private async readArchivedQuarters(): Promise<{
    quarters: readonly MemoArchivedQuarter[]
    weekIds: ReadonlySet<string>
    ok: boolean
  }> {
    const result = await callMemo<readonly MemoArchivedQuarter[]>(this.rpc, 'listArchivedQuarters', {})
    if (!result.ok || !Array.isArray(result.value)) {
      return { quarters: [], weekIds: new Set<string>(), ok: false }
    }
    const quarters = result.value.map(entry => Object.freeze({
      label: entry.label,
      archivedAt: entry.archivedAt,
      weekIds: Object.freeze([...entry.weekIds]),
    }))
    const weekIds = new Set<string>()
    for (const quarter of quarters) for (const weekId of quarter.weekIds) weekIds.add(weekId)
    return { quarters: Object.freeze(quarters), weekIds, ok: true }
  }

  /**
   * Read the route the host would use by default, plus every route it can be
   * switched to.
   *
   * The registry comes from the host because a browser cannot enumerate
   * providers or their models, and it must never be hardcoded: only the
   * deployment knows which adapters it registered, and a guessed route surfaces
   * as an opaque failure. Every degradation yields an empty registry and a
   * reason, so the board stays usable without a model route.
   *
   * @returns the resolved route, every registered provider, and why the
   * registry is empty when it is.
   */
  private async readRoute(): Promise<{
    provider: string
    model: string
    providers: readonly MemoModelProvider[]
    catalogError: string | undefined
  }> {
    const result = await callMemo<{
      provider: string
      model: string
      providers: readonly MemoModelProvider[]
      catalogError?: string
    }>(this.rpc, 'listModels', {})
    if (!result.ok || result.value === null || typeof result.value !== 'object') {
      return { provider: '', model: '', providers: [], catalogError: 'the model catalog could not be read' }
    }
    const { provider, model, providers, catalogError } = result.value
    return {
      provider: typeof provider === 'string' ? provider : '',
      model: typeof model === 'string' ? model : '',
      providers: Array.isArray(providers)
        ? Object.freeze(providers.map(entry => Object.freeze({
            id: entry.id,
            name: entry.name,
            models: Array.isArray(entry.models)
              ? Object.freeze(entry.models.map(model => Object.freeze({ id: model.id, name: model.name })))
              : [],
            ...(entry.error === undefined ? {} : { error: entry.error }),
          })))
        : [],
      catalogError,
    }
  }

  /**
   * The remembered model choice, but only while it can still work.
   *
   * A choice names a provider this deployment registered, so it is dropped once
   * that provider is gone — a provider that was removed cannot serve anything,
   * and silently sending analysis to it would turn a deliberate choice into an
   * opaque failure. When the registry itself could not be read, the list is
   * *unknown* rather than empty, so the choice is kept: a transient read failure
   * must not erase the user's decision.
   *
   * @param route - the route and registry the host just reported.
   * @returns the choice to keep, or `undefined` to follow the resolved route.
   */
  private usableChoice(route: {
    providers: readonly MemoModelProvider[]
    catalogError: string | undefined
  }): MemoModelChoice | undefined {
    const stored = this._state.modelChoice ?? readModelChoice(this.storage)
    if (stored === undefined) return undefined
    const registryKnown = route.catalogError === undefined
    if (registryKnown && !route.providers.some(provider => provider.id === stored.provider)) {
      writeModelChoice(this.storage, undefined)
      return undefined
    }
    return stored
  }

  /**
   * Pin the provider and model the next AI calls use, or clear the pin.
   *
   * A choice names a provider the host reported, which is what keeps this from
   * being the old defect in a new place: the browser picks *from* the
   * deployment's registry rather than inventing a route. Clearing it restores
   * the deployment's own precedence (service `Config`, then
   * `agentDefaultModel`).
   *
   * @param choice - a provider and model the host reported, or `undefined` to
   * follow the resolved route again.
   * @returns whether the choice was recorded.
   */
  selectModel(choice: MemoModelChoice | undefined): boolean {
    if (choice !== undefined) {
      // Only a route the host just reported may be pinned. The point of that
      // rule is the defect this feature is built around: a browser that invents
      // a provider name produces NO_ADAPTER on every call, so a selection is
      // accepted only when it names something the deployment really registered.
      if (choice.provider.length === 0 || choice.model.length === 0) return false
      if (!this._state.providers.some(provider => provider.id === choice.provider)) return false
    }
    writeModelChoice(this.storage, choice)
    this.set({ modelChoice: choice })
    return true
  }

  /**
   * Archive the quarter the board is currently showing.
   *
   * Only a quarter dimension names a quarter, so this is a no-op anywhere else.
   * "The quarter containing the period you are looking at" has no single answer
   * — a year spans four, and a week's Monday can fall in the previous quarter
   * while the week belongs to the one holding its Thursday — so the archive
   * action is offered where the label is unambiguous and never guessed.
   *
   * @returns whether the quarter was archived.
   */
  async archiveCurrentQuarter(): Promise<boolean> {
    const { selection } = this._state
    if (selection.period !== 'quarter' || selection.label === '') return false
    this.set({ busy: true, error: null })
    try {
      const result = await callMemo<MemoArchivedQuarter>(this.rpc, 'archiveQuarter', { label: selection.label })
      if (!result.ok) {
        this.set({ busy: false, error: result.error.message })
        return false
      }
      const archived = await this.readArchivedQuarters()
      this.set({ busy: false, archivedWeekIds: archived.weekIds, archivedQuarters: archived.quarters })
      return true
    } catch (e) {
      this.set({ busy: false, error: describeError(e) })
      return false
    }
  }

  /**
   * Take a quarter out of the archive, restoring its cards to editable.
   * @param label - the quarter label to unarchive.
   * @returns whether the quarter was unarchived.
   */
  async unarchiveQuarter(label: string): Promise<boolean> {
    this.set({ busy: true, error: null })
    try {
      const result = await callMemo<{ label: string; archived: boolean }>(this.rpc, 'unarchiveQuarter', { label })
      if (!result.ok) {
        this.set({ busy: false, error: result.error.message })
        return false
      }
      const archived = await this.readArchivedQuarters()
      this.set({ busy: false, archivedWeekIds: archived.weekIds, archivedQuarters: archived.quarters })
      return true
    } catch (e) {
      this.set({ busy: false, error: describeError(e) })
      return false
    }
  }

  /**
   * Whether a card sits in an archived quarter and is therefore read-only.
   * @param card - the card to test.
   * @returns whether the card is archived.
   */
  isArchived(card: MemoCard): boolean {
    return this._state.archivedWeekIds.has(card.weekId)
  }

  /**
   * The archived quarter a card belongs to, so its action knows which label to
   * unarchive — a card only carries its week id, not its quarter.
   * @param card - the card to place.
   * @returns the owning archived quarter, or `undefined`.
   */
  archivedQuarterOf(card: MemoCard): MemoArchivedQuarter | undefined {
    return this._state.archivedQuarters.find(quarter => quarter.weekIds.includes(card.weekId))
  }

  /**
   * The archived quarter the board is currently showing, if any.
   * @returns the quarter label, or `undefined`.
   */
  archivedQuarterLabel(): string | undefined {
    const { selection } = this._state
    if (selection.period !== 'quarter') return undefined
    return this._state.archivedQuarters.some(quarter => quarter.label === selection.label)
      ? selection.label
      : undefined
  }

  /**
   * The archived quarter that owns the week a new card would be stored in.
   *
   * Unlike {@link archivedQuarterLabel}, this answers for every dimension: a
   * block on adding is a property of the target week, not of the tab the user
   * happens to be looking at, and the way out has to be offered wherever the
   * block appears.
   * @returns the owning archived quarter, or `undefined`.
   */
  targetArchivedQuarter(): MemoArchivedQuarter | undefined {
    const weekId = this.targetWeek
    if (weekId === undefined) return undefined
    return this._state.archivedQuarters.find(quarter => quarter.weekIds.includes(weekId))
  }

  /**
   * Whether adding a card to the active period would write into an archived
   * quarter, in which case the composer refuses to submit.
   * @returns whether the target week is archived.
   */
  get targetArchived(): boolean {
    const weekId = this.targetWeek
    return weekId !== undefined && this._state.archivedWeekIds.has(weekId)
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
   * Show another year of the active dimension.
   *
   * Every year the switcher offers holds at least one tag, so the switch always
   * lands somewhere visible. The whole timeline arrived with the dimension's
   * load, which is why this makes no host call.
   *
   * @param year - the year to show.
   */
  selectYear(year: string): void {
    if (year === this._state.year || !this._state.years.includes(year)) return
    const { selection, weeks, periods } = this._state
    const cards = toCards(weeks)
    const tags = visiblePeriods(periods, cards, year)
    // Keep the current tag when it belongs to this year; otherwise take the
    // newest tag of the year so the board always shows a real period.
    const label = tags.some(entry => entry.label === selection.label)
      ? selection.label
      : (tags[0]?.label ?? selection.label)
    const next: MemoSelection = { period: selection.period, label }
    const active = periods.find(entry => entry.label === label)
    this.set({
      year,
      visiblePeriods: tags,
      selection: next,
      cards: cardsInPeriod(cards, active?.weekIds ?? []),
      analysis: null,
      report: null,
      error: null,
    })
    writeSelection(this.storage, next)
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
    // The host refuses this too; refusing here as well keeps the reason in front
    // of the user instead of surfacing a raw failure code.
    if (this.targetArchived) {
      this.set({ error: 'the target quarter is archived; unarchive it before adding memos' })
      return false
    }
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
    // An archive can land while an edit dialog is open, so the guard belongs on
    // the write as well as on the button that opened it.
    if (this.isArchived(card)) {
      this.set({ error: 'this card is in an archived quarter; unarchive it before editing' })
      return false
    }
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
    if (this.isArchived(card)) {
      this.set({ error: 'this card is in an archived quarter; unarchive it before deleting' })
      return false
    }
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
   * The route to pin on the next AI calls.
   *
   * Both halves travel together: a model id means nothing outside the provider
   * that owns it. The choice is re-checked against the registry the host last
   * reported, so a provider that disappeared between two loads cannot be sent —
   * and when the registry is unknown rather than empty, the choice is trusted,
   * because a transient read failure must not silently change the route.
   *
   * @returns the chosen provider and model, or `undefined` to follow the host's
   * route.
   */
  private modelOverride(): MemoModelChoice | undefined {
    const choice = this._state.modelChoice
    if (choice === undefined) return undefined
    if (this._state.catalogError !== undefined) return choice
    if (!this._state.providers.some(provider => provider.id === choice.provider)) return undefined
    return choice
  }

  /**
   * Analyze the active period.
   * @param analysisType - organize (梳理), summarize (总结), or analyze (分析).
   */
  async analyze(analysisType: MemoAnalysisType): Promise<void> {
    this.set({ busy: true, error: null, analysis: null, analysisProvider: '', analysisModel: '' })
    try {
      const override = this.modelOverride()
      const result = await callMemo<{ summary: string; modelProvider?: string; modelName?: string }>(this.rpc, 'analyze', {
        period: this._state.selection.period,
        periodLabel: this._state.selection.label,
        analysisType,
        ...(override === undefined ? {} : { provider: override.provider, model: override.model }),
      })
      if (result.ok && result.value) {
        this.set({
          busy: false,
          analysis: result.value.summary,
          analysisProvider: result.value.modelProvider ?? '',
          analysisModel: result.value.modelName ?? '',
        })
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
      const override = this.modelOverride()
      const result = await callMemo<string>(this.rpc, 'exportReport', {
        period: this._state.selection.period,
        periodLabel: this._state.selection.label,
        ...(override === undefined ? {} : { provider: override.provider, model: override.model }),
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
   *
   * No route is sent unless the user chose one. `dsh-github-issue` resolves the
   * route the same way the memo service does — caller, then its `Config`, then
   * the deployment's `agentDefaultModel` — so the browser stays out of route
   * resolution entirely. The original defect this panel was built around was a
   * browser-supplied route no deployment registered, which surfaced as "the
   * model produced no output"; omitting the route here is deliberate.
   *
   * @param description - the raw description.
   */
  async optimizeIssue(description: string): Promise<void> {
    const trimmed = description.trim()
    if (!trimmed) return
    this.set({ busy: true, error: null, issueReport: null })
    try {
      const override = this.modelOverride()
      const result = await callGithubIssue<GithubIssueReport>(this.rpc, 'optimizeIssue', {
        description: trimmed,
        ...(override === undefined ? {} : { provider: override.provider, model: override.model }),
      })
      if (result.ok) {
        this.set({ busy: false, issueReport: result.value })
      } else {
        this.set({ busy: false, error: result.error.message })
      }
    } catch (e) {
      this.set({ busy: false, error: describeError(e) })
    }
  }

  /**
   * The pre-filled issue URL for the current optimized report.
   *
   * The github-issue service builds this URL rather than the board, because
   * that service owns the URL length limit: it shortens the body when GitHub
   * would refuse the request, and a client that composed the URL itself would
   * bypass that rule and reproduce the failure.
   *
   * @returns the URL, or `null` when there is no report or the service refused.
   */
  async issuePrefillUrl(): Promise<string | null> {
    const report = this._state.issueReport
    if (report === null) return null
    try {
      const result = await callGithubIssue<string>(this.rpc, 'prefilledIssueUrl', {
        repoUrl: this.repoUrl,
        report,
      })
      if (result.ok) return result.value
      this.set({ error: result.error.message })
      return null
    } catch (e) {
      this.set({ error: describeError(e) })
      return null
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

  /**
   * Dismiss the analysis result.
   *
   * Results are view state rather than stored data, so closing a result card is
   * a local clear and never touches the host.
   */
  clearAnalysis(): void {
    this.set({ analysis: null })
  }

  /** Dismiss the exported report. */
  clearReport(): void {
    this.set({ report: null })
  }

  /** Dismiss the log analysis result. */
  clearLogAnalysis(): void {
    this.set({ logAnalysis: null })
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
