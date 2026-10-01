/**
 * Wire vocabulary for the `prices` Remote namespace: the static DeepSeek rate
 * card with its off-peak schedule, and the normalized OpenRouter model list.
 * Types only; every value is JSON-representable because it crosses the Typert
 * wire.
 */

/** One price in USD per 1M tokens, split by DeepSeek's peak and off-peak hours. */
export interface PriceTier {
  /** Off-peak (discounted) USD per 1M tokens. */
  readonly offPeak: number
  /** Peak (standard) USD per 1M tokens. */
  readonly peak: number
}

/** One DeepSeek model's static rate card in USD per 1M tokens. */
export interface DeepseekModelRates {
  /** Model id as the provider spells it. */
  readonly id: string
  /** Cache-hit input tokens. */
  readonly cacheHitInput: PriceTier
  /** Cache-miss input tokens. */
  readonly cacheMissInput: PriceTier
  /** Output tokens. */
  readonly output: PriceTier
}

/** The DeepSeek off-peak windows, in UTC hours. */
export interface DeepseekSchedule {
  /** Peak windows as `[startHour, endHour)` UTC hours. */
  readonly peakWindowsUtc: readonly (readonly [number, number])[]
  /** Whether the schedule applies on weekdays only. */
  readonly weekdaysOnly: boolean
}

/** The current off-peak state and the next transition instant. */
export interface OffPeakNow {
  /** Whether off-peak pricing is in effect now. */
  readonly offPeak: boolean
  /** Epoch-ms of the next peak/off-peak transition. */
  readonly changeAt: number
}

/** The DeepSeek rate card plus the schedule and the current off-peak state. */
export interface DeepseekValue {
  /** Static rate cards, one per model. */
  readonly models: readonly DeepseekModelRates[]
  /** The off-peak windows that discount those rates. */
  readonly schedule: DeepseekSchedule
  /** Current state and next transition. */
  readonly now: OffPeakNow
}

/** The host clock's off-peak reading, resolved in the host's timezone. */
export interface PricesStatus extends OffPeakNow {
  /** IANA timezone name the host resolved, e.g. `Asia/Shanghai`. */
  readonly localTimezone: string
}

/** One OpenRouter model, normalized to USD per 1M tokens. */
export interface OpenRouterModel {
  /** OpenRouter model id, e.g. `openai/gpt-4o`. */
  readonly id: string
  /** Display name, when OpenRouter supplies one; clients fall back to the id. */
  readonly name: string
  /** Maximum context length in tokens, when the API reports one. */
  readonly contextLength?: number
  /** Prompt (input) USD per 1M tokens. */
  readonly promptPerM: number
  /** Completion (output) USD per 1M tokens. */
  readonly completionPerM: number
  /** Cache-read input USD per 1M tokens, when the API reports one. */
  readonly cacheReadPerM?: number
  /** Cache-write input USD per 1M tokens, when the API reports one. */
  readonly cacheWritePerM?: number
}

/** The normalized OpenRouter catalog. */
export interface OpenRouterModelsValue {
  /** Every model the endpoint advertised, in API order. */
  readonly models: readonly OpenRouterModel[]
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The OpenRouter endpoint was unreachable or the transport failed. */
    'prices/unavailable': { readonly url: string }
    /** OpenRouter answered with an HTTP failure. */
    'prices/request-failed': { readonly url: string; readonly status: number }
    /** OpenRouter answered, but the payload is not the documented envelope. */
    'prices/bad-response': { readonly url: string }
  }
}
