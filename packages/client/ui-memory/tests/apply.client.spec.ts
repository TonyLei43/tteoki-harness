/** What the browser half registers, and its memory Remote calls. */

import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { KnowledgePanelInjected, MemorySectionInjected } from '@deepseek-ai/dsh-client-ui-memory/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

const SESSION = 's1' as SessionId

const SETTINGS = {
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
}
const STATUS = { documents: 1, chunks: 2, entities: 3, relations: 4, collections: [{ id: 'default', documents: 1 }], failures: [] }
const INDEX = { ...STATUS, skipped: 0 }
const SEARCH = { hits: [{ source: '/notes/a.md', collection: 'default', text: 'alpha', score: 0.9 }], entities: [{ name: 'Alpha', type: 'x', description: 'd', relations: [] }] }

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
    constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
  }
  new RemoteService(ctx)
  const getSettings = vi.fn<() => Promise<Result<typeof SETTINGS>>>().mockResolvedValue({ ok: true, value: SETTINGS })
  const status = vi.fn<() => Promise<Result<typeof STATUS>>>().mockResolvedValue({ ok: true, value: STATUS })
  const setSettings = vi.fn<() => Promise<Result<typeof SETTINGS>>>().mockResolvedValue({ ok: true, value: SETTINGS })
  const listModels = vi.fn<() => Promise<Result<{ models: string[] }>>>().mockResolvedValue({ ok: true, value: { models: ['embed-a'] } })
  const index = vi.fn<() => Promise<Result<typeof INDEX>>>().mockResolvedValue({ ok: true, value: INDEX })
  const search = vi.fn<() => Promise<Result<typeof SEARCH>>>().mockResolvedValue({ ok: true, value: SEARCH })
  const listNotes = vi.fn<() => Promise<Result<{ names: string[] }>>>().mockResolvedValue({ ok: true, value: { names: ['a'] } })
  const readNote = vi.fn<() => Promise<Result<{ content: string }>>>().mockResolvedValue({ ok: true, value: { content: 'body' } })
  const writeNote = vi.fn<() => Promise<Result<{ name: string }>>>().mockResolvedValue({ ok: true, value: { name: 'a' } })
  const previewPage = vi.fn<() => Promise<Result<{ image: string }>>>().mockResolvedValue({ ok: true, value: { image: 'data:image/png;base64,x' } })
  ctx.provide('remote.memory', { getSettings, status, setSettings, listModels, index, search, listNotes, readNote, writeNote, previewPage })
  type TextPage = { offset: number; text: string; lines: number; eof: boolean; absolutePath: string; version: string }
  const read = vi.fn<() => Promise<Result<TextPage>>>()
    .mockResolvedValue({ ok: true, value: { offset: 1, text: 'alpha', lines: 1, eof: true, absolutePath: '/notes/a.md', version: 'v1' } })
  ctx.provide('remote.workspaceFiles', { read })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, getSettings, status, setSettings, listModels, index, search, listNotes, readNote, writeNote, read }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' }, 'main': { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

afterEach(() => {})

describe('ui-memory browser plugin', () => {
  it('keeps the host Loader entry inert', () => { expect(hostApply).not.toThrow() })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.memory', 'remote.workspaceFiles'])
  })

  it('registers a localized Memory section without reading the Remote eagerly', async () => {
    const subject = await bench()
    declareRoot(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = subject.slots.entries('settings.section')[0]!
    expect(entry.options).toMatchObject({ id: 'memory', order: 23 })
    expect(entry.locale).toBe('memory')
    expect(resolveSlotLabel(entry.options.label)).toBe('记忆')
    expect(subject.getSettings).not.toHaveBeenCalled()
  })

  it('loads settings/status and every action, surfacing failures', async () => {
    const subject = await bench()
    declareRoot(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    const face = (subject.slots.entries('settings.section')[0]!.inject as unknown as () => MemorySectionInjected)()

    await expect(face.load()).resolves.toEqual({ settings: SETTINGS, status: STATUS })
    await expect(face.save({ model: 'x' })).resolves.toEqual(SETTINGS)
    await expect(face.listModels()).resolves.toEqual(['embed-a'])
    await expect(face.index('default')).resolves.toEqual(INDEX)
    await expect(face.index()).resolves.toEqual(INDEX)
    await expect(face.search('alpha')).resolves.toEqual(SEARCH)

    subject.getSettings.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'no' } })
    await expect(face.load()).rejects.toThrow('memory/getSettings failed')
    subject.status.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'no' } })
    await expect(face.load()).rejects.toThrow('memory/status failed')
    subject.setSettings.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'no' } })
    await expect(face.save({})).rejects.toThrow('memory/setSettings failed')
    subject.listModels.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'no' } })
    await expect(face.listModels()).rejects.toThrow('memory/listModels failed')
    subject.index.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'no' } })
    await expect(face.index()).rejects.toThrow('memory/index failed')
    subject.search.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'no' } })
    await expect(face.search('x')).rejects.toThrow('memory/search failed')
  })

  it('registers the Knowledge panel and its sidebar entry and wires every Remote call', async () => {
    const subject = await bench()
    declareRoot(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()

    const panel = subject.slots.entries('main').find(entry => (entry.options as { key?: string }).key === 'knowledge')!
    expect(panel.locale).toBe('knowledge')
    const nav = subject.slots.entries('sidebar.panellist').find(entry => (entry.options as { id?: string }).id === 'knowledge')!
    expect(resolveSlotLabel(nav.options.label)).toBe('Knowledge')

    const face = (panel.inject as unknown as () => KnowledgePanelInjected)()
    await expect(face.load()).resolves.toEqual({ collections: SETTINGS.collections, status: STATUS })
    await expect(face.search('alpha', undefined)).resolves.toEqual(SEARCH)
    await expect(face.search('alpha', ['default'])).resolves.toEqual(SEARCH)
    expect(subject.search).toHaveBeenLastCalledWith({ query: 'alpha', collections: ['default'] })
    await expect(face.index(undefined)).resolves.toEqual(INDEX)
    await expect(face.index(['default'])).resolves.toEqual(INDEX)
    expect(subject.index).toHaveBeenLastCalledWith({ collections: ['default'] })
    await expect(face.listNotes('default')).resolves.toEqual(['a'])
    await expect(face.readNote('default', 'a')).resolves.toBe('body')
    await expect(face.writeNote('default', 'a', 'x')).resolves.toBeUndefined()
    expect(subject.writeNote).toHaveBeenCalledWith({ collection: 'default', name: 'a', content: 'x' })
    await expect(face.previewPage('/n/a.pdf', 2)).resolves.toBe('data:image/png;base64,x')
    const signal = new AbortController().signal
    await expect(face.readDocument(SESSION, '/notes/a.md', signal)).resolves.toEqual({ text: 'alpha', truncated: false })

    subject.writeNote.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/bad-request', message: 'invalid memory name' } })
    await expect(face.writeNote('default', '../x', 'x')).rejects.toThrow('memory/writeNote failed: gateway/bad-request: invalid memory name')
    subject.read.mockResolvedValueOnce({ ok: false, error: { code: 'workspace-file/not-text', message: 'binary' } })
    await expect(face.readDocument(SESSION, '/notes/a.pdf', signal)).rejects.toThrow('workspaceFiles/read failed: workspace-file/not-text: binary')
  })

  it('pages a long document preview and stops at the cap', async () => {
    const subject = await bench()
    declareRoot(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    const face = (subject.slots.entries('main').find(entry => (entry.options as { key?: string }).key === 'knowledge')!.inject as unknown as () => KnowledgePanelInjected)()
    const signal = new AbortController().signal
    subject.read
      .mockResolvedValueOnce({ ok: true, value: { offset: 1, text: 'a', lines: 1, eof: false, absolutePath: '/n/a.txt', version: 'v' } })
      .mockResolvedValueOnce({ ok: true, value: { offset: 2, text: 'b', lines: 1, eof: true, absolutePath: '/n/a.txt', version: 'v' } })
    await expect(face.readDocument(SESSION, '/n/a.txt', signal)).resolves.toEqual({ text: 'a\nb', truncated: false })

    subject.read.mockResolvedValue({ ok: true, value: { offset: 1, text: 'x', lines: 1, eof: false, absolutePath: '/n/a.txt', version: 'v' } })
    expect(await face.readDocument(SESSION, '/n/a.txt', signal)).toMatchObject({ truncated: true })
    expect(subject.read).toHaveBeenCalledTimes(42)
  })
})
