/** What the browser half registers, and that its Remote reads stay lazy. */

import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillsSectionInjected } from '@deepseek-ai/dsh-client-ui-skills/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

const ENTRY = {
  name: 'demo',
  description: 'A demo skill.',
  source: 'user-dsh',
  provider: 'filesystem',
  modelInvocable: true,
  userInvocable: true,
}

const SET = {
  name: '@acme/skills',
  spec: '@acme/skills@1.0.0',
  version: '1.0.0',
  skills: ['demo'],
  installedAt: '2026-01-01T00:00:00.000Z',
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
  const inventory = vi.fn<() => Promise<Result<{ skills: (typeof ENTRY)[] }>>>()
    .mockResolvedValue({ ok: true, value: { skills: [ENTRY] } })
  ctx.provide('remote.skills', { inventory })
  const list = vi.fn<() => Promise<Result<{ sets: (typeof SET)[] }>>>()
    .mockResolvedValue({ ok: true, value: { sets: [SET] } })
  const installSet = vi.fn<() => Promise<Result<{ sets: (typeof SET)[] }>>>()
    .mockResolvedValue({ ok: true, value: { sets: [SET] } })
  const removeSet = vi.fn<() => Promise<Result<{ sets: (typeof SET)[] }>>>()
    .mockResolvedValue({ ok: true, value: { sets: [] } })
  ctx.provide('remote.skillSets', { list, installSet, removeSet })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, inventory, list, installSet, removeSet }
}

/** The Settings shell's section slot, as its owner declares it. */
function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

afterEach(() => {})

describe('ui-skills browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.skills', 'remote.skillSets'])
  })

  it('registers a localized Skills section without reading the Remote eagerly', async () => {
    const subject = await bench()
    declareRoot(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = subject.slots.entries('settings.section')[0]!
    expect(entry.options).toMatchObject({ id: 'skills', order: 25 })
    expect(entry.locale).toBe('skills')
    expect(resolveSlotLabel(entry.options.label)).toBe('技能')
    expect(subject.inventory).not.toHaveBeenCalled()
    expect(subject.list).not.toHaveBeenCalled()
  })

  it('loads inventory and sets, and surfaces failures', async () => {
    const subject = await bench()
    declareRoot(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = subject.slots.entries('settings.section')[0]!
    const face = (entry.inject as unknown as () => SkillsSectionInjected)()
    await expect(face.load()).resolves.toEqual([ENTRY])
    await expect(face.loadSets()).resolves.toEqual([SET])
    expect(subject.inventory).toHaveBeenCalledOnce()
    expect(subject.list).toHaveBeenCalledOnce()

    subject.inventory.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'nope' } })
    await expect(face.load()).rejects.toThrow('skills/inventory failed: gateway/internal: nope')
    subject.list.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'nope' } })
    await expect(face.loadSets()).rejects.toThrow('skillSets/list failed: gateway/internal: nope')
  })

  it('installs and removes skill sets through the Remote namespace', async () => {
    const subject = await bench()
    declareRoot(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = subject.slots.entries('settings.section')[0]!
    const face = (entry.inject as unknown as () => SkillsSectionInjected)()
    await expect(face.installSet('@acme/skills')).resolves.toEqual([SET])
    expect(subject.installSet).toHaveBeenCalledWith({ spec: '@acme/skills' })
    await expect(face.removeSet('@acme/skills')).resolves.toEqual([])
    expect(subject.removeSet).toHaveBeenCalledWith({ name: '@acme/skills' })

    subject.installSet.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'nope' } })
    await expect(face.installSet('@acme/skills')).rejects.toThrow('skillSets/installSet failed: gateway/internal: nope')
    subject.removeSet.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'nope' } })
    await expect(face.removeSet('@acme/skills')).rejects.toThrow('skillSets/removeSet failed: gateway/internal: nope')
  })
})
