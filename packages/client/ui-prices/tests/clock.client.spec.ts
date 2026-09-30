/** Pure price formatting and the off-peak countdown. */

import { describe, expect, it } from 'vitest'
import { formatCountdown, formatPeakWindows, formatPrice, formatTokens, remainingMs } from '../src/client/clock.ts'

describe('formatPeakWindows', () => {
  it('renders half-open UTC hour pairs', () => {
    expect(formatPeakWindows([[1, 4], [6, 10]])).toBe('01:00–04:00, 06:00–10:00')
    expect(formatPeakWindows([])).toBe('')
  })
})

describe('remainingMs', () => {
  it('counts down and clamps at zero', () => {
    expect(remainingMs(1_500, 1_000)).toBe(500)
    expect(remainingMs(1_000, 1_500)).toBe(0)
  })
})

describe('formatCountdown', () => {
  it('renders minutes below an hour and hours above', () => {
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(59_000)).toBe('0:59')
    expect(formatCountdown(61_000)).toBe('1:01')
    expect(formatCountdown(3_599_000)).toBe('59:59')
    expect(formatCountdown(3_600_000)).toBe('1:00:00')
    expect(formatCountdown(73 * 3_600_000)).toBe('73:00:00')
  })

  it('floors partial seconds and clamps negatives', () => {
    expect(formatCountdown(1_999)).toBe('0:01')
    expect(formatCountdown(-5)).toBe('0:00')
  })
})

describe('formatPrice', () => {
  it('keeps small values readable', () => {
    expect(formatPrice(3.96)).toBe('3.96')
    expect(formatPrice(1)).toBe('1.00')
    expect(formatPrice(0.15)).toBe('0.150')
    expect(formatPrice(0.003)).toBe('0.0030')
    expect(formatPrice(0)).toBe('0.0000')
  })
})

describe('formatTokens', () => {
  it('rounds to an integer string', () => {
    expect(formatTokens(128_000)).toBe('128000')
    expect(formatTokens(1_000.6)).toBe('1001')
  })
})
