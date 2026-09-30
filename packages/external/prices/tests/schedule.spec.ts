/** The DeepSeek off-peak clock: window edges, the UTC weekday boundary, and the weekend rule. */

import { describe, expect, it } from 'vitest'
import { deepseekOffPeak, isPeakAt, PEAK_WINDOWS_UTC } from '../src/schedule.ts'

/** Epoch-ms for a UTC wall-clock instant. */
function utc(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute)
}

// 2026-09-25 is a Friday; the following Monday is 2026-09-28.
const FRIDAY = 25
const SATURDAY = 26
const SUNDAY = 27
const MONDAY = 28

describe('PEAK_WINDOWS_UTC', () => {
  it('encodes the two documented half-open windows', () => {
    expect(PEAK_WINDOWS_UTC).toEqual([[1, 4], [6, 10]])
  })
})

describe('isPeakAt', () => {
  it('marks the 01:00-04:00 window on a weekday', () => {
    expect(isPeakAt(utc(2026, 9, FRIDAY, 1))).toBe(true)
    expect(isPeakAt(utc(2026, 9, FRIDAY, 3, 59))).toBe(true)
    // The closing edge is already off-peak.
    expect(isPeakAt(utc(2026, 9, FRIDAY, 4))).toBe(false)
  })

  it('marks the 06:00-10:00 window on a weekday', () => {
    expect(isPeakAt(utc(2026, 9, MONDAY, 6))).toBe(true)
    expect(isPeakAt(utc(2026, 9, MONDAY, 9, 59))).toBe(true)
    expect(isPeakAt(utc(2026, 9, MONDAY, 10))).toBe(false)
  })

  it('keeps the weekends off-peak all day', () => {
    for (const hour of [0, 2, 5, 7, 12, 23]) {
      expect(isPeakAt(utc(2026, 9, SATURDAY, hour))).toBe(false)
      expect(isPeakAt(utc(2026, 9, SUNDAY, hour))).toBe(false)
    }
  })

  it('keeps every other weekday hour off-peak', () => {
    expect(isPeakAt(utc(2026, 9, FRIDAY, 0))).toBe(false)
    expect(isPeakAt(utc(2026, 9, FRIDAY, 5))).toBe(false)
    expect(isPeakAt(utc(2026, 9, FRIDAY, 23))).toBe(false)
  })
})

describe('deepseekOffPeak', () => {
  it('reports the current flag and the next edge from a mid-window reading', () => {
    expect(deepseekOffPeak(utc(2026, 9, FRIDAY, 2))).toEqual({ offPeak: false, changeAt: utc(2026, 9, FRIDAY, 4) })
  })

  it('advances from an off-peak gap to the next peak window', () => {
    expect(deepseekOffPeak(utc(2026, 9, FRIDAY, 4, 30))).toEqual({ offPeak: true, changeAt: utc(2026, 9, FRIDAY, 6) })
  })

  it('treats the exact closing edge as off-peak and seeks the next edge', () => {
    expect(deepseekOffPeak(utc(2026, 9, FRIDAY, 10))).toEqual({ offPeak: true, changeAt: utc(2026, 9, MONDAY, 1) })
  })

  it('crosses the weekend: Friday evening off-peak reaches Monday 01:00', () => {
    expect(deepseekOffPeak(utc(2026, 9, FRIDAY, 23))).toEqual({ offPeak: true, changeAt: utc(2026, 9, MONDAY, 1) })
    expect(deepseekOffPeak(utc(2026, 9, SATURDAY, 12))).toEqual({ offPeak: true, changeAt: utc(2026, 9, MONDAY, 1) })
    expect(deepseekOffPeak(utc(2026, 9, SUNDAY, 23, 59))).toEqual({ offPeak: true, changeAt: utc(2026, 9, MONDAY, 1) })
  })

  it('treats the weekday boundary by the UTC calendar', () => {
    // The last off-peak hour of the weekend; the transition is Monday's peak.
    expect(deepseekOffPeak(utc(2026, 9, MONDAY, 0, 30))).toEqual({ offPeak: true, changeAt: utc(2026, 9, MONDAY, 1) })
    // Monday 01:00 opens the peak window, so the state flips.
    expect(deepseekOffPeak(utc(2026, 9, MONDAY, 1))).toEqual({ offPeak: false, changeAt: utc(2026, 9, MONDAY, 4) })
  })

  it('rolls over from a peak edge to the next off-peak edge within the day', () => {
    expect(deepseekOffPeak(utc(2026, 9, MONDAY, 1, 30))).toEqual({ offPeak: false, changeAt: utc(2026, 9, MONDAY, 4) })
    expect(deepseekOffPeak(utc(2026, 9, MONDAY, 5))).toEqual({ offPeak: true, changeAt: utc(2026, 9, MONDAY, 6) })
    expect(deepseekOffPeak(utc(2026, 9, MONDAY, 7))).toEqual({ offPeak: false, changeAt: utc(2026, 9, MONDAY, 10) })
  })
})
