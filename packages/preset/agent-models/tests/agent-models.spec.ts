/** Per-preset model binding store: read, write, clear, and resolution. */

import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { AgentModels } from '../src/index.ts'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** Create an isolated harness home and the binding service. */
function bench() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-agent-models-'))
  cleanups.push(() => { rmSync(home, { recursive: true, force: true }) })
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  return { home, ctx, service: new AgentModels(ctx, { home }) }
}

describe('AgentModels', () => {
  it('starts empty', async () => {
    const subject = bench()
    await expect(subject.service.list()).resolves.toEqual({ bindings: {} })
    expect(subject.service.resolveFor('builder')).toBeUndefined()
    expect(subject.service.resolveFor(undefined)).toBeUndefined()
  })

  it('binds a preset route and resolves it synchronously', async () => {
    const subject = bench()
    const value = await subject.service.setPreset({ preset: 'builder', selection: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' } })

    expect(value).toEqual({ bindings: { builder: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' } } })
    expect(subject.service.resolveFor('builder')).toEqual({ provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' })
    await expect(subject.service.list()).resolves.toEqual(value)
  })

  it('trims the preset id and drops a blank effort', async () => {
    const subject = bench()
    const value = await subject.service.setPreset({ preset: '  builder  ', selection: { provider: 'deepseek', model: 'chat', reasoningEffort: '   ' } })
    expect(value.bindings['builder']).toEqual({ provider: 'deepseek', model: 'chat' })
  })

  it('clears a preset binding', async () => {
    const subject = bench()
    await subject.service.setPreset({ preset: 'builder', selection: { provider: 'deepseek', model: 'chat' } })
    const value = await subject.service.setPreset({ preset: 'builder', selection: null })
    expect(value).toEqual({ bindings: {} })
    expect(subject.service.resolveFor('builder')).toBeUndefined()
  })

  it('rejects an empty preset id and an incomplete route', async () => {
    const subject = bench()
    await expect(subject.service.setPreset({ preset: '   ', selection: null })).rejects.toThrow('a non-empty preset id is required')
    await expect(subject.service.setPreset({ preset: 'builder', selection: { provider: ' ', model: 'chat' } })).rejects.toThrow('a provider and model are required')
  })

  it('adopts an existing store and treats a corrupt one as empty', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-agent-models-seed-'))
    cleanups.push(() => { rmSync(home, { recursive: true, force: true }) })
    const bindings = { builder: { provider: 'deepseek', model: 'chat' } }
    writeFileSync(join(home, 'agent-models.json'), JSON.stringify({ version: 1, bindings }))
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const seeded = new AgentModels(ctx, { home })
    await expect(seeded.list()).resolves.toEqual({ bindings })
    expect(seeded.resolveFor('builder')).toEqual({ provider: 'deepseek', model: 'chat' })

    writeFileSync(join(home, 'agent-models.json'), 'not json')
    const broken = new AgentModels(new Context(), { home })
    await expect(broken.list()).resolves.toEqual({ bindings: {} })
  })

  it('resolves the harness home from the environment when none is configured', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-agent-models-env-'))
    cleanups.push(() => { rmSync(home, { recursive: true, force: true }) })
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    cleanups.push(() => {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    })
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const service = new AgentModels(ctx, {})
    await expect(service.list()).resolves.toEqual({ bindings: {} })
  })
})
