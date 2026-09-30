/** Knowledge bases: settings, chunking, ingestion, indexing, graph, search, and memory notes. */

import { Context } from '@deepseek-ai/cordis'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { chunkMarkdown } from '../src/chunk.ts'
import { embedAll, embedTexts, listModels } from '../src/embed.ts'
import { chatComplete, extractGraph, parseGraph } from '../src/extract.ts'
import { Memory, plainMarkdown } from '../src/index.ts'
import { cleanLatex, cleanMarkdown, ExtractorTable, type Extractor } from '../src/ingest.ts'

const cleanups: Array<() => void> = []
afterEach(() => {
  vi.unstubAllGlobals()
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** Deterministic 4-dimensional vector for a text. */
function vectorFor(text: string): number[] {
  return [text.length % 7, (text.match(/a/g) ?? []).length, 1, text.length % 3 + 1]
}

const GRAPH_JSON = JSON.stringify({
  entities: [{ name: 'Alpha', type: 'concept', description: 'A thing' }],
  relations: [{ source: 'Alpha', target: 'Beta', description: 'relates to' }],
})

/** Stub global fetch with embeddings, models, and chat handlers. */
function stubFetch(handler?: (url: string, init: RequestInit) => Response | undefined): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const handled = handler?.(url, init ?? {})
    if (handled !== undefined) return handled
    if (url.endsWith('/embeddings')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input: string[] }
      return new Response(JSON.stringify({ data: body.input.map((text, index) => ({ embedding: vectorFor(text), index })) }), { status: 200 })
    }
    if (url.endsWith('/chat/completions')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: GRAPH_JSON } }] }), { status: 200 })
    }
    if (url.endsWith('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'embed-a' }, { id: 'embed-b' }] }), { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }))
}

/** Create an isolated harness home, one source directory, and the service. */
function bench() {
  stubFetch()
  const home = mkdtempSync(join(tmpdir(), 'dsh-memory-'))
  const source = join(home, 'notes')
  mkdirSync(source, { recursive: true })
  cleanups.push(() => { rmSync(home, { recursive: true, force: true }) })
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  return { home, source, ctx, service: new Memory(ctx, { home }) }
}

/** One collection covering a source directory. */
function collection(source: string, id = 'default', name = 'Default') {
  return { id, name, sources: [source] }
}

describe('chunkMarkdown', () => {
  it('keeps heading context and packs paragraphs near the target', () => {
    const chunks = chunkMarkdown('# Title\n\nFirst para.\n\nSecond para.\n\n## Sub\n\nThird para.', 1000, 100)
    expect(chunks).toEqual([
      { heading: 'Title', text: 'First para.\n\nSecond para.' },
      { heading: 'Sub', text: 'Third para.' },
    ])
  })

  it('splits an oversized block with overlap', () => {
    const chunks = chunkMarkdown('x'.repeat(250), 100, 20)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]!.text).toHaveLength(100)
    expect(chunks[0]!.heading).toBeUndefined()
  })

  it('returns nothing for empty content and keeps a short block whole', () => {
    expect(chunkMarkdown('   \n\n  ', 500, 50)).toEqual([])
    expect(chunkMarkdown('short text', 500, 50)).toEqual([{ text: 'short text' }])
  })
})

describe('embedding client', () => {
  const settings = { baseUrl: 'http://local/v1', model: 'embed-a' }

  it('embeds in input order, batched, and adds an optional bearer token', async () => {
    stubFetch((_url, init) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret')
      return undefined
    })
    await expect(embedAll(settings, 'secret', Array.from({ length: 70 }, (_, i) => `t${i}`), new AbortController().signal)).resolves.toHaveLength(70)
  })

  it('returns nothing for no inputs', async () => {
    await expect(embedTexts(settings, '', [], new AbortController().signal)).resolves.toEqual([])
  })

  it('surfaces a non-2xx response and a vector-count mismatch', async () => {
    stubFetch(() => new Response('boom', { status: 500 }))
    await expect(embedTexts(settings, '', ['x'], new AbortController().signal)).rejects.toThrow('returned 500: boom')

    stubFetch(() => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    await expect(embedTexts(settings, '', ['x'], new AbortController().signal)).rejects.toThrow('0 vectors for 1 inputs')
  })

  it('lists models and surfaces a failure', async () => {
    stubFetch()
    await expect(listModels(settings, '', new AbortController().signal)).resolves.toEqual(['embed-a', 'embed-b'])

    stubFetch(() => new Response('nope', { status: 503 }))
    await expect(listModels(settings, '', new AbortController().signal)).rejects.toThrow('returned 503')
  })
})

describe('chat completion', () => {
  const endpoint = { baseUrl: 'http://local/v1', model: 'm', apiKey: 'k' }
  const sse = (text: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n`, { status: 200 })

  it('retries rate limits and server errors, honoring Retry-After', async () => {
    const statuses = [429, 503]
    const calls: number[] = []
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls.push(Date.now())
      const status = statuses.shift()
      return status === undefined ? sse('ok') : new Response('slow down', { status, headers: { 'retry-after': '0.01' } })
    }))
    await expect(chatComplete(endpoint, [{ role: 'user', content: 'hi' }], new AbortController().signal)).resolves.toBe('ok')
    expect(calls).toHaveLength(3)
  })

  it('does not retry client errors and stops waiting when cancelled', async () => {
    const fetch = vi.fn(async () => new Response('bad', { status: 400 }))
    vi.stubGlobal('fetch', fetch)
    await expect(chatComplete(endpoint, [{ role: 'user', content: 'hi' }], new AbortController().signal)).rejects.toThrow('HTTP 400')
    expect(fetch).toHaveBeenCalledTimes(1)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 429 })))
    const controller = new AbortController()
    const pending = chatComplete(endpoint, [{ role: 'user', content: 'hi' }], controller.signal)
    controller.abort(new Error('stopped'))
    await expect(pending).rejects.toThrow('stopped')
  })
})

describe('graph extraction', () => {
  it('parses a fenced or bare JSON graph and drops malformed entries', () => {
    expect(parseGraph(`\`\`\`json\n${GRAPH_JSON}\n\`\`\``)).toEqual({
      entities: [{ name: 'Alpha', type: 'concept', description: 'A thing' }],
      relations: [{ source: 'Alpha', target: 'Beta', description: 'relates to' }],
    })
    expect(parseGraph('{"entities":[{"name":"","type":"x"},"nope"],"relations":[{"source":"","target":"B"}]}')).toEqual({ entities: [], relations: [] })
    expect(parseGraph('{"entities":[],"relations":[]}')).toEqual({ entities: [], relations: [] })
    expect(parseGraph('not json')).toBeUndefined()
    expect(parseGraph('{"entities":{}}')).toBeUndefined()
  })

  it('reads the graph from a chat reply, and yields empty on failure or a missing message', async () => {
    stubFetch()
    await expect(extractGraph({ baseUrl: 'http://local/v1', model: 'm', apiKey: '' }, 'text', new AbortController().signal))
      .resolves.toMatchObject({ entities: [{ name: 'Alpha' }] })

    stubFetch(() => new Response('down', { status: 500 }))
    await expect(extractGraph({ baseUrl: 'http://local/v1', model: 'm', apiKey: '' }, 'text', new AbortController().signal))
      .resolves.toEqual({ entities: [], relations: [] })

    stubFetch(() => new Response(JSON.stringify({ choices: [] }), { status: 200 }))
    await expect(extractGraph({ baseUrl: 'http://local/v1', model: 'm', apiKey: '' }, 'text', new AbortController().signal))
      .resolves.toEqual({ entities: [], relations: [] })
  })
})

describe('Memory service', () => {
  it('exposes defaults, stores settings, and rejects invalid values', async () => {
    const subject = bench()
    expect(subject.service.getSettings()).toMatchObject({ model: 'text-embedding-3-small', topK: 6, collections: [], graphEnabled: true })

    const stored = await subject.service.setSettings({ baseUrl: 'http://local/v1/', model: 'embed-a', apiKey: 'k', collections: [{ ...collection(subject.source), description: '  UW coursework ' }] })
    expect(stored.baseUrl).toBe('http://local/v1')
    expect(stored.collections[0]).toEqual({ id: 'default', name: 'Default', sources: [subject.source], description: 'UW coursework' })

    await expect(subject.service.setSettings({ baseUrl: '  ' })).rejects.toThrow('baseUrl must not be empty')
    await expect(subject.service.setSettings({ chatModel: '' })).rejects.toThrow('chatModel must not be empty')
    await expect(subject.service.setSettings({ chunkChars: 10 })).rejects.toThrow('chunkChars must be an integer of at least 256')
    await expect(subject.service.setSettings({ overlapChars: 5000 })).rejects.toThrow('overlapChars must be an integer below chunkChars')
    await expect(subject.service.setSettings({ topK: 0 })).rejects.toThrow('topK must be a positive integer')
    await expect(subject.service.setSettings({ collections: [{ id: '', name: 'x', sources: [] }] })).rejects.toThrow('every collection needs an id and a name')
    await expect(subject.service.setSettings({ collections: [{ id: 'a', name: 'a', sources: [] }, { id: 'a', name: 'b', sources: [] }] })).rejects.toThrow('duplicate collection id "a"')
    await expect(subject.service.setSettings({ collections: [{ id: '../x', name: 'x', sources: [] }] })).rejects.toThrow('collection id "../x" may use only letters, digits, "-", and "_"')
  })

  it('validates the remote chat endpoint and the knowledge bases that route to it', async () => {
    const subject = bench()
    const remote = { id: 'ai', name: 'AI', sources: [], chat: 'remote' as const }
    await expect(subject.service.setSettings({ collections: [remote] })).rejects.toThrow('collection "ai" uses remote chat, but remoteChat is not configured')
    await expect(subject.service.setSettings({ remoteChat: { baseUrl: 'https://api.example/v1', model: '', apiKeyEnv: 'K' } })).rejects.toThrow('remoteChat.model must not be empty')
    const stored = await subject.service.setSettings({ remoteChat: { baseUrl: ' https://api.example/v1/ ', model: 'chat', apiKeyEnv: 'K' }, collections: [remote] })
    expect(stored.remoteChat).toEqual({ baseUrl: 'https://api.example/v1', model: 'chat', apiKeyEnv: 'K' })
    expect(stored.collections[0]?.chat).toBe('remote')
    await expect(subject.service.setSettings({ remoteChat: null })).rejects.toThrow('remoteChat is not configured')
    await subject.service.setSettings({ collections: [] })
    expect((await subject.service.setSettings({ remoteChat: null })).remoteChat).toBeUndefined()
  })

  it('keeps each knowledge base in its own index and searches one, several, or all', async () => {
    const subject = bench()
    const other = join(subject.home, 'work')
    mkdirSync(other, { recursive: true })
    writeFileSync(join(subject.source, 'a.md'), '# Notes\n\nalpha text about apples.\n\nmore alpha.')
    writeFileSync(join(other, 'w.md'), 'work alpha note')
    writeFileSync(join(subject.source, 'ignore.png'), 'binary')
    await subject.service.setSettings({ baseUrl: 'http://local/v1', model: 'embed-a', collections: [collection(subject.source), collection(other, 'work', 'Work')] })

    const first = await subject.service.index({}, new AbortController().signal)
    expect(first).toMatchObject({ documents: 2, entities: 2, relations: 2, dimensions: 4, collections: [{ id: 'default', documents: 1 }, { id: 'work', documents: 1 }] })
    expect(existsSync(join(subject.home, 'memory', 'kb', 'work', 'index.db'))).toBe(true)
    expect((await subject.service.index({}, new AbortController().signal)).skipped).toBe(2)
    expect((await subject.service.index({ collections: ['work'] }, new AbortController().signal)).skipped).toBe(1)

    const scoped = await subject.service.search({ query: 'alpha', collections: ['work'] }, new AbortController().signal)
    expect(scoped.hits.map(hit => hit.collection)).toEqual(['work'])
    expect(scoped.entities[0]).toMatchObject({ name: 'Alpha', relations: ['relates to'] })
    const all = await subject.service.search({ query: 'alpha', topK: 10 }, new AbortController().signal)
    expect(new Set(all.hits.map(hit => hit.collection))).toEqual(new Set(['default', 'work']))
    expect(all.hits.map(hit => hit.score)).toEqual([...all.hits.map(hit => hit.score)].sort((left, right) => right - left))
    expect((await subject.service.search({ query: 'alpha', topK: 1 }, new AbortController().signal)).hits).toHaveLength(1)

    await expect(subject.service.search({ query: '   ' }, new AbortController().signal)).rejects.toThrow('a non-empty query is required')
    await expect(subject.service.search({ query: 'x', collections: ['nope'] }, new AbortController().signal)).rejects.toThrow('unknown knowledge base "nope"')
    await expect(subject.service.index({ collections: ['nope'] }, new AbortController().signal)).rejects.toThrow('unknown knowledge base "nope"')
  })

  it('stops reporting a removed knowledge base but keeps its directory', async () => {
    const subject = bench()
    const other = join(subject.home, 'other')
    mkdirSync(other, { recursive: true })
    writeFileSync(join(other, 'o.md'), 'other alpha')
    writeFileSync(join(subject.source, 'a.md'), 'alpha')
    await subject.service.setSettings({ baseUrl: 'http://local/v1', model: 'embed-a', collections: [collection(subject.source), collection(other, 'other', 'Other')] })
    await subject.service.index({}, new AbortController().signal)
    await subject.service.writeNote({ collection: 'other', name: 'keep', content: 'kept' })

    await subject.service.setSettings({ collections: [collection(subject.source)] })
    expect(subject.service.status()).toMatchObject({ documents: 1, collections: [{ id: 'default', documents: 1 }] })
    await subject.service.setSettings({ collections: [collection(subject.source), collection(other, 'other', 'Other')] })
    await expect(subject.service.readNote({ collection: 'other', name: 'keep' })).resolves.toEqual({ content: 'kept\n' })
    expect(subject.service.status().documents).toBe(2)
  })

  it('lists a knowledge base\'s indexed documents with their roots and chunk counts', async () => {
    const subject = bench()
    mkdirSync(join(subject.source, 'STAT 559'), { recursive: true })
    writeFileSync(join(subject.source, 'STAT 559', 'lec.md'), '# Lec\n\nalpha')
    writeFileSync(join(subject.source, 'a.md'), 'alpha')
    await subject.service.setSettings({ baseUrl: 'http://local/v1', model: 'embed-a', collections: [collection(subject.source)] })
    await subject.service.index({}, new AbortController().signal)
    const listed = subject.service.listDocuments({ collection: 'default' })
    expect(listed.collection).toBe('default')
    expect(listed.roots[0]).toBe(subject.source)
    expect(listed.roots[1]).toContain('memories')
    expect(listed.documents.map(document => document.path)).toEqual([join(subject.source, 'STAT 559', 'lec.md'), join(subject.source, 'a.md')].sort())
    expect(listed.documents.every(document => document.chunks >= 1 && document.modified > 0)).toBe(true)
    expect(() => subject.service.listDocuments({ collection: 'nope' })).toThrow('unknown knowledge base "nope"')
  })

  it('writes, lists, reads, and indexes memory notes per knowledge base', async () => {
    const subject = bench()
    await subject.service.setSettings({ baseUrl: 'http://local/v1', model: 'embed-a', graphEnabled: false, maxDocumentChars: 2000, collections: [collection(subject.source), collection(join(subject.home, 'x'), 'ai', 'AI')] })
    await expect(subject.service.listNotes({ collection: 'default' })).resolves.toEqual({ names: [] })
    await expect(subject.service.writeNote({ collection: 'default', name: 'STAT 538 schedule', content: 'Lectures MW, alpha' })).resolves.toEqual({ name: 'STAT 538 schedule' })
    await subject.service.writeNote({ collection: 'default', name: 'a', content: 'first\n' })
    await expect(subject.service.listNotes({ collection: 'default' })).resolves.toEqual({ names: ['STAT 538 schedule', 'a'] })
    await expect(subject.service.listNotes({ collection: 'ai' })).resolves.toEqual({ names: [] })
    await expect(subject.service.readNote({ collection: 'default', name: 'a' })).resolves.toEqual({ content: 'first\n' })

    await expect(subject.service.readNote({ collection: 'default', name: 'missing' })).rejects.toThrow('memory "missing" does not exist')
    await expect(subject.service.writeNote({ collection: 'default', name: '../escape', content: 'x' })).rejects.toThrow('invalid memory name "../escape"')
    await expect(subject.service.writeNote({ collection: 'default', name: 'trailing.', content: 'x' })).rejects.toThrow('invalid memory name')
    await expect(subject.service.writeNote({ collection: 'default', name: 'big', content: 'x'.repeat(2001) })).rejects.toThrow('memory content has 2001 characters, above 2000')
    await expect(subject.service.writeNote({ collection: 'nope', name: 'a', content: 'x' })).rejects.toThrow('unknown knowledge base "nope"')
    await expect(subject.service.listNotes({ collection: 'nope' })).rejects.toThrow('unknown knowledge base "nope"')

    expect((await subject.service.index({}, new AbortController().signal)).collections).toEqual([{ id: 'default', documents: 2 }, { id: 'ai', documents: 0 }])
    const hits = await subject.service.search({ query: 'alpha', collections: ['default'] }, new AbortController().signal)
    expect(hits.hits.some(hit => hit.source.endsWith(join('kb', 'default', 'memories', 'STAT 538 schedule.md')))).toBe(true)
  })

  it('routes graph extraction to the remote endpoint for remote knowledge bases', async () => {
    const subject = bench()
    const chatUrls: string[] = []
    const authorizations: (string | null)[] = []
    stubFetch((url, init) => {
      if (url.endsWith('/chat/completions')) {
        chatUrls.push(url)
        authorizations.push(new Headers(init.headers).get('authorization'))
      }
      return undefined
    })
    writeFileSync(join(subject.source, 'a.md'), 'alpha')
    await subject.service.setSettings({
      baseUrl: 'http://local/v1', model: 'embed-a',
      remoteChat: { baseUrl: 'https://api.example/v1', model: 'remote-chat', apiKeyEnv: 'MEMORY_REMOTE_KEY' },
      collections: [{ ...collection(subject.source), chat: 'remote' }],
    })
    await expect(subject.service.index({}, new AbortController().signal)).rejects.toThrow('knowledge base "default" uses remote chat, but MEMORY_REMOTE_KEY is not set')
    process.env.MEMORY_REMOTE_KEY = 'secret'
    cleanups.push(() => { delete process.env.MEMORY_REMOTE_KEY })
    await subject.service.index({}, new AbortController().signal)
    expect(chatUrls).toEqual(['https://api.example/v1/chat/completions'])
    expect(authorizations).toEqual(['Bearer secret'])
  })

  it('records per-file failures, skips the graph when disabled, and keeps going', async () => {
    const subject = bench()
    writeFileSync(join(subject.source, 'ok.md'), 'fine')
    await subject.service.setSettings({
      baseUrl: 'http://local/v1', model: 'embed-a', graphEnabled: false, chatModel: 'm',
      collections: [collection(subject.source), collection(join(subject.home, 'missing'), 'missing', 'Missing')],
    })
    const disabled = await subject.service.index({}, new AbortController().signal)
    expect(disabled.entities).toBe(0)

    await subject.service.setSettings({ graphEnabled: true })
    writeFileSync(join(subject.source, 'ok.md'), 'fine changed')
    stubFetch((url) => url.endsWith('/embeddings') ? new Response('down', { status: 500 }) : undefined)
    const result = await subject.service.index({}, new AbortController().signal)
    expect(result.failures).toHaveLength(1)
    expect(subject.service.status().failures).toHaveLength(1)
    await expect(subject.service.search({ query: 'x' }, new AbortController().signal)).rejects.toThrow('query embedding failed')
  })

  it('lists endpoint models and reports discovery failures', async () => {
    const subject = bench()
    await subject.service.setSettings({ baseUrl: 'http://local/v1', model: 'embed-a' })
    await expect(subject.service.remoteListModels()).resolves.toEqual({ models: ['embed-a', 'embed-b'] })

    stubFetch(() => new Response('down', { status: 500 }))
    await expect(subject.service.remoteListModels()).rejects.toThrow('model discovery failed')
  })

  it('falls back to an environment API key', async () => {
    const subject = bench()
    await subject.service.setSettings({ baseUrl: 'http://local/v1', model: 'embed-a', apiKey: '', apiKeyEnv: 'MEMORY_TEST_KEY' })
    process.env.MEMORY_TEST_KEY = 'from-env'
    cleanups.push(() => { delete process.env.MEMORY_TEST_KEY })
    stubFetch((_url, init) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer from-env')
      return undefined
    })
    await expect(subject.service.search({ query: 'x' }, new AbortController().signal)).resolves.toEqual({ hits: [], entities: [] })
  })

  it('falls back to defaults for a corrupt store and migrates a legacy source list', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-memory-corrupt-'))
    cleanups.push(() => { rmSync(home, { recursive: true, force: true }) })
    mkdirSync(join(home, 'memory'), { recursive: true })
    writeFileSync(join(home, 'memory', 'config.json'), 'not json')
    stubFetch()
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    expect(new Memory(ctx, { home }).getSettings().model).toBe('text-embedding-3-small')

    writeFileSync(join(home, 'memory', 'config.json'), JSON.stringify({ sources: ['~/notes'] }))
    const secondCtx = new Context()
    onTestFinished(async () => { await secondCtx.fiber.dispose() })
    const migrated = new Memory(secondCtx, { home }).getSettings()
    expect(migrated.collections).toEqual([{ id: 'default', name: 'Default', sources: [join(process.env.HOME ?? '', 'notes')] }])
  })
})

describe('ingestion pipeline', () => {
  it('cleans Obsidian Markdown: front matter, comments, links, and embeds', () => {
    const raw = '---\ntags: [stat]\n---\n# Lec 8\n\nSee [[Bootstrap]], [[Delta method|the delta method]], [[Notes#Proof]] and ![[fig.png]].%%todo%%'
    expect(cleanMarkdown(raw)).toBe('# Lec 8\n\nSee Bootstrap, the delta method, Notes Proof and fig.png.')
  })

  it('keeps the LaTeX body with sections as headings and drops comments and labels', () => {
    const raw = '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\\section{Intro}\\label{s:intro}\nText 50\\% sure % a comment\n\\subsection*{Proof}\n$x^2$\n\\end{document}\ntrailing'
    expect(cleanLatex(raw)).toBe('# Intro\n\nText 50\\% sure \n\n## Proof\n\n$x^2$')
    expect(cleanLatex('plain \\section{A}')).toBe('plain \\section{A}')
  })

  it('collects claimed files and bundles, skipping hidden and excluded directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-memory-walk-'))
    cleanups.push(() => { rmSync(root, { recursive: true, force: true }) })
    for (const dir of ['course/site-packages/pkg', 'course/.venv', 'course/Lec 1.nbn/PDFs', 'course/Node_Modules']) mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, 'course', 'a.MD'), 'a')
    writeFileSync(join(root, 'course', 'b.png'), 'b')
    writeFileSync(join(root, 'course', 'site-packages', 'pkg', 'README.md'), 'x')
    writeFileSync(join(root, 'course', '.venv', 'x.md'), 'x')
    writeFileSync(join(root, 'course', 'Node_Modules', 'x.md'), 'x')
    writeFileSync(join(root, 'course', 'Lec 1.nbn', 'inner.md'), 'x')
    const table = new ExtractorTable()
    const markdown: Extractor = { id: 'md', version: 1, files: ['.md'], bundles: [], extract: async () => '' }
    const bundle: Extractor = { id: 'nbn', version: 1, files: [], bundles: ['.nbn'], extract: async () => '' }
    table.register(markdown)
    const disposeBundle = table.register(bundle)
    const found = await table.collect(root, ['site-packages', 'node_modules'])
    expect(found.map(doc => [doc.path.slice(root.length), doc.extractor.id]).sort()).toEqual([['/course/Lec 1.nbn', 'nbn'], ['/course/a.MD', 'md']])

    expect(() => table.register({ ...markdown, id: 'other' })).toThrow('memory extractor "other" claims .md, already claimed by "md"')
    disposeBundle()
    expect((await table.collect(root, [])).map(doc => doc.path.slice(root.length)).sort()).toEqual(['/course/Lec 1.nbn/inner.md', '/course/Node_Modules/x.md', '/course/a.MD', '/course/site-packages/pkg/README.md'])
    await expect(table.collect(join(root, 'missing'), [])).resolves.toEqual([])
  })

  it('indexes registered bundle extractors by fingerprint and re-indexes on a version bump', async () => {
    const subject = bench()
    mkdirSync(join(subject.source, 'Lec 1.nbn'))
    writeFileSync(join(subject.source, 'Lec 1.tex'), '\\begin{document}\\section{Sampling}\nalpha\\end{document}')
    let fingerprint = 'one'
    const extract = vi.fn(async () => '# Lec 1\n\nalpha handwriting')
    const bundle = { id: 'nbn', version: 1, files: [], bundles: ['.nbn'], fingerprint: async () => fingerprint, extract }
    const dispose = subject.service.registerExtractor(bundle)
    await subject.service.setSettings({ baseUrl: 'http://local/v1', model: 'embed-a', graphEnabled: false, collections: [collection(subject.source)] })

    expect(await subject.service.index({}, new AbortController().signal)).toMatchObject({ documents: 2, skipped: 0, failures: [] })
    expect((await subject.service.index({}, new AbortController().signal)).skipped).toBe(2)
    fingerprint = 'two'
    expect((await subject.service.index({}, new AbortController().signal)).skipped).toBe(1)
    dispose()
    subject.service.registerExtractor({ ...bundle, version: 2 })
    expect((await subject.service.index({}, new AbortController().signal)).skipped).toBe(1)
    expect(extract).toHaveBeenCalledTimes(3)
    const hits = await subject.service.search({ query: 'alpha', topK: 5 }, new AbortController().signal)
    expect(hits.hits.map(hit => hit.heading).sort()).toEqual(['Lec 1', 'Sampling'])
  })

  it('fails a document whose extracted text exceeds maxDocumentChars and validates the limit', async () => {
    const subject = bench()
    writeFileSync(join(subject.source, 'big.txt'), 'x'.repeat(300))
    await subject.service.setSettings({ baseUrl: 'http://local/v1', model: 'embed-a', graphEnabled: false, chunkChars: 256, overlapChars: 0, maxDocumentChars: 256, collections: [collection(subject.source)] })
    const result = await subject.service.index({}, new AbortController().signal)
    expect(result.failures).toEqual([{ path: join(subject.source, 'big.txt'), message: 'extracted text has 300 characters, above maxDocumentChars 256' }])
    await expect(subject.service.setSettings({ maxDocumentChars: 10 })).rejects.toThrow('maxDocumentChars must be an integer of at least chunkChars')
    expect((await subject.service.setSettings({ excludeDirs: [' build ', 'build', ''] })).excludeDirs).toEqual(['build'])
  })

  it('previews pages of indexed documents only', async () => {
    const subject = bench()
    mkdirSync(join(subject.source, 'Lec 1.nbn'))
    writeFileSync(join(subject.source, 'notes.md'), 'alpha')
    const renderPage = vi.fn(async (_path: string, page: number) => {
      if (page > 2) throw new Error(`page ${page} has no handwriting`)
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    })
    subject.service.registerExtractor({ id: 'nbn', version: 1, files: [], bundles: ['.nbn'], fingerprint: async () => 'x', extract: async () => '# Lec 1\n\nalpha', renderPage })
    await subject.service.setSettings({ baseUrl: 'http://local/v1', model: 'embed-a', graphEnabled: false, collections: [collection(subject.source)] })
    await subject.service.index({}, new AbortController().signal)
    const signal = new AbortController().signal
    await expect(subject.service.previewPage({ source: join(subject.source, 'Lec 1.nbn'), page: 2 }, signal)).resolves.toEqual({ image: 'data:image/png;base64,iVBORw==' })
    expect(renderPage).toHaveBeenCalledWith(join(subject.source, 'Lec 1.nbn'), 2, signal)
    await expect(subject.service.previewPage({ source: join(subject.source, 'Lec 1.nbn'), page: 3 }, signal)).rejects.toThrow('page 3 has no handwriting')
    await expect(subject.service.previewPage({ source: join(subject.source, 'Lec 1.nbn'), page: 0 }, signal)).rejects.toThrow('page must be a positive integer')
    await expect(subject.service.previewPage({ source: join(subject.source, 'notes.md'), page: 1 }, signal)).rejects.toThrow('has no page previews')
    await expect(subject.service.previewPage({ source: '/etc/passwd', page: 1 }, signal)).rejects.toThrow('/etc/passwd is not an indexed document')
  })

  it('cleans stray HTML out of OCR transcripts', () => {
    expect(plainMarkdown('a.s. &nbsp;&larr;&nbsp; almost surely<br/>next &amp; $x &lt; y$ &unknown;')).toBe('a.s. ← almost surely\nnext & $x < y$ &unknown;')
    expect(plainMarkdown('goal \\( P_{Y|X} \\) and\n\\[\nY = g(X, U)\n\\]')).toBe('goal $P_{Y|X}$ and\n$$\nY = g(X, U)\n$$')
  })

  it('transcribes pages through a hosted vision endpoint with its key, and caches by model', async () => {
    const subject = bench()
    const requests: { url: string; model: string; auth: string | null }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { model: string }
      requests.push({ url: String(input), model: body.model, auth: new Headers(init?.headers).get('authorization') })
      return new Response('data: {"choices":[{"delta":{"content":"# Page &nbsp;one"}}]}\n\ndata: [DONE]\n', { status: 200 })
    }))
    expect(subject.service.ocrEnabled()).toBe(false)
    await expect(subject.service.ocrImage(new Uint8Array([1]), 'a page', new AbortController().signal)).rejects.toThrow('OCR is off')
    await expect(subject.service.setSettings({ remoteVision: { baseUrl: 'https://api.openai.com/v1', model: '', apiKeyEnv: 'OPENAI_API_KEY' } })).rejects.toThrow('remoteVision.model must not be empty')
    await expect(subject.service.setSettings({ ocrConcurrency: 0 })).rejects.toThrow('ocrConcurrency must be an integer from 1 to 16')
    await subject.service.setSettings({ visionModel: 'local-vl', remoteVision: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', apiKeyEnv: 'MEMORY_TEST_VISION_KEY' }, ocrConcurrency: 6 })
    expect(subject.service.ocrConcurrency()).toBe(6)
    await expect(subject.service.ocrImage(new Uint8Array([1]), 'a page', new AbortController().signal)).rejects.toThrow('MEMORY_TEST_VISION_KEY is not set')
    process.env.MEMORY_TEST_VISION_KEY = 'sk-test'
    cleanups.push(() => { delete process.env.MEMORY_TEST_VISION_KEY })
    await expect(subject.service.ocrImage(new Uint8Array([1]), 'a page', new AbortController().signal)).resolves.toBe('# Page one')
    await expect(subject.service.ocrImage(new Uint8Array([1]), 'a page', new AbortController().signal)).resolves.toBe('# Page one')
    expect(requests).toEqual([{ url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini', auth: 'Bearer sk-test' }])
    expect((await subject.service.setSettings({ remoteVision: null })).remoteVision).toBeUndefined()
    expect(subject.service.ocrEnabled()).toBe(true)
  })
})
