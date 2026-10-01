// @vitest-environment jsdom
/** The Skills section: skills list, filtering, and npm skill-set management. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillsSection } from '../src/client/SkillsSection.tsx'
import type { SkillsSectionProps } from '../src/client/SkillsSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

type Injected = SkillsSectionProps extends never ? never : {
  load: SkillsSectionProps['load']
  loadSets: SkillsSectionProps['loadSets']
  installSet: SkillsSectionProps['installSet']
  removeSet: SkillsSectionProps['removeSet']
}

const t = (key: keyof typeof en) => en[key]

const demo = {
  name: 'demo',
  description: 'A demo skill.',
  source: 'user-dsh',
  provider: 'filesystem',
  modelInvocable: true,
  userInvocable: false,
}

const other = {
  name: 'alpha',
  description: 'Another skill.',
  source: 'bundled',
  provider: 'office',
  modelInvocable: false,
  userInvocable: true,
}

const withVersion = { name: '@acme/skills', spec: '@acme/skills@1.0.0', version: '1.0.0', skills: ['demo'], installedAt: '2026-01-01T00:00:00.000Z' }
const noVersion = { name: 'plain-skills', spec: 'plain-skills', skills: ['plain'], installedAt: '2026-01-01T00:00:00.000Z' }

function renderSection(overrides: Partial<Injected> = {}) {
  const injected: Injected = {
    load: async () => [demo, other],
    loadSets: async () => [],
    installSet: async () => [withVersion],
    removeSet: async () => [],
    ...overrides,
  }
  const props = { t, close: () => {}, ...injected } as SkillsSectionProps
  render(<SkillsSection {...props} />)
  return injected
}

describe('SkillsSection', () => {
  it('leads with its heading, intro, search field, and skill-set form', () => {
    renderSection()

    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByText(en.intro)).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()
    expect(screen.getByText(en.setsTitle)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.install })).toBeTruthy()
  })

  it('lists loaded skills sorted by name with invocation badges', async () => {
    renderSection()

    const items = await screen.findAllByRole('listitem')
    expect(items.map(item => item.querySelector('code')?.textContent)).toEqual(['alpha', 'demo'])
    expect(screen.getByText(en.userBadge)).toBeTruthy()
    expect(screen.getByText(en.modelBadge)).toBeTruthy()
    expect(screen.getByText('user-dsh · filesystem')).toBeTruthy()
  })

  it('filters by name and description, and reports no match', async () => {
    renderSection()
    await screen.findAllByRole('listitem')

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'another' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('alpha')).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.noMatch)).toBeTruthy()
  })

  it('reports an empty catalog and a load failure', async () => {
    renderSection({ load: async () => [], loadSets: async () => [] })
    expect(await screen.findByText(en.empty)).toBeTruthy()

    cleanup()
    renderSection({ load: async () => { throw new Error('down') } })
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
  })

  it('ignores a successful load that settles after unmount', async () => {
    let resolveLoad: (skills: readonly never[]) => void = () => {}
    let resolveSets: (sets: readonly never[]) => void = () => {}
    renderSection({
      load: () => new Promise<readonly never[]>((resolve) => { resolveLoad = resolve }),
      loadSets: () => new Promise<readonly never[]>((resolve) => { resolveSets = resolve }),
    })
    cleanup()
    resolveLoad([])
    resolveSets([])
    await Promise.resolve()
  })

  it('ignores a failed load that settles after unmount', async () => {
    let rejectSets: (error: Error) => void = () => {}
    renderSection({
      load: async () => [],
      loadSets: () => new Promise<never>((_resolve, reject) => { rejectSets = reject }),
    })
    cleanup()
    rejectSets(new Error('late'))
    await Promise.resolve()
  })

  it('lists installed skill sets with and without a version', async () => {
    renderSection({ load: async () => [], loadSets: async () => [withVersion, noVersion] })

    expect(await screen.findByText('@acme/skills')).toBeTruthy()
    expect(screen.getByText('@acme/skills@1.0.0 · 1.0.0')).toBeTruthy()
    expect(screen.getAllByText('plain-skills')).toHaveLength(2)
  })

  it('reports an empty skill-set list', async () => {
    renderSection({ load: async () => [], loadSets: async () => [] })
    expect(await screen.findByText(en.setsEmpty)).toBeTruthy()
  })

  it('installs a typed spec, disables the form while busy, and refreshes skills', async () => {
    const installSet = vi.fn(async () => [withVersion])
    const load = vi.fn(async () => [demo])
    renderSection({ load, loadSets: async () => [], installSet })

    await screen.findByRole('textbox', { name: en.specPlaceholder })
    const input = screen.getByRole('textbox', { name: en.specPlaceholder })
    const button = screen.getByRole('button', { name: en.install })
    expect(button).toHaveProperty('disabled', true)

    fireEvent.change(input, { target: { value: '@acme/skills' } })
    fireEvent.click(button)
    await waitFor(() => { expect(installSet).toHaveBeenCalledWith('@acme/skills') })
    await screen.findByText('@acme/skills')
    expect((input as HTMLInputElement).value).toBe('')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shows the installing label and a disabled control while an install is pending', async () => {
    let settle: (sets: readonly (typeof withVersion)[]) => void = () => {}
    const installSet = vi.fn(() => new Promise<readonly (typeof withVersion)[]>((resolve) => { settle = resolve }))
    renderSection({ load: async () => [], loadSets: async () => [], installSet })

    fireEvent.change(screen.getByRole('textbox', { name: en.specPlaceholder }), { target: { value: '@acme/skills' } })
    fireEvent.click(screen.getByRole('button', { name: en.install }))

    const pending = screen.getByRole('button', { name: en.installing })
    expect(pending).toHaveProperty('disabled', true)
    settle([withVersion])
    await screen.findByText('@acme/skills')
  })

  it('removes an installed skill set', async () => {
    const removeSet = vi.fn(async () => [])
    renderSection({ load: async () => [], loadSets: async () => [withVersion], removeSet })

    fireEvent.click(await screen.findByRole('button', { name: en.remove }))
    await waitFor(() => { expect(removeSet).toHaveBeenCalledWith('@acme/skills') })
    expect(await screen.findByText(en.setsEmpty)).toBeTruthy()
  })

  it('reports a failed install or removal', async () => {
    renderSection({
      load: async () => [],
      loadSets: async () => [withVersion],
      installSet: async () => { throw new Error('nope') },
      removeSet: async () => { throw new Error('nope') },
    })

    fireEvent.change(screen.getByRole('textbox', { name: en.specPlaceholder }), { target: { value: '@acme/skills' } })
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.actionError)

    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    await waitFor(() => { expect(screen.queryByRole('alert')?.textContent).toBe(en.actionError) })
  })
})
