/**
 * Zod validation and normalization for the public OpenRouter `/models`
 * response. OpenRouter reports USD per token as decimal strings; callers want
 * USD per 1M tokens, so every price is scaled once here.
 */

import { z } from 'zod'
import type { OpenRouterModel } from './types.ts'

/** A price the API may serialize as a decimal string or a number. */
const price = z.union([z.string(), z.number()])

const modelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  context_length: z.number().optional(),
  pricing: z.object({
    prompt: price,
    completion: price,
    input_cache_read: price.optional(),
    input_cache_write: price.optional(),
  }),
})

const responseSchema = z.object({ data: z.array(modelSchema) })

/**
 * Scale a per-token price to USD per 1M tokens.
 * @param value - per-token amount as the API serialized it.
 * @returns the per-1M-token amount.
 */
function perMillion(value: string | number): number {
  return Number(value) * 1_000_000
}

/**
 * Validate an OpenRouter `/models` payload and normalize each row to USD per
 * 1M tokens.
 * @param json - parsed response body.
 * @returns the normalized models in API order.
 * @throws Error when the payload does not match the documented envelope.
 */
export function normalizeOpenRouterModels(json: unknown): OpenRouterModel[] {
  const parsed = responseSchema.parse(json)
  return parsed.data.map((model) => {
    const cacheRead = model.pricing.input_cache_read
    const cacheWrite = model.pricing.input_cache_write
    return {
      id: model.id,
      name: model.name ?? model.id,
      ...model.context_length === undefined ? {} : { contextLength: model.context_length },
      promptPerM: perMillion(model.pricing.prompt),
      completionPerM: perMillion(model.pricing.completion),
      ...cacheRead === undefined ? {} : { cacheReadPerM: perMillion(cacheRead) },
      ...cacheWrite === undefined ? {} : { cacheWritePerM: perMillion(cacheWrite) },
    }
  })
}
