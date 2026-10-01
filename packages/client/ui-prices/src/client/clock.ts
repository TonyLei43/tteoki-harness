/**
 * Pure formatting for the DeepSeek off-peak clock and the price tables. No
 * React and no subscriptions, so the panel and its tests read the same
 * functions.
 */

/**
 * Format the peak windows as `HH:00–HH:00` UTC hour pairs.
 * @param windows - half-open `[startHour, endHour]` pairs.
 * @returns the comma-joined label.
 */
export function formatPeakWindows(windows: readonly (readonly [number, number])[]): string {
  const pad = (hour: number): string => String(hour).padStart(2, '0')
  return windows.map(([start, end]) => `${pad(start)}:00–${pad(end)}:00`).join(', ')
}

/**
 * Milliseconds left until the next transition, never negative.
 * @param changeAt - epoch-ms of the next peak/off-peak edge.
 * @param now - current epoch-ms.
 * @returns the remaining duration in milliseconds.
 */
export function remainingMs(changeAt: number, now: number): number {
  return Math.max(0, changeAt - now)
}

/**
 * Format a remaining duration as a ticker: `h:mm:ss` with an hour or more,
 * else `m:ss`.
 * @param ms - remaining milliseconds.
 * @returns the countdown text.
 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000))
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}` : `${String(minutes)}:${pad(seconds)}`
}

/**
 * Format one USD price per 1M tokens, keeping small values readable.
 * @param value - price in USD per 1M tokens.
 * @returns the display text.
 */
export function formatPrice(value: number): string {
  if (value >= 1) return value.toFixed(2)
  if (value >= 0.01) return value.toFixed(3)
  return value.toFixed(4)
}

/**
 * Format one context length for display.
 * @param tokens - context length in tokens.
 * @returns the integer token count.
 */
export function formatTokens(tokens: number): string {
  return String(Math.round(tokens))
}
