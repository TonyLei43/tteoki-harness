// @vitest-environment jsdom
/** What the browser half registers, and its prices Remote behavior. */

import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DeepseekValue, OpenRouterModel, OpenRouterModelsValue, PricesStatus,
} from '@deepseek-ai/dsh-api-remotes/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import { en, type PricesLocaleKey } from '../src/client/locales.ts'

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
  }
})

/** Dictionary-backed `t` with the runtime's `{name}` templating. */
const t = (key: PricesLocaleKey, params?: Record<string, unknown>): string => {
  let text = en[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

type RemoteResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

const DEEPSEEK: DeepseekValue = {
  models: [{
    id: 'deepseek-flash',
    cacheHitInput: { offPeak: 0.003, peak: 0.006 },
    cacheMissInput: { offPeak: 0.15, peak: 0.3 },
    output: { offPeak: 0.6, peak: 1.2 },
  }],
  schedule: { peakWindowsUtc: [[1, 4], [6, 10]], weekdaysOnly: true },
  now: { offPeak: true, changeAt: Date.now() + 3_600_000 },
}
const STATUS: PricesStatus = { offPeak: true, changeAt: Date.now() + 3_600_000, localTimezone: 'Asia/Shanghai' }
const MODELS: readonly OpenRouterModel[] = [
  { id: 'openai/gpt-4o', name: 'GPT-4o', contextLength: 128_000, promptPerM: 2.5, completionPerM: 10, cacheReadPerM: 1.25, cacheWritePerM: 5 },
  { id: 'bare/model', name: 'bare/model', promptPerM: 1, completionPerM: 2 },
]

/** One scripted `prices` namespace face. */
function pricesFace() {
  return {
    deepseek: vi.fn(async (): Promise<RemoteResult<DeepseekValue>> => ({ ok: true, value: DEEPSEEK })),
    status: vi.fn(async (): Promise<RemoteResult<PricesStatus>> => ({ ok: true, value: STATUS })),
    openRouterModels: vi.fn(async (): Promise<RemoteResult<OpenRouterModelsValue>> => ({ ok: true, value: { models: MODELS } })),
  }
}

/** Assemble a runtime with the locale, a recording layout, and the scripted namespace. */
async function bench() {
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  runtime.ctx.provide('locale', locale)
  runtime.ctx.slots.installLocale(locale)
  const selectPanel = vi.fn<ILayout['selectPanel']>()
  runtime.ctx.provide('layout', {
    panelInfo: runtime.panelInfo,
    selectPanel,
    beginNavigation: () => new AbortController().signal,
    toggleSidebar: () => {},
    openRightbar: () => {},
    closeRightbar: () => {},
  } satisfies ILayout)
  const face = pricesFace()
  runtime.remote.provideNamespaces({ prices: face })
  await runtime.declare({
    'main': { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
    'settings.section': { kind: 'list', scope: 'root' },
  })
  const handle = await runtime.mount({ inject: [...inject], apply })
  return { runtime, face, selectPanel, handle }
}

describe('ui-prices browser plugin', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.prices', 'layout'])
  })

  it('registers the panel, the sidebar entry, and the settings section; disposal removes all three', async () => {
    const subject = await bench()
    expect(subject.runtime.slots.entries('main')[0]).toMatchObject({ options: { key: 'prices' }, locale: 'prices' })
    const panelEntry = subject.runtime.slots.entries('sidebar.panellist')[0]
    expect(panelEntry).toMatchObject({ options: { id: 'prices', order: 21 }, locale: 'prices' })
    expect(resolveSlotLabel(panelEntry?.options.label)).toBe(en.nav)
    expect(subject.runtime.slots.entries('settings.section')[0]).toMatchObject({ options: { id: 'prices', order: 24 }, locale: 'prices' })

    await subject.handle.dispose()
    expect(subject.runtime.slots.entries('main')).toEqual([])
    expect(subject.runtime.slots.entries('sidebar.panellist')).toEqual([])
    expect(subject.runtime.slots.entries('settings.section')).toEqual([])
  })

  it('renders the off-peak clock, the DeepSeek table, and the OpenRouter list', async () => {
    const subject = await bench()
    const main = subject.runtime.renderSlot('main', {}, { entryKey: 'prices' })
    expect(await main.view.findByText(en['clock.offPeak'])).toBeTruthy()
    expect(main.view.getByText('deepseek-flash')).toBeTruthy()
    expect(main.view.getByText('0.0030 / 0.0060')).toBeTruthy()
    expect(await main.view.findByText('GPT-4o')).toBeTruthy()
    expect(main.view.getByText(en['clock.windows'].replace('{windows}', '01:00–04:00, 06:00–10:00'))).toBeTruthy()
    expect(subject.face.deepseek).toHaveBeenCalledOnce()
  })

  it('filters the catalog by id or name', async () => {
    const subject = await bench()
    const main = subject.runtime.renderSlot('main', {}, { entryKey: 'prices' })
    await main.view.findByText('GPT-4o')
    fireEvent.change(main.view.getByRole('textbox', { name: en['openrouter.searchPlaceholder'] }), { target: { value: 'gpt' } })
    expect(main.view.getByText('GPT-4o')).toBeTruthy()
    expect(main.view.queryByText('bare/model')).toBeNull()
  })

  it('shows an unavailable notice when the catalog fetch fails', async () => {
    const subject = await bench()
    subject.face.openRouterModels.mockResolvedValueOnce({ ok: false, error: { code: 'prices/unavailable', message: 'offline' } })
    const main = subject.runtime.renderSlot('main', {}, { entryKey: 'prices' })
    expect((await main.view.findByRole('alert')).textContent).toBe(en.unavailable)
  })

  it('re-reads the catalog on refresh and reports a failed refresh', async () => {
    const subject = await bench()
    const main = subject.runtime.renderSlot('main', {}, { entryKey: 'prices' })
    await main.view.findByText('GPT-4o')
    subject.face.openRouterModels.mockResolvedValueOnce({ ok: false, error: { code: 'prices/unavailable', message: 'offline' } })
    fireEvent.click(main.view.getByRole('button', { name: en['openrouter.refresh'] }))
    await waitFor(() => { expect(subject.face.openRouterModels).toHaveBeenCalledTimes(2) })
    expect((await main.view.findByRole('alert')).textContent).toBe(en.unavailable)
  })

  it('reports a failed DeepSeek read as the page error', async () => {
    const subject = await bench()
    subject.face.deepseek.mockResolvedValue({ ok: false, error: { code: 'gateway/internal', message: 'no' } })
    const main = subject.runtime.renderSlot('main', {}, { entryKey: 'prices' })
    expect((await main.view.findByRole('alert')).textContent).toBe(en.error)
  })

  it('summarizes the clock and catalog in the settings section and jumps to the panel', async () => {
    const subject = await bench()
    const section = subject.runtime.renderSlot('settings.section', { close: () => {} })
    expect(await section.view.findByText(t('section.modelCount', { models: 2 }))).toBeTruthy()
    expect(section.view.getByText(en['clock.offPeak'])).toBeTruthy()
    fireEvent.click(section.view.getByRole('button', { name: en.openBoard }))
    expect(subject.selectPanel).toHaveBeenCalledWith('prices')
  })
})
