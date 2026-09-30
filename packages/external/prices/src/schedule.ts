/**
 * The DeepSeek off-peak clock. Peak hours are 01:00-04:00 and 06:00-10:00 UTC,
 * Monday-Friday only; weekends are off-peak all day and every other hour is
 * off-peak. The weekday is read on the UTC calendar because both windows close
 * before 16:00 UTC, so no local calendar shift can move them.
 */

import type { OffPeakNow } from './types.ts'

/** Peak windows as `[startHour, endHour)` UTC hours. */
export const PEAK_WINDOWS_UTC: readonly (readonly [number, number])[] = [[1, 4], [6, 10]]

/** Millisecond width of one UTC day, used to step the transition search. */
const DAY_MS = 86_400_000

/** Millisecond width of one hour, used to place each window edge. */
const HOUR_MS = 3_600_000

/** The only UTC hours where the peak state can change: the window edges. */
const PEAK_EDGES: readonly number[] = PEAK_WINDOWS_UTC.flatMap(([start, end]) => [start, end])

/**
 * Whether `instant` falls inside a peak window: a weekday, inside one of the
 * two UTC hour ranges. The bounds are half-open, so a window's closing edge is
 * already off-peak.
 * @param instant - epoch-ms to classify.
 * @returns true when peak pricing applies.
 */
export function isPeakAt(instant: number): boolean {
  const date = new Date(instant)
  const weekday = date.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const hour = date.getUTCHours()
  return PEAK_WINDOWS_UTC.some(([start, end]) => hour >= start && hour < end)
}

/**
 * The current off-peak state at `now` and the epoch-ms of the next peak or
 * off-peak transition. The state is a step function that only moves at a peak
 * window edge, so the first edge after `now` whose state differs is the
 * transition.
 * @param now - epoch-ms reading to classify.
 * @returns the off-peak flag and the next transition instant.
 */
export function deepseekOffPeak(now: number): OffPeakNow {
  const offPeak = !isPeakAt(now)
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS
  // Seven days always contains a transition: the longest off-peak run is the
  // weekend plus the surrounding off hours, under four days.
  for (let day = 0; day <= 7; day += 1) {
    for (const hour of PEAK_EDGES) {
      const candidate = dayStart + day * DAY_MS + hour * HOUR_MS
      if (candidate <= now) continue
      if (isPeakAt(candidate) !== !offPeak) return { offPeak, changeAt: candidate }
    }
  }
  /* v8 ignore next -- the seven-day search always finds an edge; kept for the total return type. */
  return { offPeak, changeAt: now + DAY_MS }
}
