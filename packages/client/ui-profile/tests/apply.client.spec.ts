// @vitest-environment jsdom
/** What the browser half registers, and the local profile hooks. */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProfileSectionInjected } from '@deepseek-ai/dsh-client-ui-profile/client'
import { apply, inject } from '../src/client/index.ts'
import { readProfile, writeProfile } from '../src/client/profile-storage.ts'
import { apply as hostApply } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  return { ctx, slots: ctx.get('slots') as SlotRegistry }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
}

afterEach(() => {
  globalThis.localStorage?.clear()
  writeProfile({ name: '', avatar: '' })
})

describe('ui-profile browser plugin', () => {
  it('keeps the host Loader entry inert', () => { expect(hostApply).not.toThrow() })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers a localized Profile section', async () => {
    const subject = await bench()
    declareRoot(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = subject.slots.entries('settings.section')[0]!
    expect(entry.options).toMatchObject({ id: 'profile', order: -5 })
    expect(entry.locale).toBe('profile')
    expect(resolveSlotLabel(entry.options.label)).toBe('个人资料')
  })


  it('tolerates unavailable storage on read and write', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('no storage') })
    expect(readProfile()).toEqual({ name: '', avatar: '' })
    get.mockRestore()

    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('no storage') })
    expect(() => { writeProfile({ name: 'x', avatar: 'y' }) }).not.toThrow()
    set.mockRestore()
  })
  it('exposes a stable profile snapshot and notifies subscribers', async () => {
    const subject = await bench()
    declareRoot(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    const face = (subject.slots.entries('settings.section')[0]!.inject as unknown as () => ProfileSectionInjected)()
    const { profile } = face.hooks

    const first = profile.getSnapshot()
    expect(first).toEqual({ name: '', avatar: '' })
    expect(profile.getSnapshot()).toBe(first)

    const listener = vi.fn()
    const off = profile.subscribe(listener)
    writeProfile({ name: 'Tony Lei', avatar: 'data:image/png;base64,AAAA' })
    expect(listener).toHaveBeenCalled()
    expect(profile.getSnapshot()).toEqual({ name: 'Tony Lei', avatar: 'data:image/png;base64,AAAA' })
    off()
  })
})
