/** The prices service: the static DeepSeek card, OpenRouter normalization, caching, and Remote failures. */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { DEEPSEEK_RATES } from '../src/rates.ts'
import { normalizeOpenRouterModels } from '../src/openrouter.ts'
import type { Config } from '../src/index.ts'
import { Prices } from '../src/index.ts'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** One OpenRouter `/models` payload with decimal per-token strings. */
const CATALOG = {
  data: [
    {
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      context_length: 128_000,
      pricing: { prompt: '0.0000025', completion: '0.00001', input_cache_read: '0.00000125', input_cache_write: '0.000005' },
    },
    {
      id: 'bare/model',
      pricing: { prompt: '0.000001', completion: '0.000002' },
    },
  ],
}

/** Construct a service with an explicit endpoint and TTL. */
function bench(config: { openRouterBaseUrl?: string; requestTimeoutMs?: number; refreshMs?: number } = {}) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  return new Prices(ctx, {
    openRouterBaseUrl: 'https://test.example/api/v1',
    requestTimeoutMs: 2_000,
    refreshMs: 1_000_000,
    ...config,
  })
}

describe('DEEPSEEK_RATES', () => {
  it('encodes the verified flash and pro rate cards', () => {
    expect(DEEPSEEK_RATES).toEqual([
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
    ])
  })
})

describe('normalizeOpenRouterModels', () => {
  it('scales per-token strings to USD per 1M tokens', () => {
    expect(normalizeOpenRouterModels(CATALOG)).toEqual([
      {
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        contextLength: 128_000,
        promptPerM: 2.5,
        completionPerM: 10,
        cacheReadPerM: 1.25,
        cacheWritePerM: 5,
      },
      { id: 'bare/model', name: 'bare/model', promptPerM: 1, completionPerM: 2 },
    ])
  })

  it('rejects a payload that is not the documented envelope', () => {
    expect(() => normalizeOpenRouterModels({})).toThrow()
    expect(() => normalizeOpenRouterModels({ data: [{ id: '' }] })).toThrow()
  })
})

describe('Prices service', () => {
  it('serves the DeepSeek card with the schedule and an off-peak reading', () => {
    const value = bench().deepseek(new AbortController().signal)
    expect(value.models).toEqual(DEEPSEEK_RATES)
    expect(value.schedule).toEqual({ peakWindowsUtc: [[1, 4], [6, 10]], weekdaysOnly: true })
    expect(typeof value.now.offPeak).toBe('boolean')
    expect(value.now.changeAt).toBeGreaterThan(Date.now() - 1)
  })

  it('reports the off-peak flag, next change, and host timezone', () => {
    const status = bench().status(new AbortController().signal)
    expect(typeof status.offPeak).toBe('boolean')
    expect(typeof status.changeAt).toBe('number')
    expect(status.localTimezone.length).toBeGreaterThan(0)
  })

  it('fetches and normalizes the public catalog without a key', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(JSON.stringify(CATALOG), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const models = (await bench().openRouterModels(new AbortController().signal)).models
    expect(models.map(model => model.id)).toEqual(['openai/gpt-4o', 'bare/model'])
    const [url, init] = fetchMock.mock.calls.at(-1)!
    expect(url).toBe('https://test.example/api/v1/models')
    expect(init?.headers).toBeUndefined()
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('serves the cached catalog inside the TTL and refetches after it', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(JSON.stringify(CATALOG), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    let clock = 1_000_000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const service = bench({ refreshMs: 1_000 })
    await service.openRouterModels(new AbortController().signal)
    await service.openRouterModels(new AbortController().signal)
    expect(fetchMock).toHaveBeenCalledOnce()
    clock += 2_000
    await service.openRouterModels(new AbortController().signal)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    now.mockRestore()
  })

  it('names transport, HTTP, JSON, and schema failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(bench().openRouterModels(new AbortController().signal)).rejects.toMatchObject({ code: 'prices/unavailable' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 502 })))
    await expect(bench().openRouterModels(new AbortController().signal)).rejects.toMatchObject({
      code: 'prices/request-failed', details: { status: 502 },
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(bench().openRouterModels(new AbortController().signal)).rejects.toMatchObject({ code: 'prices/bad-response' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 })))
    await expect(bench().openRouterModels(new AbortController().signal)).rejects.toMatchObject({ code: 'prices/bad-response' })
  })

  it('defaults the deployment config at the schema boundary', () => {
    const resolved = Prices.Config({}) as Required<Config>
    expect(resolved.openRouterBaseUrl).toBe('https://openrouter.ai/api/v1')
    expect(resolved.requestTimeoutMs).toBe(20_000)
    expect(resolved.refreshMs).toBe(3_600_000)
  })
})
