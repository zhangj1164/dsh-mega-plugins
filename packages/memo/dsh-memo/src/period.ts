/**
 * Pure period calendar math for the memo domain: ISO-8601 weeks, months,
 * quarters, and years, with no storage, context, or model dependency.
 *
 * The memo UI navigates four dimensions and must agree with the host on which
 * cards belong to a period. Keeping that math in one exported module is what
 * makes the agreement testable: a card stored under a week must be reachable
 * from the week, the month, the quarter, and the year it falls in.
 *
 * Period labels are pinned so stored data stays readable:
 *
 * | Dimension | Label       | Example     |
 * |---|---|---|
 * | week      | `YYYY-Www`  | `2026-W36`  |
 * | month     | `YYYY-MM`   | `2026-09`   |
 * | quarter   | `YYYY-Qn`   | `2026-Q3`   |
 * | year      | `YYYY`      | `2026`      |
 *
 * @module dsh-memo/period
 */

import type { MemoAnalysisPeriod } from './types.ts'

/** Milliseconds in one day. */
const DAY_MS = 24 * 60 * 60 * 1000

/** Local midnight of the day containing `date`. */
function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

/**
 * The Monday 00:00 local time of the ISO week containing `date`.
 * @param date - the reference date.
 * @returns the week's Monday at local midnight.
 */
export function startOfIsoWeek(date: Date = new Date()): Date {
  const day = date.getDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const offset = day === 0 ? -6 : 1 - day
  const monday = startOfDay(date)
  monday.setDate(monday.getDate() + offset)
  return monday
}

/**
 * The ISO-8601 week-year and week number of a date.
 *
 * The week-year is the calendar year of the week's Thursday: a week belongs
 * to the year that owns its Thursday, which is why `2025-12-29` is
 * `2026-W01`. Reading the Monday's calendar year instead is the classic
 * off-by-one-year bug at every year boundary.
 *
 * @param date - the reference date.
 * @returns the week-year and the 1-based week number.
 */
export function isoWeekParts(date: Date = new Date()): { weekYear: number; week: number } {
  const monday = startOfIsoWeek(date)
  const thursday = new Date(monday)
  thursday.setDate(monday.getDate() + 3)
  const weekYear = thursday.getFullYear()
  // The Monday of week 1 is the Monday of the ISO week containing Jan 4th.
  const jan4 = new Date(weekYear, 0, 4)
  const firstMonday = startOfIsoWeek(jan4)
  const week = Math.round((monday.getTime() - firstMonday.getTime()) / (7 * DAY_MS)) + 1
  return { weekYear, week }
}

/**
 * The period label for a date in a given dimension.
 * @param period - the dimension.
 * @param date - the reference date.
 * @returns the canonical period label.
 */
export function periodLabelFor(period: MemoAnalysisPeriod, date: Date = new Date()): string {
  const { weekYear, week } = isoWeekParts(date)
  switch (period) {
    case 'week':
      return `${String(weekYear)}-W${String(week).padStart(2, '0')}`
    case 'month':
      return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}`
    case 'quarter':
      return `${String(date.getFullYear())}-Q${String(Math.floor(date.getMonth() / 3) + 1)}`
    case 'year':
      return String(date.getFullYear())
  }
}

/** Whether a string is a canonical label of the given dimension. */
const LABEL_PATTERN: Record<MemoAnalysisPeriod, RegExp> = {
  week: /^\d{4}-W\d{2}$/u,
  month: /^\d{4}-(0[1-9]|1[0-2])$/u,
  quarter: /^\d{4}-Q[1-4]$/u,
  year: /^\d{4}$/u,
}

/**
 * Whether a label is well-formed for a dimension.
 * @param period - the dimension the label claims to belong to.
 * @param label - the candidate label.
 * @returns whether the label matches the pinned format.
 */
export function isPeriodLabel(period: MemoAnalysisPeriod, label: string): boolean {
  return LABEL_PATTERN[period].test(label)
}

/**
 * The Monday 00:00 local time named by an ISO week id.
 * @param weekId - an ISO week id (`YYYY-Www`).
 * @returns the week's Monday, or `undefined` when the id is malformed.
 */
export function mondayOfWeekId(weekId: string): Date | undefined {
  const match = /^(\d{4})-W(\d{2})$/u.exec(weekId)
  if (match === null) return undefined
  const weekYear = Number(match[1])
  const week = Number(match[2])
  if (week < 1 || week > 53) return undefined
  const firstMonday = startOfIsoWeek(new Date(weekYear, 0, 4))
  const monday = new Date(firstMonday)
  monday.setDate(firstMonday.getDate() + (week - 1) * 7)
  return monday
}

/** The half-open date range `[start, endExclusive)` named by a period label. */
function periodRange(period: MemoAnalysisPeriod, label: string): { start: Date; endExclusive: Date } | undefined {
  if (!isPeriodLabel(period, label)) return undefined
  switch (period) {
    case 'week': {
      const monday = mondayOfWeekId(label)
      if (monday === undefined) return undefined
      const endExclusive = new Date(monday)
      endExclusive.setDate(monday.getDate() + 7)
      return { start: monday, endExclusive }
    }
    case 'month': {
      const year = Number(label.slice(0, 4))
      const month = Number(label.slice(5, 7)) - 1
      return { start: new Date(year, month, 1), endExclusive: new Date(year, month + 1, 1) }
    }
    case 'quarter': {
      const year = Number(label.slice(0, 4))
      const quarter = Number(label.slice(6, 7))
      return { start: new Date(year, (quarter - 1) * 3, 1), endExclusive: new Date(year, quarter * 3, 1) }
    }
    case 'year': {
      const year = Number(label)
      return { start: new Date(year, 0, 1), endExclusive: new Date(year + 1, 0, 1) }
    }
  }
}

/**
 * Every ISO week id attributed to a period label.
 *
 * A calendar week can straddle a month, quarter, or year boundary, so one
 * rule decides ownership and both the host and the UI use it: **a week
 * belongs to the period containing its Thursday**, the same convention that
 * decides which year owns the week. Its consequence is the property the UI
 * needs — every period's week list partitions the timeline with no gap and no
 * overlap, because each week has exactly one Thursday.
 *
 * This function is the enumeration of {@link weekIdBelongsToPeriod}, so the
 * two can never disagree: "listed" is exactly "its Thursday is in the
 * period". String prefixing could not express this at all — every quarter
 * label shares its `YYYY-` prefix with every month label of the same year,
 * which is why the previous prefix test reported all four quarters as `Q1`.
 *
 * @param period - the dimension of `label`.
 * @param label - the period label.
 * @returns the week ids in that period, ascending; empty when malformed.
 */
export function weekIdsInPeriod(period: MemoAnalysisPeriod, label: string): string[] {
  const range = periodRange(period, label)
  if (range === undefined) return []
  // Walk Mondays starting from the one before the period, and keep a week
  // when its Thursday lands inside the period.
  const ids: string[] = []
  const cursor = startOfIsoWeek(range.start)
  cursor.setDate(cursor.getDate() - 7)
  for (;;) {
    const thursday = new Date(cursor)
    thursday.setDate(cursor.getDate() + 3)
    if (thursday.getTime() >= range.endExclusive.getTime()) break
    if (thursday.getTime() >= range.start.getTime()) {
      const { weekYear, week } = isoWeekParts(cursor)
      ids.push(`${String(weekYear)}-W${String(week).padStart(2, '0')}`)
    }
    cursor.setDate(cursor.getDate() + 7)
  }
  return ids
}

/**
 * Whether an ISO week id is attributed to a period label.
 * @param weekId - the ISO week id.
 * @param period - the dimension of `label`.
 * @param label - the period label.
 * @returns whether the week's Thursday falls inside the period.
 */
export function weekIdBelongsToPeriod(weekId: string, period: MemoAnalysisPeriod, label: string): boolean {
  const range = periodRange(period, label)
  if (range === undefined) return false
  const monday = mondayOfWeekId(weekId)
  if (monday === undefined) return false
  const thursday = new Date(monday)
  thursday.setDate(monday.getDate() + 3)
  return thursday.getTime() >= range.start.getTime() && thursday.getTime() < range.endExclusive.getTime()
}

/**
 * The inclusive millisecond bounds of a period label, at local time.
 * @param period - the dimension of `label`.
 * @param label - the period label.
 * @returns the period's first and last millisecond, or `undefined` when malformed.
 */
export function periodBounds(period: MemoAnalysisPeriod, label: string): { start: number; end: number } | undefined {
  const range = periodRange(period, label)
  if (range === undefined) return undefined
  const end = new Date(range.endExclusive)
  end.setMilliseconds(end.getMilliseconds() - 1)
  return { start: range.start.getTime(), end: end.getTime() }
}

/**
 * Shift a period label by a number of periods, in its own dimension.
 * @param period - the dimension of `label`.
 * @param label - the period label.
 * @param delta - signed number of periods to move (may be 0).
 * @returns the shifted label, or `undefined` when `label` is malformed.
 */
export function shiftPeriod(period: MemoAnalysisPeriod, label: string, delta: number): string | undefined {
  if (!isPeriodLabel(period, label)) return undefined
  switch (period) {
    case 'week': {
      const monday = mondayOfWeekId(label)
      if (monday === undefined) return undefined
      monday.setDate(monday.getDate() + delta * 7)
      return periodLabelFor('week', monday)
    }
    case 'month': {
      const date = new Date(Number(label.slice(0, 4)), Number(label.slice(5, 7)) - 1 + delta, 1)
      return periodLabelFor('month', date)
    }
    case 'quarter': {
      const date = new Date(Number(label.slice(0, 4)), (Number(label.slice(6, 7)) - 1 + delta) * 3, 1)
      return periodLabelFor('quarter', date)
    }
    case 'year':
      return periodLabelFor('year', new Date(Number(label) + delta, 0, 1))
  }
}
