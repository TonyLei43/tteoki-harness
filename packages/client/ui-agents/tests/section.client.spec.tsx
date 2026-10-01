// @vitest-environment jsdom
/** The Agents section: listing presets, binding routes, and failure states. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentsSection } from '../src/client/AgentsSection.tsx'
import type { AgentsSectionProps } from '../src/client/AgentsSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

type Injected = {
  load: AgentsSectionProps['load']
  save: AgentsSectionProps['save']
}

const t = (key: keyof typeof en) => en[key]

const preset = { id: 'builder', name: 'Builder', description: 'Builds things.', isDefault: true }
const options = [{ provider: 'deepseek', providerName: 'DeepSeek', model: 'deepseek-chat', modelName: 'DeepSeek Chat' }]

function renderSection(overrides: Partial<Injected> = {}) {
  const injected: Injected = {
    load: async () => ({ presets: [preset], options, bindings: {} }),
    save: async () => ({}),
    ...overrides,
  }
  const props = { t, close: () => {}, ...injected } as AgentsSectionProps
  render(<AgentsSection {...props} />)
  return injected
}

describe('AgentsSection', () => {
  it('leads with its heading and intro', () => {
    renderSection()
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByText(en.intro)).toBeTruthy()
  })

  it('lists presets with a route picker defaulting to Default', async () => {
    renderSection()
    const select = await screen.findByRole('combobox', { name: 'Builder' })
    expect((select as HTMLSelectElement).value).toBe('')
    expect(screen.getByRole('option', { name: en.default })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'DeepSeek — DeepSeek Chat' })).toBeTruthy()
  })

  it('shows the stored binding as the selected route', async () => {
    renderSection({ load: async () => ({ presets: [preset], options, bindings: { builder: { provider: 'deepseek', model: 'deepseek-chat' } } }) })
    const select = await screen.findByRole('combobox', { name: 'Builder' })
    expect((select as HTMLSelectElement).value).toBe('deepseek::deepseek-chat')
  })

  it('binds a chosen route and clears back to Default', async () => {
    const save = vi.fn(async () => ({ builder: { provider: 'deepseek', model: 'deepseek-chat' } }))
    renderSection({ save })
    const select = await screen.findByRole('combobox', { name: 'Builder' })

    fireEvent.change(select, { target: { value: 'deepseek::deepseek-chat' } })
    await waitFor(() => { expect(save).toHaveBeenCalledWith('builder', { provider: 'deepseek', model: 'deepseek-chat' }) })

    fireEvent.change(select, { target: { value: '' } })
    await waitFor(() => { expect(save).toHaveBeenCalledWith('builder', null) })
  })

  it('reports an empty roster and a load failure', async () => {
    renderSection({ load: async () => ({ presets: [], options: [], bindings: {} }) })
    expect(await screen.findByText(en.empty)).toBeTruthy()

    cleanup()
    renderSection({ load: async () => { throw new Error('down') } })
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
  })

  it('reports a failed save', async () => {
    renderSection({ save: async () => { throw new Error('nope') } })
    const select = await screen.findByRole('combobox', { name: 'Builder' })
    fireEvent.change(select, { target: { value: 'deepseek::deepseek-chat' } })
    expect((await screen.findByRole('alert')).textContent).toBe(en.actionError)
  })

  it('ignores a load that settles after unmount', async () => {
    let rejectLoad: (error: Error) => void = () => {}
    renderSection({ load: () => new Promise<never>((_resolve, reject) => { rejectLoad = reject }) })
    cleanup()
    rejectLoad(new Error('late'))
    await Promise.resolve()
  })

  it('ignores a successful load that settles after unmount', async () => {
    type Loaded = Awaited<ReturnType<AgentsSectionProps['load']>>
    let resolveLoad: (state: Loaded) => void = () => {}
    renderSection({ load: () => new Promise<Loaded>((resolve) => { resolveLoad = resolve }) })
    cleanup()
    resolveLoad({ presets: [], options: [], bindings: {} })
    await Promise.resolve()
  })

  it('falls back to the preset id when metadata is absent', async () => {
    renderSection({ load: async () => ({ presets: [{ id: 'bare', isDefault: false }], options, bindings: {} }) })
    const select = await screen.findByRole('combobox', { name: 'bare' })
    expect(select).toBeTruthy()
    expect(screen.getAllByText('bare').length).toBeGreaterThan(0)
  })
})
