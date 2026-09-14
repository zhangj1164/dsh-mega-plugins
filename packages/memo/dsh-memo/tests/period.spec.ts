import { describe, expect, it } from 'vitest'
import {
  isoWeekParts,
  isPeriodLabel,
  mondayOfWeekId,
  periodBounds,
  periodLabelFor,
  shiftPeriod,
  weekIdBelongsToPeriod,
  weekIdsInPeriod,
} from '../src/period.ts'

/**
 * The tests pin calendar facts, not implementation choices. The two that
 * matter most are the ISO week-year at a year boundary (a week belongs to the
 * year owning its Thursday) and quarter membership (the previous prefix test
 * attributed every quarter of a year to Q1).
 */
describe('isoWeekParts', () => {
  it('labels a year-boundary week with the year owning its Thursday', () => {
    // 2025-12-29 is a Monday; its Thursday is 2026-01-01.
    expect(isoWeekParts(new Date(2025, 11, 29))).toEqual({ weekYear: 2026, week: 1 })
    // 2027-01-01 is a Friday belonging to the 2026 week that started 2026-12-28.
    expect(isoWeekParts(new Date(2027, 0, 1))).toEqual({ weekYear: 2026, week: 53 })
  })

  it('numbers weeks from the Monday of the week containing January 4th', () => {
    expect(isoWeekParts(new Date(2026, 0, 4))).toEqual({ weekYear: 2026, week: 1 })
    expect(isoWeekParts(new Date(2026, 0, 5))).toEqual({ weekYear: 2026, week: 2 })
    expect(isoWeekParts(new Date(2026, 8, 7))).toEqual({ weekYear: 2026, week: 37 })
  })

  it('treats Sunday as the last day of the ISO week', () => {
    // 2026-09-06 is a Sunday; it belongs to the week starting 2026-08-31.
    expect(isoWeekParts(new Date(2026, 8, 6))).toEqual({ weekYear: 2026, week: 36 })
  })
})

describe('periodLabelFor', () => {
  it('produces the pinned label format for each dimension', () => {
    const date = new Date(2026, 8, 7)
    expect(periodLabelFor('week', date)).toBe('2026-W37')
    expect(periodLabelFor('month', date)).toBe('2026-09')
    expect(periodLabelFor('quarter', date)).toBe('2026-Q3')
    expect(periodLabelFor('year', date)).toBe('2026')
  })

  it('uses the ISO week-year for the week label', () => {
    expect(periodLabelFor('week', new Date(2025, 11, 29))).toBe('2026-W01')
    expect(periodLabelFor('year', new Date(2025, 11, 29))).toBe('2025')
  })
})

describe('isPeriodLabel', () => {
  it('accepts each dimension format and rejects the others', () => {
    expect(isPeriodLabel('week', '2026-W01')).toBe(true)
    expect(isPeriodLabel('week', '2026-01')).toBe(false)
    expect(isPeriodLabel('month', '2026-12')).toBe(true)
    expect(isPeriodLabel('month', '2026-13')).toBe(false)
    expect(isPeriodLabel('quarter', '2026-Q4')).toBe(true)
    expect(isPeriodLabel('quarter', '2026-Q5')).toBe(false)
    expect(isPeriodLabel('year', '2026')).toBe(true)
    expect(isPeriodLabel('year', '2026-W01')).toBe(false)
  })
})

describe('mondayOfWeekId', () => {
  it('round-trips a week id through its Monday', () => {
    for (const weekId of ['2026-W01', '2026-W36', '2026-W37', '2026-W53']) {
      const monday = mondayOfWeekId(weekId)
      expect(monday, weekId).toBeDefined()
      if (monday === undefined) continue
      expect(monday.getDay(), weekId).toBe(1)
      expect(periodLabelFor('week', monday), weekId).toBe(weekId)
    }
  })

  it('returns undefined for a malformed week id', () => {
    expect(mondayOfWeekId('2026-37')).toBeUndefined()
    expect(mondayOfWeekId('2026-W99')).toBeUndefined()
    expect(mondayOfWeekId('')).toBeUndefined()
  })
})

describe('weekIdsInPeriod', () => {
  it('attributes each week to the period containing its Thursday', () => {
    // September 2026 starts on a Tuesday, so the week beginning Monday
    // August 31st has its Thursday on September 3rd and belongs to September.
    expect(weekIdsInPeriod('month', '2026-09')).toEqual([
      '2026-W36',
      '2026-W37',
      '2026-W38',
      '2026-W39',
    ])
    // August 2026 starts on a Saturday, so it owns only the weeks whose
    // Thursday is in August.
    expect(weekIdsInPeriod('month', '2026-08')).toEqual([
      '2026-W32',
      '2026-W33',
      '2026-W34',
      '2026-W35',
    ])
  })

  it('partitions a year into twelve months and four quarters with no gap or overlap', () => {
    // Each week has exactly one Thursday, so the period lists must tile the
    // year exactly. This is the property a prefix-based test could not hold.
    const year = weekIdsInPeriod('year', '2026')
    const months: string[] = []
    for (let month = 1; month <= 12; month += 1) {
      months.push(...weekIdsInPeriod('month', `2026-${String(month).padStart(2, '0')}`))
    }
    const quarters = ['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']
      .flatMap(quarter => weekIdsInPeriod('quarter', quarter))
    for (const [name, weeks] of [['months', months], ['quarters', quarters]] as const) {
      expect(weeks.length, name).toBe(year.length)
      expect(new Set(weeks).size, name).toBe(year.length)
      expect([...weeks].sort(), name).toEqual([...year].sort())
    }
  })

  it('gives each quarter only its own weeks', () => {
    // The regression: a prefix test made every quarter of 2026 match Q1.
    const q1 = weekIdsInPeriod('quarter', '2026-Q1')
    const q2 = weekIdsInPeriod('quarter', '2026-Q2')
    const q3 = weekIdsInPeriod('quarter', '2026-Q3')
    const q4 = weekIdsInPeriod('quarter', '2026-Q4')
    expect(q1).not.toEqual(q3)
    expect(q1[0]).toBe('2026-W01')
    expect(q1[q1.length - 1]).toBe('2026-W13')
    expect(q2[0]).toBe('2026-W14')
    expect(q3[0]).toBe('2026-W27')
    expect(q4[q4.length - 1]).toBe('2026-W53')
    for (const weekId of q3) {
      expect(weekIdBelongsToPeriod(weekId, 'quarter', '2026-Q3')).toBe(true)
      expect(weekIdBelongsToPeriod(weekId, 'quarter', '2026-Q1')).toBe(false)
      expect(weekIdBelongsToPeriod(weekId, 'quarter', '2026-Q2')).toBe(false)
      expect(weekIdBelongsToPeriod(weekId, 'quarter', '2026-Q4')).toBe(false)
    }
    expect(q1.length).toBeGreaterThanOrEqual(13)
    expect(q2.length).toBeGreaterThanOrEqual(13)
  })

  it('covers a year with every ISO week exactly once', () => {
    const weeks = weekIdsInPeriod('year', '2026')
    expect(weeks.length).toBe(53)
    expect(new Set(weeks).size).toBe(53)
    expect(weeks[0]).toBe('2026-W01')
    expect(weeks[weeks.length - 1]).toBe('2026-W53')
  })

  it('returns a single week for a week label', () => {
    expect(weekIdsInPeriod('week', '2026-W37')).toEqual(['2026-W37'])
  })

  it('returns nothing for a malformed label', () => {
    expect(weekIdsInPeriod('month', 'nope')).toEqual([])
    expect(weekIdsInPeriod('quarter', '2026-Q9')).toEqual([])
    expect(weekIdsInPeriod('year', '26')).toEqual([])
  })
})

describe('weekIdBelongsToPeriod', () => {
  it('agrees with weekIdsInPeriod for every dimension and offsets', () => {
    const labels = [
      ['week', '2026-W36'],
      ['month', '2026-09'],
      ['quarter', '2026-Q3'],
      ['year', '2026'],
    ] as const
    for (const [period, label] of labels) {
      const listed = new Set(weekIdsInPeriod(period, label))
      for (const weekId of weekIdsInPeriod('year', '2026')) {
        expect(weekIdBelongsToPeriod(weekId, period, label), `${weekId} in ${label}`).toBe(listed.has(weekId))
      }
    }
  })

  it('rejects a week id outside the period and malformed input', () => {
    expect(weekIdBelongsToPeriod('2026-W01', 'month', '2026-09')).toBe(false)
    expect(weekIdBelongsToPeriod('2026-W99', 'month', '2026-09')).toBe(false)
    expect(weekIdBelongsToPeriod('2026-W37', 'month', 'bogus')).toBe(false)
  })
})

describe('shiftPeriod', () => {
  it('moves within each dimension', () => {
    expect(shiftPeriod('week', '2026-W37', 1)).toBe('2026-W38')
    expect(shiftPeriod('week', '2026-W37', -1)).toBe('2026-W36')
    expect(shiftPeriod('month', '2026-09', 1)).toBe('2026-10')
    expect(shiftPeriod('month', '2026-12', 1)).toBe('2027-01')
    expect(shiftPeriod('month', '2026-01', -1)).toBe('2025-12')
    expect(shiftPeriod('quarter', '2026-Q3', 1)).toBe('2026-Q4')
    expect(shiftPeriod('quarter', '2026-Q4', 1)).toBe('2027-Q1')
    expect(shiftPeriod('year', '2026', -1)).toBe('2025')
  })

  it('crosses a year boundary by week without skipping or repeating', () => {
    expect(shiftPeriod('week', '2026-W01', -1)).toBe('2025-W52')
    expect(shiftPeriod('week', '2026-W53', 1)).toBe('2027-W01')
  })

  it('keeps the quarter dimension aligned to calendar quarters', () => {
    for (const quarter of ['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']) {
      const shifted = shiftPeriod('quarter', quarter, 4)
      expect(shifted).toBe(`2027-Q${quarter.slice(6, 7)}`)
    }
  })

  it('is reversible and returns undefined for malformed labels', () => {
    for (const [period, label] of [
      ['week', '2026-W37'],
      ['month', '2026-09'],
      ['quarter', '2026-Q3'],
      ['year', '2026'],
    ] as const) {
      const forward = shiftPeriod(period, label, 3)
      expect(forward).toBeDefined()
      if (forward === undefined) continue
      expect(shiftPeriod(period, forward, -3)).toBe(label)
    }
    expect(shiftPeriod('week', 'nope', 1)).toBeUndefined()
    expect(shiftPeriod('month', '2026-13', 1)).toBeUndefined()
  })
})

describe('periodBounds', () => {
  it('covers the full period inclusively', () => {
    const week = periodBounds('week', '2026-W37')
    expect(week).toBeDefined()
    if (week === undefined) return
    expect(new Date(week.start).getDay()).toBe(1)
    expect(new Date(week.end).getDay()).toBe(0)
    expect(new Date(week.end).getHours()).toBe(23)

    const month = periodBounds('month', '2026-09')
    expect(month).toBeDefined()
    if (month === undefined) return
    expect(new Date(month.start).getDate()).toBe(1)
    expect(new Date(month.end).getDate()).toBe(30)

    const quarter = periodBounds('quarter', '2026-Q3')
    expect(quarter).toBeDefined()
    if (quarter === undefined) return
    expect(new Date(quarter.start).getMonth()).toBe(6)
    expect(new Date(quarter.end).getMonth()).toBe(8)
    expect(new Date(quarter.end).getDate()).toBe(30)

    const year = periodBounds('year', '2026')
    expect(year).toBeDefined()
    if (year === undefined) return
    expect(new Date(year.start).getMonth()).toBe(0)
    expect(new Date(year.end).getMonth()).toBe(11)
    expect(new Date(year.end).getDate()).toBe(31)
  })

  it('returns undefined for malformed labels', () => {
    expect(periodBounds('week', '2026-37')).toBeUndefined()
    expect(periodBounds('quarter', '2026-Q0')).toBeUndefined()
  })
})
