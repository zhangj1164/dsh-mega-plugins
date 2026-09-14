/**
 * Pure presentation logic for the memo board: which cards belong to the
 * selected period, how cards are ordered, which week a new card lands in, and
 * how the last-viewed dimension survives a reload.
 *
 * Nothing here touches React, the RPC channel, or the DOM (beyond an optional
 * `Storage` object), so every rule the UI depends on is directly testable.
 *
 * @module dsh-client-ui-memo/client/logic
 */

import type { MemoAnalysisPeriod, MemoEntry, MemoWeek } from 'dsh-memo/client'

/** One memo card: an entry plus the week it is stored in. */
export interface MemoCard {
  /** Entry identity. */
  readonly id: string
  /** The ISO week id the entry is stored in. */
  readonly weekId: string
  /** Entry content. */
  readonly content: string
  /** Entry kind (`text` / `image` / `file`). */
  readonly type: string
  /** Epoch milliseconds when the entry was created. */
  readonly createdAt: number
  /** Epoch milliseconds when the entry was last updated. */
  readonly updatedAt: number
}

/** The dimension/label pair a board is showing. */
export interface MemoSelection {
  /** The active dimension. */
  readonly period: MemoAnalysisPeriod
  /** The period label inside that dimension. */
  readonly label: string
}

/** The four dimensions in display order. */
export const PERIODS: readonly MemoAnalysisPeriod[] = ['week', 'month', 'quarter', 'year']

/** Storage key for the last-viewed dimension. */
export const PERIOD_STORAGE_KEY = 'dsh-memo:period'

/** Storage key for the last-viewed period label. */
export const LABEL_STORAGE_KEY = 'dsh-memo:label'

/** Minimal storage face, so tests can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Flatten stored weeks into cards, newest first.
 * @param weeks - the stored weeks (any order).
 * @returns every entry as a card, newest first.
 */
export function toCards(weeks: readonly MemoWeek[]): MemoCard[] {
  const cards: MemoCard[] = []
  for (const week of weeks) {
    const entries: readonly MemoEntry[] = week.entries ?? []
    for (const entry of entries) {
      cards.push({
        id: entry.id,
        weekId: week.weekId,
        content: entry.content,
        type: entry.type,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })
    }
  }
  return cards.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}

/**
 * The cards shown for a period, newest first.
 *
 * Membership uses the host's period calendar through the week ids the host
 * already resolved, so the board cannot disagree with the timeline: the caller
 * passes the week ids of the selected period.
 *
 * @param cards - every card.
 * @param weekIds - the week ids belonging to the selected period.
 * @returns the matching cards, newest first.
 */
export function cardsInPeriod(cards: readonly MemoCard[], weekIds: readonly string[]): MemoCard[] {
  const allowed = new Set(weekIds)
  return cards.filter(card => allowed.has(card.weekId))
}

/**
 * The week a new card should be stored in for a selection.
 *
 * Prefers a week inside the selection so the card appears immediately where
 * the user is looking. Falls back to the current week when the selection is
 * empty (a past or future period), because the host refuses to invent a week
 * outside the current one.
 *
 * @param selection - the visible dimension and label.
 * @param weekIds - the week ids of the selection, ascending.
 * @param currentWeekId - the host's current ISO week id.
 * @returns the week id to store into, or `undefined` when nothing is known yet.
 */
export function targetWeekId(
  selection: MemoSelection,
  weekIds: readonly string[],
  currentWeekId: string | undefined,
): string | undefined {
  if (weekIds.includes(currentWeekId ?? '')) return currentWeekId
  const last = weekIds[weekIds.length - 1]
  if (last !== undefined) return last
  return currentWeekId
}

/**
 * A short, human-readable label for a period.
 * @param period - the dimension.
 * @param label - the canonical period label.
 * @returns the display label (e.g. `2026-W37`, `2026-09`, `2026-Q3`, `2026`).
 */
export function periodDisplay(period: MemoAnalysisPeriod, label: string): string {
  if (period === 'week') {
    const match = /^\d{4}-W(\d{2})$/u.exec(label)
    if (match !== null) return `W${match[1]}`
  }
  if (period === 'quarter') {
    const match = /^\d{4}-(Q[1-4])$/u.exec(label)
    if (match !== null) return `${label.slice(0, 4)} ${match[1]}`
  }
  return label
}

/**
 * Read the last-viewed selection, falling back to the given default.
 *
 * A stored dimension is only trusted when it names one of the four known
 * dimensions, and a stored label is only trusted when it matches that
 * dimension's format. Corrupt or stale storage therefore degrades to the
 * default instead of producing an empty board.
 *
 * @param storage - the storage to read from (usually `localStorage`).
 * @param fallback - the selection to use when nothing valid is stored.
 * @returns the restored selection.
 */
export function readSelection(storage: StorageLike | undefined, fallback: MemoSelection): MemoSelection {
  if (storage === undefined) return fallback
  try {
    const period = storage.getItem(PERIOD_STORAGE_KEY)
    const label = storage.getItem(LABEL_STORAGE_KEY)
    if (period === null || label === null) return fallback
    if (!PERIODS.includes(period as MemoAnalysisPeriod)) return fallback
    const dimension = period as MemoAnalysisPeriod
    if (!labelMatches(dimension, label)) return fallback
    return { period: dimension, label }
  } catch {
    return fallback
  }
}

/**
 * Persist the last-viewed selection.
 * @param storage - the storage to write to (usually `localStorage`).
 * @param selection - the selection to remember.
 */
export function writeSelection(storage: StorageLike | undefined, selection: MemoSelection): void {
  if (storage === undefined) return
  try {
    storage.setItem(PERIOD_STORAGE_KEY, selection.period)
    storage.setItem(LABEL_STORAGE_KEY, selection.label)
  } catch {
    // A full or blocked storage is not worth failing the board over.
  }
}

/** Per-dimension label formats, mirrored from the host's pinned formats. */
const LABEL_PATTERNS: Record<MemoAnalysisPeriod, RegExp> = {
  week: /^\d{4}-W\d{2}$/u,
  month: /^\d{4}-\d{2}$/u,
  quarter: /^\d{4}-Q[1-4]$/u,
  year: /^\d{4}$/u,
}

/**
 * Whether a label is well-formed for a dimension.
 * @param period - the dimension.
 * @param label - the candidate label.
 * @returns whether the label matches the dimension's format.
 */
export function labelMatches(period: MemoAnalysisPeriod, label: string): boolean {
  return LABEL_PATTERNS[period].test(label)
}

/**
 * Copy one card's content into a new card in the same period.
 *
 * The copy is a normal add: it goes through the same host call, so the new
 * card gets its own identity and timestamp and the original is untouched.
 *
 * @param content - the text to store.
 * @param suffix - text appended to make the copy visibly distinct.
 * @returns the content for the duplicated card.
 */
export function duplicateContent(content: string, suffix: string): string {
  return `${content}\n\n${suffix}`
}
