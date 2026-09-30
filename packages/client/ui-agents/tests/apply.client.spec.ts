/** What the browser half registers, and its Remote reads and writes. */

import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentsSectionInjected } from '@deepseek-ai/dsh-client-ui-agents/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

const PRESET = { id: 'builder', name: 'Builder', description: 'Builds things.', isDefault: true }
const BARE = { id: 'bare', isDefault: false }
const BINDING = { provider: 'deepseek', model: 'deepseek-chat' }
const CATALOG = {
  default: BINDING,
  routableProviders: ['deepseek'],
  groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }],
  failures: [],
}

type Ok<T> = { readonly ok: true; readonly value: T }
type Fail = { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
type Result<T> = Ok<T> | Fail

async function bench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const list = vi.fn<() => Promise<Result<{ presets: Array<{ id: string; name?: string; description?: string; isDefault: boolean }> }>>>()
    .mockResolvedValue({ ok: true, value: { presets: [PRESET, BARE] } })
  const modelCatalog = vi.fn<() => Promise<Result<typeof CATALOG>>>().mockResolvedValue({ ok: true, value: CATALOG })
  const listBindings = vi.fn<() => Promise<Result<{ bindings: Record<string, typeof BINDING> }>>>()
    .mockResolvedValue({ ok: true, value: { bindings: { builder: BINDING } } })
  const setPreset = vi.fn<() => Promise<Result<{ bindings: Record<string, typeof BINDING> }>>>()
    .mockResolvedValue({ ok: true, value: { bindings: {} } })
  ctx.provide('remote.agentPresets', { list })
  ctx.provide('remote.session', { modelCatalog })
  ctx.provide('remote.agentModels', { list: listBindings, setPreset })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, list, modelCatalog, listBindings, setPreset }
}

/** The Settings shell's section slot, as its owner declares it. */
function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

afterEach(() => {})

describe('ui-agents browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.agentPresets', 'remote.agentModels', 'remote.session'])
  })

  it('registers a localized Agents section without reading the Remote eagerly', async () => {
    const subject = await bench()
    declareRoot(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = subject.slots.entries('settings.section')[0]!
    expect(entry.options).toMatchObject({ id: 'agents', order: 22 })
    expect(entry.locale).toBe('agents')
    expect(resolveSlotLabel(entry.options.label)).toBe('智能体')
    expect(subject.list).not.toHaveBeenCalled()
  })

  it('loads presets, catalog, and bindings, and surfaces failures', async () => {
    const subject = await bench()
    declareRoot(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = subject.slots.entries('settings.section')[0]!
    const face = (entry.inject as unknown as () => AgentsSectionInjected)()
    await expect(face.load()).resolves.toMatchObject({
      presets: [PRESET, BARE],
      bindings: { builder: BINDING },
    })
    expect(subject.list).toHaveBeenCalledOnce()
    expect(subject.modelCatalog).toHaveBeenCalledOnce()

    subject.list.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'nope' } })
    await expect(face.load()).rejects.toThrow('agentPresets/list failed: gateway/internal: nope')
    subject.modelCatalog.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'nope' } })
    await expect(face.load()).rejects.toThrow('session/modelCatalog failed: gateway/internal: nope')
    subject.listBindings.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'nope' } })
    await expect(face.load()).rejects.toThrow('agentModels/list failed: gateway/internal: nope')
  })

  it('binds and clears a preset route, and surfaces failures', async () => {
    const subject = await bench()
    declareRoot(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = subject.slots.entries('settings.section')[0]!
    const face = (entry.inject as unknown as () => AgentsSectionInjected)()
    await expect(face.save('builder', { provider: 'deepseek', model: 'deepseek-chat' })).resolves.toEqual({})
    expect(subject.setPreset).toHaveBeenCalledWith({ preset: 'builder', selection: { provider: 'deepseek', model: 'deepseek-chat' } })

    subject.setPreset.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'nope' } })
    await expect(face.save('builder', null)).rejects.toThrow('agentModels/setPreset failed: gateway/internal: nope')
  })
})
