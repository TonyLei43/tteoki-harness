// @vitest-environment jsdom
/** The Memory section: endpoint, workspaces, indexing, search, and failures. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemorySection } from '../src/client/MemorySection.tsx'
import type { MemorySectionProps } from '../src/client/MemorySection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

type Injected = {
  load: MemorySectionProps['load']
  save: MemorySectionProps['save']
  listModels: MemorySectionProps['listModels']
  index: MemorySectionProps['index']
  search: MemorySectionProps['search']
}

const t = (key: keyof typeof en) => en[key]

const settings = {
  baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'embed',
  apiKey: '',
  apiKeyEnv: 'OPENAI_API_KEY',
  chatModel: 'chat',
  graphEnabled: true,
  collections: [{ id: 'default', name: 'Notes', sources: ['/notes'] }],
  chunkChars: 1200,
  overlapChars: 200,
  topK: 6,
  excludeDirs: ['node_modules'],
  maxDocumentChars: 2_000_000,
  ocrConcurrency: 1,
}
const status = { documents: 1, chunks: 2, entities: 3, relations: 4, collections: [{ id: 'default', documents: 1 }], failures: [] }
const indexed = { ...status, skipped: 0 }

function renderSection(overrides: Partial<Injected> = {}) {
  const injected: Injected = {
    load: async () => ({ settings, status }),
    save: async () => settings,
    listModels: async () => ['embed-a', 'embed-b'],
    index: async () => indexed,
    search: async () => ({ hits: [], entities: [] }),
    ...overrides,
  }
  const props = { t, close: () => {}, ...injected } as MemorySectionProps
  render(<MemorySection {...props} />)
  return injected
}

describe('MemorySection', () => {
  it('renders the endpoint fields, workspaces, and status after loading', async () => {
    renderSection()
    expect(await screen.findByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: en.baseUrl })).toBeTruthy()
    expect((screen.getByRole('combobox', { name: en.model }) as HTMLInputElement).value).toBe('embed')
    expect(screen.getByLabelText(en.graph)).toBeTruthy()
    expect(screen.getByRole('textbox', { name: en.workspaceName })).toBeTruthy()
    expect(screen.getByText(/Documents: 1/)).toBeTruthy()
  })

  it('edits settings, marks unsaved, and saves', async () => {
    const save = vi.fn(async () => settings)
    renderSection({ save })
    const baseUrl = await screen.findByRole('combobox', { name: en.baseUrl })
    fireEvent.change(baseUrl, { target: { value: 'http://localhost:1234/v1' } })
    expect(screen.getByText(en.unsaved)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(save).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'http://localhost:1234/v1' })) })
    expect(screen.getByText(en.saved)).toBeTruthy()
  })

  it('sets and clears the OCR vision model', async () => {
    const save = vi.fn(async () => settings)
    renderSection({ save })
    const vision = await screen.findByRole('combobox', { name: en.visionModel })
    fireEvent.change(vision, { target: { value: 'qwen/qwen3.6-27b' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ visionModel: 'qwen/qwen3.6-27b' })) })
    fireEvent.change(screen.getByRole('combobox', { name: en.visionModel }), { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ visionModel: null })) })
  })

  it('toggles the graph flag and loads endpoint models', async () => {
    const listModels = vi.fn(async () => ['m1'])
    renderSection({ listModels })
    const graph = await screen.findByLabelText(en.graph)
    fireEvent.click(graph)
    expect(screen.getByText(en.unsaved)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.loadModels }))
    await waitFor(() => { expect(listModels).toHaveBeenCalledOnce() })
  })

  it('edits, adds, removes, and indexes workspaces', async () => {
    const index = vi.fn(async () => indexed)
    renderSection({ index })
    const name = await screen.findByRole('textbox', { name: en.workspaceName })
    fireEvent.change(name, { target: { value: 'Vault' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.sources }), { target: { value: '/a\n/b\n' } })

    fireEvent.click(screen.getByRole('button', { name: en.addWorkspace }))
    expect(screen.getAllByRole('textbox', { name: en.workspaceName })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: en.indexWorkspace })[0]!)
    await waitFor(() => { expect(index).toHaveBeenCalledWith('default') })

    fireEvent.click(screen.getAllByRole('button', { name: en.remove })[0]!)
    expect(screen.getAllByRole('textbox', { name: en.workspaceName })).toHaveLength(1)
  })

  it('reports a search failure', async () => {
    renderSection({ search: async () => { throw new Error('down') } })
    fireEvent.change(await screen.findByRole('textbox', { name: en.searchPlaceholder }), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: en.searchTitle }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
  })

  it('edits one workspace among several', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: en.addWorkspace }))
    const names = screen.getAllByRole('textbox', { name: en.workspaceName })
    fireEvent.change(names[0]!, { target: { value: 'Renamed' } })
    const sources = screen.getAllByRole('textbox', { name: en.sources })
    fireEvent.change(sources[0]!, { target: { value: '/x' } })
    expect(screen.getByText(en.unsaved)).toBeTruthy()
  })

  it('indexes everything and reports empty status', async () => {
    renderSection({ load: async () => ({ settings, status: { ...status, documents: 0, chunks: 0, entities: 0, relations: 0, collections: [] } }) })
    await screen.findByRole('heading', { name: en.title })
    await waitFor(() => { expect(screen.getByText(en.noIndex)).toBeTruthy() })

    const index = vi.fn(async () => indexed)
    cleanup()
    renderSection({ index })
    fireEvent.click(await screen.findByRole('button', { name: en.indexAll }))
    await waitFor(() => { expect(index).toHaveBeenCalledOnce() })
  })

  it('searches and shows passages, related entities, and no-match', async () => {
    const search = vi.fn(async () => ({
      hits: [{ source: '/a.md', collection: 'default', heading: 'H', text: 'alpha body', score: 0.9 }],
      entities: [{ name: 'Alpha', type: 'x', description: 'd', relations: ['r'] }],
    }))
    renderSection({ search })
    const box = await screen.findByRole('textbox', { name: en.searchPlaceholder })
    expect(screen.getByRole('button', { name: en.searchTitle })).toHaveProperty('disabled', true)
    fireEvent.change(box, { target: { value: 'alpha' } })
    fireEvent.click(screen.getByRole('button', { name: en.searchTitle }))
    await waitFor(() => { expect(search).toHaveBeenCalledWith('alpha') })
    expect(screen.getByText('alpha body')).toBeTruthy()
    expect(screen.getByText(new RegExp(`${en.related}: Alpha`))).toBeTruthy()

    cleanup()
    renderSection()
    fireEvent.change(await screen.findByRole('textbox', { name: en.searchPlaceholder }), { target: { value: 'zzz' } })
    fireEvent.click(screen.getByRole('button', { name: en.searchTitle }))
    expect(await screen.findByText(en.noResults)).toBeTruthy()
  })

  it('reports a load failure and an action failure', async () => {
    renderSection({ load: async () => { throw new Error('down') } })
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)

    cleanup()
    renderSection({ save: async () => { throw new Error('down') } })
    fireEvent.change(await screen.findByRole('combobox', { name: en.baseUrl }), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
  })

  it('shows pending labels and ignores a second action while busy', async () => {
    const deferred = <T,>() => {
      let resolve: (value: T) => void = () => {}
      const promise = new Promise<T>((settle) => { resolve = settle })
      return { promise, resolve }
    }
    const saveGate = deferred<typeof settings>()
    const indexGate = deferred<typeof indexed>()
    const searchGate = deferred<{ hits: []; entities: [] }>()
    const modelsGate = deferred<string[]>()
    renderSection({
      save: () => saveGate.promise,
      index: () => indexGate.promise,
      search: () => searchGate.promise,
      listModels: () => modelsGate.promise,
    })

    fireEvent.change(await screen.findByRole('combobox', { name: en.baseUrl }), { target: { value: 'x' } })
    const save = screen.getByRole('button', { name: en.save })
    fireEvent.click(save)
    fireEvent.click(save)
    await waitFor(() => { expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true) })
    saveGate.resolve(settings)
    await waitFor(() => { expect(screen.getByText(en.saved)).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en.loadModels }))
    expect(screen.getByRole('button', { name: en.loadingModels })).toBeTruthy()
    modelsGate.resolve(['m'])
    await waitFor(() => { expect(screen.getByRole('button', { name: en.loadModels })).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en.indexAll }))
    expect(screen.getByRole('button', { name: en.indexing })).toBeTruthy()
    indexGate.resolve(indexed)
    await waitFor(() => { expect(screen.getByRole('button', { name: en.indexAll })).toBeTruthy() })

    fireEvent.change(screen.getByRole('textbox', { name: en.searchPlaceholder }), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: en.searchTitle }))
    expect(screen.getByRole('button', { name: en.searching })).toBeTruthy()
    searchGate.resolve({ hits: [], entities: [] })
    await screen.findByText(en.noResults)
  })

  it('renders a workspace without a stored count and a hit without a heading', async () => {
    renderSection({
      load: async () => ({ settings, status: { ...status, collections: [] } }),
      search: async () => ({ hits: [{ source: '/a.md', collection: 'default', text: 'body', score: 0.5 }], entities: [] }),
    })
    expect(await screen.findByText('default')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: en.searchPlaceholder }), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: en.searchTitle }))
    expect(await screen.findByText('body')).toBeTruthy()
  })

  it('edits model, API key, and chat model, and reports model-load and action failures', async () => {
    const listModels = vi.fn(async () => { throw new Error('down') })
    renderSection({ listModels, index: async () => { throw new Error('down') }, search: async () => { throw new Error('down') } })

    fireEvent.change(await screen.findByRole('combobox', { name: en.model }), { target: { value: 'm2' } })
    fireEvent.change(screen.getByLabelText(en.apiKey), { target: { value: 'k' } })
    fireEvent.change(screen.getByLabelText(en.chatModel), { target: { value: 'c2' } })
    expect(screen.getByText(en.unsaved)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.loadModels }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)

    fireEvent.click(screen.getByRole('button', { name: en.indexAll }))
    fireEvent.click(screen.getAllByRole('button', { name: en.indexWorkspace })[0]!)
    fireEvent.change(screen.getByRole('textbox', { name: en.searchPlaceholder }), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: en.searchTitle }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en.error) })
  })

  it('ignores a second index or model load while busy', async () => {
    let resolveIndex: (value: typeof indexed) => void = () => {}
    let resolveModels: (value: string[]) => void = () => {}
    const index = vi.fn(() => new Promise<typeof indexed>((resolve) => { resolveIndex = resolve }))
    const listModels = vi.fn(() => new Promise<string[]>((resolve) => { resolveModels = resolve }))
    renderSection({ index, listModels })

    const indexAll = await screen.findByRole('button', { name: en.indexAll })
    fireEvent.click(indexAll)
    fireEvent.click(screen.getByRole('button', { name: en.indexing }))
    expect(index).toHaveBeenCalledTimes(1)
    resolveIndex(indexed)
    await waitFor(() => { expect(screen.getByRole('button', { name: en.indexAll })).toBeTruthy() })

    const loadModels = screen.getByRole('button', { name: en.loadModels })
    fireEvent.click(loadModels)
    fireEvent.click(screen.getByRole('button', { name: en.loadingModels }))
    expect(listModels).toHaveBeenCalledTimes(1)
    resolveModels([])
    await waitFor(() => { expect(screen.getByRole('button', { name: en.loadModels })).toBeTruthy() })
  })

  it('ignores loads that settle after unmount', async () => {
    let resolveLoad: (v: { settings: typeof settings; status: typeof status }) => void = () => {}
    let rejectLoad: (error: Error) => void = () => {}
    renderSection({ load: () => new Promise((resolve) => { resolveLoad = resolve }) })
    cleanup()
    resolveLoad({ settings, status })
    await Promise.resolve()

    cleanup()
    renderSection({ load: () => new Promise<never>((_resolve, reject) => { rejectLoad = reject }) })
    cleanup()
    rejectLoad(new Error('late'))
    await Promise.resolve()
  })
})
