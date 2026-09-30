/** Skill-set install, removal, manifest bookkeeping, and the runner. */

import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { SkillSets } from '../src/index.ts'
import { runPnpm } from '../src/run.ts'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** Create an isolated harness home and a staging project. */
function bench(stub?: (staging: string) => void, withManifest = true) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-skill-sets-'))
  const staging = join(home, 'skill-sets')
  cleanups.push(() => { rmSync(home, { recursive: true, force: true }) })
  mkdirSync(staging, { recursive: true })
  if (withManifest) {
    writeFileSync(join(staging, 'package.json'), JSON.stringify({ name: 'dsh-skill-sets', version: '0.0.0', private: true }))
  }
  const runPnpmStub = vi.fn<(args: readonly string[], cwd: string, signal: AbortSignal) => Promise<void>>(async () => { stub?.(staging) })
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const service = new SkillSets(ctx, { home }, { runPnpm: runPnpmStub })
  return { home, staging, service, runPnpmStub }
}

/** Materialize a fake installed package that ships a skills/ directory. */
function shipSkills(staging: string, name: string, files: Record<string, string>, version?: string): void {
  const pkgDir = join(staging, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  if (version !== undefined) writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version }))
  for (const [relative, content] of Object.entries(files)) {
    const target = join(pkgDir, 'skills', relative)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, content)
  }
  const manifest = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
  manifest.dependencies = { ...manifest.dependencies, [name]: version ?? '1.0.0' }
  writeFileSync(join(staging, 'package.json'), JSON.stringify(manifest))
}

/** Seed a dependency into the staging manifest before an install run. */
function seedDependency(staging: string, name: string, version: string): void {
  const manifest = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
  manifest.dependencies = { ...manifest.dependencies, [name]: version }
  writeFileSync(join(staging, 'package.json'), JSON.stringify(manifest))
}

const signal = new AbortController().signal

describe('SkillSets', () => {
  it('lists nothing before any install', async () => {
    const subject = bench()
    await expect(subject.service.list()).resolves.toEqual({ sets: [] })
  })

  it('installs a package\'s skills into the user root and records the set', async () => {
    const subject = bench((staging) => {
      shipSkills(staging, 'demo-skills', { 'alpha/SKILL.md': '# Alpha', 'beta.md': '# Beta' }, '1.2.3')
    })
    const value = await subject.service.install({ spec: 'demo-skills@1.2.3' }, signal)

    expect(value.sets).toHaveLength(1)
    expect(value.sets[0]).toMatchObject({ name: 'demo-skills', spec: 'demo-skills@1.2.3', version: '1.2.3', skills: ['alpha', 'beta'] })
    expect(existsSync(join(subject.home, 'skills', 'alpha', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(subject.home, 'skills', 'beta.md'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(subject.staging, 'manifest.json'), 'utf8')) as { sets: unknown[] }
    expect(manifest.sets).toHaveLength(1)
  })

  it('resolves a scoped spec and keeps the recorded version optional', async () => {
    const subject = bench((staging) => {
      shipSkills(staging, '@acme/kit', { 'gamma/SKILL.md': '# Gamma' })
    })
    const value = await subject.service.install({ spec: '@acme/kit' }, signal)
    expect(value.sets[0]).toMatchObject({ name: '@acme/kit', skills: ['gamma'] })
    expect(value.sets[0]!.version).toBeUndefined()
  })

  it('falls back to the spec name when the dependency map is unchanged', async () => {
    const subject = bench((staging) => {
      shipSkills(staging, 'kept-skills', { 'kept/SKILL.md': '# Kept' }, '2.0.0')
    })
    seedDependency(subject.staging, 'kept-skills', '2.0.0')
    const value = await subject.service.install({ spec: 'kept-skills@2.0.0' }, signal)
    expect(value.sets[0]).toMatchObject({ name: 'kept-skills', skills: ['kept'] })
  })

  it('rejects an invalid spec', async () => {
    const subject = bench()
    await expect(subject.service.install({ spec: '  ' }, signal)).rejects.toThrow('a non-empty npm spec is required')
    await expect(subject.service.install({ spec: '--flag' }, signal)).rejects.toThrow('a non-empty npm spec is required')
  })

  it('reports a package that ships no skills', async () => {
    const subject = bench((staging) => {
      const manifest = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
      manifest.dependencies = { empty: '1.0.0' }
      writeFileSync(join(staging, 'package.json'), JSON.stringify(manifest))
      mkdirSync(join(staging, 'node_modules', 'empty'), { recursive: true })
    })
    await expect(subject.service.install({ spec: 'empty' }, signal)).rejects.toThrow('ships no skills to install')
  })

  it('reports a spec that adds no package', async () => {
    const subject = bench()
    await expect(subject.service.install({ spec: 'ghost' }, signal)).rejects.toThrow('did not add a package')
  })

  it('removes an installed set and every skill it contributed', async () => {
    const subject = bench((staging) => {
      shipSkills(staging, 'demo-skills', { 'alpha/SKILL.md': '# Alpha', 'beta.md': '# Beta' }, '1.0.0')
    })
    await subject.service.install({ spec: 'demo-skills' }, signal)
    const value = await subject.service.remove({ name: 'demo-skills' }, signal)

    expect(value.sets).toEqual([])
    expect(existsSync(join(subject.home, 'skills', 'alpha'))).toBe(false)
    expect(existsSync(join(subject.home, 'skills', 'beta.md'))).toBe(false)
    expect(JSON.parse(readFileSync(join(subject.staging, 'manifest.json'), 'utf8'))).toEqual({ version: 1, sets: [] })
  })

  it('rejects removing a set that is not installed', async () => {
    const subject = bench()
    await expect(subject.service.remove({ name: 'missing' }, signal)).rejects.toThrow('is not installed')
  })

  it('passes the configured registry through to the install run', async () => {
    const subject = bench((staging) => {
      shipSkills(staging, 'demo-skills', { 'alpha/SKILL.md': '# Alpha' })
    })
    const service = new SkillSets(new Context(), { home: subject.home, registry: 'https://registry.example/' }, { runPnpm: subject.runPnpmStub })
    await service.install({ spec: 'demo-skills' }, signal)
    expect(subject.runPnpmStub).toHaveBeenCalledWith(['add', 'demo-skills', '--registry=https://registry.example/'], subject.staging, signal)
  })
  it('creates the staging manifest when it is absent', async () => {
    const subject = bench((staging) => {
      shipSkills(staging, 'demo-skills', { 'alpha/SKILL.md': '# Alpha' })
    }, false)
    await subject.service.install({ spec: 'demo-skills' }, signal)
    expect(existsSync(join(subject.staging, 'package.json'))).toBe(true)
  })

  it('rejects a corrupt installed-set manifest', async () => {
    const subject = bench()
    writeFileSync(join(subject.staging, 'manifest.json'), 'not json')
    await expect(subject.service.list()).rejects.toThrow()
  })

  it('rejects an installed package whose manifest is corrupt', async () => {
    const subject = bench((staging) => {
      const pkgDir = join(staging, 'node_modules', 'demo-skills')
      mkdirSync(join(pkgDir, 'skills', 'alpha'), { recursive: true })
      writeFileSync(join(pkgDir, 'skills', 'alpha', 'SKILL.md'), '# Alpha')
      writeFileSync(join(pkgDir, 'package.json'), 'not json')
      const manifest = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
      manifest.dependencies = { 'demo-skills': '1.0.0' }
      writeFileSync(join(staging, 'package.json'), JSON.stringify(manifest))
    })
    await expect(subject.service.install({ spec: 'demo-skills' }, signal)).rejects.toThrow()
  })

  it('rejects when a package ships a skills path that is not a directory', async () => {
    const subject = bench((staging) => {
      const pkgDir = join(staging, 'node_modules', 'demo-skills')
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(join(pkgDir, 'skills'), 'not a directory')
      const manifest = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
      manifest.dependencies = { 'demo-skills': '1.0.0' }
      writeFileSync(join(staging, 'package.json'), JSON.stringify(manifest))
    })
    await expect(subject.service.install({ spec: 'demo-skills' }, signal)).rejects.toThrow()
  })

  it('falls back to a scoped spec already present in the dependency map', async () => {
    const subject = bench((staging) => {
      shipSkills(staging, '@acme/kept', { 'kept/SKILL.md': '# Kept' }, '1.0.0')
    })
    seedDependency(subject.staging, '@acme/kept', '1.0.0')
    const value = await subject.service.install({ spec: '@acme/kept@1.0.0' }, signal)
    expect(value.sets[0]).toMatchObject({ name: '@acme/kept' })
  })

  it('falls back to a scoped spec name without a version', async () => {
    const subject = bench((staging) => {
      shipSkills(staging, '@acme/kept', { 'kept/SKILL.md': '# Kept' }, '1.0.0')
    })
    seedDependency(subject.staging, '@acme/kept', '1.0.0')
    const value = await subject.service.install({ spec: '@acme/kept' }, signal)
    expect(value.sets[0]).toMatchObject({ name: '@acme/kept' })
  })

  it('rejects a scope-only spec that adds no package', async () => {
    const subject = bench()
    await expect(subject.service.install({ spec: '@scope' }, signal)).rejects.toThrow('did not add a package')
  })

  it('removes skills even when the staging removal fails', async () => {
    const subject = bench((staging) => {
      shipSkills(staging, 'demo-skills', { 'alpha/SKILL.md': '# Alpha' }, '1.0.0')
    })
    await subject.service.install({ spec: 'demo-skills' }, signal)
    subject.runPnpmStub.mockRejectedValueOnce(new Error('remove failed'))
    const value = await subject.service.remove({ name: 'demo-skills' }, signal)
    expect(value.sets).toEqual([])
    expect(existsSync(join(subject.home, 'skills', 'alpha'))).toBe(false)
  })

  it('ignores skill entries that are neither directories nor markdown files', async () => {
    const subject = bench((staging) => {
      shipSkills(staging, 'demo-skills', { 'alpha/SKILL.md': '# Alpha' }, '1.0.0')
      symlinkSync(
        join(staging, 'node_modules', 'demo-skills', 'skills', 'alpha', 'SKILL.md'),
        join(staging, 'node_modules', 'demo-skills', 'skills', 'link'),
      )
    })
    const value = await subject.service.install({ spec: 'demo-skills' }, signal)
    expect(value.sets[0]).toMatchObject({ skills: ['alpha'] })
  })

  it('runs the configured package-manager command by default', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-skill-sets-run-'))
    cleanups.push(() => { rmSync(home, { recursive: true, force: true }) })
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const service = new SkillSets(ctx, { home, pnpmCommand: '/bin/false' })
    await expect(service.install({ spec: 'demo' }, signal)).rejects.toThrow('failed')
  })

  it('resolves the harness home from the environment when none is configured', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-skill-sets-env-'))
    cleanups.push(() => { rmSync(home, { recursive: true, force: true }) })
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    cleanups.push(() => {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    })
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const service = new SkillSets(ctx, {}, { runPnpm: vi.fn() })
    await expect(service.list()).resolves.toEqual({ sets: [] })
  })

  it('fails when the staging manifest path is unreadable', async () => {
    const subject = bench(undefined, false)
    mkdirSync(join(subject.staging, 'package.json'))
    await expect(subject.service.install({ spec: 'demo' }, signal)).rejects.toThrow()
  })

  it('keeps sets name-ordered and replaces a reinstall', async () => {
    const subject = bench((staging) => {
      shipSkills(staging, 'beta-skills', { 'b/SKILL.md': '# B' }, '1.0.0')
    })
    await subject.service.install({ spec: 'beta-skills' }, signal)
    subject.runPnpmStub.mockImplementationOnce(async (_args, staging) => {
      shipSkills(staging, 'alpha-skills', { 'a/SKILL.md': '# A' }, '1.0.0')
    })
    await subject.service.install({ spec: 'alpha-skills' }, signal)
    subject.runPnpmStub.mockImplementationOnce(async (_args, staging) => {
      shipSkills(staging, 'beta-skills', { 'b/SKILL.md': '# B2' }, '2.0.0')
    })
    const value = await subject.service.install({ spec: 'beta-skills@2.0.0' }, signal)

    expect(value.sets.map(set => set.name)).toEqual(['alpha-skills', 'beta-skills'])
    expect(value.sets[1]!.version).toBe('2.0.0')
  })
})

describe('runPnpm', () => {
  it('resolves on a successful command and rejects on a failing one', async () => {
    await expect(runPnpm('/bin/echo', ['ok'], process.cwd(), signal, 5000)).resolves.toBeUndefined()
    await expect(runPnpm('/bin/false', [], process.cwd(), signal, 5000)).rejects.toThrow('failed')
  })
})
