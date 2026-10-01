/**
 * The static DeepSeek rate card in USD per 1M tokens, verified 2026-09-25 from
 * https://api-docs.deepseek.com/quick_start/pricing/. Off-peak prices are half
 * the peak prices; `deepseekOffPeak` decides which applies.
 */

import type { DeepseekModelRates } from './types.ts'

/** Static DeepSeek rate cards. */
export const DEEPSEEK_RATES: readonly DeepseekModelRates[] = [
  {
    id: 'deepseek-flash',
    cacheHitInput: { offPeak: 0.003, peak: 0.006 },
    cacheMissInput: { offPeak: 0.15, peak: 0.3 },
    output: { offPeak: 0.6, peak: 1.2 },
  },
  {
    id: 'deepseek-v4-pro',
    cacheHitInput: { offPeak: 0.022, peak: 0.044 },
    cacheMissInput: { offPeak: 0.66, peak: 1.32 },
    output: { offPeak: 1.98, peak: 3.96 },
  },
]
