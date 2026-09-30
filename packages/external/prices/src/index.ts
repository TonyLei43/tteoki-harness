/**
 * Host price catalog exposing the generated `prices` Remote namespace. The
 * DeepSeek rate card and its off-peak clock are static; the OpenRouter model
 * list is fetched from the public `/models` endpoint and cached for
 * `refreshMs`. The service holds no filesystem state.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { normalizeOpenRouterModels } from './openrouter.ts'
import { DEEPSEEK_RATES } from './rates.ts'
import { deepseekOffPeak, PEAK_WINDOWS_UTC } from './schedule.ts'
import type { DeepseekValue, OpenRouterModel, OpenRouterModelsValue, PricesStatus } from './types.ts'

export type * from './types.ts'
export { DEEPSEEK_RATES } from './rates.ts'
export { deepseekOffPeak, isPeakAt, PEAK_WINDOWS_UTC } from './schedule.ts'
export { normalizeOpenRouterModels } from './openrouter.ts'

/** Public OpenRouter API base, including its version segment. */
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

/** Caller-facing timeout for one OpenRouter request, in milliseconds. */
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000

/** How long a fetched OpenRouter catalog stays cached, in milliseconds. */
const DEFAULT_REFRESH_MS = 3_600_000

/** Deployment policy for the price catalog. */
export interface Config {
  /** OpenRouter API base URL; the service appends `/models`. */
  readonly openRouterBaseUrl?: string
  /** Caller-facing timeout for one OpenRouter request, in milliseconds. */
  readonly requestTimeoutMs?: number
  /** Cache TTL for the OpenRouter model list, in milliseconds. */
  readonly refreshMs?: number
}

/** One cached OpenRouter read with the instant it was stored. */
interface CatalogCache {
  /** Epoch-ms the models were fetched. */
  readonly at: number
  /** The normalized models. */
  readonly models: readonly OpenRouterModel[]
}

/** Host service backing the generated `ctx.remote.prices` namespace. */
export class Prices extends TypertRemoteService {
  static Config: z<Config> = z.object({
    openRouterBaseUrl: z.string().default(DEFAULT_OPENROUTER_BASE_URL),
    requestTimeoutMs: z.natural().min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
    refreshMs: z.natural().min(1).default(DEFAULT_REFRESH_MS),
  })

  private readonly baseUrl: string
  private readonly requestTimeoutMs: number
  private readonly refreshMs: number
  private cache: CatalogCache | undefined

  /**
   * @param ctx - Host context.
   * @param config - OpenRouter endpoint, timeout, and cache TTL.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'prices', { namespace: 'prices' })
    // schemastery has already filled the defaulted fields; the assertion
    // records that resolution, not a hidden fallback.
    const resolved = config as Required<Config>
    this.baseUrl = resolved.openRouterBaseUrl.replace(/\/+$/u, '')
    this.requestTimeoutMs = resolved.requestTimeoutMs
    this.refreshMs = resolved.refreshMs
  }

  /**
   * Read the OpenRouter model catalog, serving a cached copy inside
   * `refreshMs`. The endpoint is public and needs no key.
   * @param signal - caller cancellation.
   * @returns every advertised model normalized to USD per 1M tokens.
   * @throws RemoteError on transport, HTTP, or schema failure.
   */
  @Remote('openRouterModels')
  async openRouterModels(signal: AbortSignal): Promise<OpenRouterModelsValue> {
    const now = Date.now()
    if (this.cache !== undefined && now - this.cache.at < this.refreshMs) return { models: this.cache.models }
    const url = `${this.baseUrl}/models`
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.requestTimeoutMs)]),
    }).catch((error: unknown) => {
      throw new RemoteError('prices/unavailable', `OpenRouter request failed: ${String(error)}`, { url })
    })
    if (!response.ok) {
      throw new RemoteError('prices/request-failed', `OpenRouter answered ${String(response.status)} for ${url}`, {
        url,
        status: response.status,
      })
    }
    const json = await response.json().catch((error: unknown) => {
      throw new RemoteError('prices/bad-response', `OpenRouter response is not JSON: ${String(error)}`, { url })
    })
    let models: OpenRouterModel[]
    try {
      models = normalizeOpenRouterModels(json)
    } catch (error: unknown) {
      throw new RemoteError('prices/bad-response', `OpenRouter response is malformed: ${String(error)}`, { url })
    }
    this.cache = { at: now, models }
    return { models }
  }

  /**
   * Read the static DeepSeek rate card, the off-peak windows, and the host's
   * current off-peak state. No network.
   * @param signal - caller cancellation; unused because the read is synchronous.
   * @returns the rate card and schedule.
   */
  @Remote('deepseek')
  deepseek(signal: AbortSignal): DeepseekValue {
    // The read is synchronous; the parameter keeps the generated namespace uniform.
    void signal
    return {
      models: DEEPSEEK_RATES,
      schedule: { peakWindowsUtc: PEAK_WINDOWS_UTC, weekdaysOnly: true },
      now: deepseekOffPeak(Date.now()),
    }
  }

  /**
   * Read the host's off-peak state and resolved local timezone.
   * @param signal - caller cancellation; unused because the read is synchronous.
   * @returns the off-peak flag, next transition instant, and host timezone.
   */
  @Remote('status')
  status(signal: AbortSignal): PricesStatus {
    // The read is synchronous; the parameter keeps the generated namespace uniform.
    void signal
    return {
      ...deepseekOffPeak(Date.now()),
      localTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
  }
}

export default Prices
