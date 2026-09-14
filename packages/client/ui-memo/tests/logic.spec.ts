import { describe, expect, it } from 'vitest'
import {
  cardsInPeriod,
  labelMatches,
  periodDisplay,
  readSelection,
  toCards,
  targetWeekId,
  writeSelection,
  PERIODS,
  type MemoCard,
  type StorageLike,
} from '../src/client/logic.ts'
import type { MemoWeek } from 'dsh-memo/client'

/** One stored week with the given entries; later weeks get later timestamps. */
function week(weekId: string, contents: string[]): MemoWeek {
  const weekOffset = Number(weekId.slice(6, 8)) * 1000
  return {
    weekId,
    weekStart: 0,
    weekEnd: 0,
    updatedAt: 0,
    entries: contents.map((content, index) => ({
      id: `${weekId}-${String(index)}`,
      type: 'text' as const,
      content,
      createdAt: weekOffset + index,
      updatedAt: weekOffset + index,
    })),
  }
}

/** An in-memory Storage stand-in. */
function fakeStorage(seed: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...seed }
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value },
  }
}

describe('toCards', () => {
  it('flattens weeks into cards carrying their week id', () => {
    const cards = toCards([week('2026-W36', ['a']), week('2026-W37', ['b', 'c'])])
    expect(cards).toHaveLength(3)
    expect(cards.map(card => card.weekId).sort()).toEqual(['2026-W36', '2026-W37', '2026-W37'])
  })

  it('orders newest first regardless of week order', () => {
    const older = week('2026-W36', ['older'])
    const newer = week('2026-W37', ['newer'])
    const cards = toCards([older, newer])
    expect(cards[0]?.content).toBe('newer')
  })

  it('tolerates a week with no entries array', () => {
    const bare = { weekId: '2026-W36', weekStart: 0, weekEnd: 0, updatedAt: 0 } as unknown as MemoWeek
    expect(toCards([bare])).toEqual([])
  })

  it('returns nothing for no weeks', () => {
    expect(toCards([])).toEqual([])
  })
})

describe('cardsInPeriod', () => {
  const cards: MemoCard[] = [
    { id: '1', weekId: '2026-W36', content: 'a', type: 'text', createdAt: 2, updatedAt: 2 },
    { id: '2', weekId: '2026-W37', content: 'b', type: 'text', createdAt: 1, updatedAt: 1 },
  ]

  it('keeps only the cards whose week belongs to the period', () => {
    expect(cardsInPeriod(cards, ['2026-W36']).map(card => card.id)).toEqual(['1'])
    expect(cardsInPeriod(cards, ['2026-W36', '2026-W37']).map(card => card.id)).toEqual(['1', '2'])
  })

  it('returns nothing for an empty period', () => {
    expect(cardsInPeriod(cards, [])).toEqual([])
  })

  it('preserves the newest-first order it was given', () => {
    expect(cardsInPeriod(cards, ['2026-W36', '2026-W37'])[0]?.id).toBe('1')
  })
})

describe('targetWeekId', () => {
  it('prefers the current week when the period contains it', () => {
    expect(targetWeekId({ period: 'month', label: '2026-09' }, ['2026-W36', '2026-W37'], '2026-W37')).toBe('2026-W37')
  })

  it('falls back to the last week of the period when it does not contain the current one', () => {
    expect(targetWeekId({ period: 'week', label: '2026-W10' }, ['2026-W10'], '2026-W37')).toBe('2026-W10')
  })

  it('falls back to the current week when the period has no weeks yet', () => {
    expect(targetWeekId({ period: 'year', label: '2030' }, [], '2026-W37')).toBe('2026-W37')
  })

  it('returns undefined when nothing is known', () => {
    expect(targetWeekId({ period: 'year', label: '2030' }, [], undefined)).toBeUndefined()
  })
})

describe('periodDisplay', () => {
  it('shortens a week label and keeps the rest readable', () => {
    expect(periodDisplay('week', '2026-W37')).toBe('W37')
    expect(periodDisplay('month', '2026-09')).toBe('2026-09')
    expect(periodDisplay('quarter', '2026-Q3')).toBe('2026 Q3')
    expect(periodDisplay('year', '2026')).toBe('2026')
  })

  it('passes a malformed week label through rather than showing nothing', () => {
    expect(periodDisplay('week', 'nonsense')).toBe('nonsense')
  })
})

describe('labelMatches', () => {
  it('accepts the pinned format per dimension', () => {
    expect(labelMatches('week', '2026-W01')).toBe(true)
    expect(labelMatches('month', '2026-01')).toBe(true)
    expect(labelMatches('quarter', '2026-Q4')).toBe(true)
    expect(labelMatches('year', '2026')).toBe(true)
  })

  it('rejects a label from another dimension', () => {
    expect(labelMatches('week', '2026-01')).toBe(false)
    expect(labelMatches('month', '2026-W01')).toBe(false)
    expect(labelMatches('quarter', '2026-Q5')).toBe(false)
    expect(labelMatches('year', '26')).toBe(false)
  })
})

describe('selection persistence', () => {
  const fallback = { period: 'week', label: '2026-W37' } as const

  it('round-trips a valid selection', () => {
    const storage = fakeStorage()
    writeSelection(storage, { period: 'quarter', label: '2026-Q3' })
    expect(readSelection(storage, fallback)).toEqual({ period: 'quarter', label: '2026-Q3' })
  })

  it('falls back when storage is empty', () => {
    expect(readSelection(fakeStorage(), fallback)).toEqual(fallback)
  })

  it('falls back when storage is unavailable', () => {
    expect(readSelection(undefined, fallback)).toEqual(fallback)
  })

  it('rejects an unknown dimension', () => {
    const storage = fakeStorage({ 'dsh-memo:period': 'fortnight', 'dsh-memo:label': '2026-W37' })
    expect(readSelection(storage, fallback)).toEqual(fallback)
  })

  it('rejects a label that does not match its dimension', () => {
    const storage = fakeStorage({ 'dsh-memo:period': 'month', 'dsh-memo:label': '2026-W37' })
    expect(readSelection(storage, fallback)).toEqual(fallback)
  })

  it('survives a storage that throws', () => {
    const hostile: StorageLike = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    expect(readSelection(hostile, fallback)).toEqual(fallback)
    expect(() => { writeSelection(hostile, fallback) }).not.toThrow()
  })
})

describe('PERIODS', () => {
  it('lists the four dimensions in display order', () => {
    expect(PERIODS).toEqual(['week', 'month', 'quarter', 'year'])
  })
})
