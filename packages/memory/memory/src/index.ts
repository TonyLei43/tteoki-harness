/**
 * Local knowledge bases: extract documents through registered extractors and
 * index each knowledge base into its own SQLite vectors and knowledge graph
 * through an OpenAI-compatible endpoint (LM Studio, Ollama, or a cloud API).
 * Each knowledge base also keeps agent memory notes that are indexed with its
 * sources. Model-facing tools live in `@deepseek-ai/dsh-tool-memory`, which a
 * preset mounts with the knowledge bases its agent may reach.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { chunkMarkdown } from './chunk.ts'
import { applyUpdate, collectionDir, readSettings, resolveHome, settingsFile, writeSettings } from './config.ts'
import { embedAll, listModels } from './embed.ts'
import { chatComplete, EMPTY_GRAPH, extractGraph, type ChatEndpoint, type ChatMessage } from './extract.ts'
import { BUILTIN_EXTRACTORS, ExtractorTable, hashFile, type Extractor } from './ingest.ts'
import { listNotes, readNote, writeNote } from './notes.ts'
import { MemoryStore, type DocumentGraph } from './store.ts'
import type {
  MemoryCollection,
  MemoryCollectionRef,
  MemoryDocumentList,
  MemoryHit,
  MemoryIndexRequest,
  MemoryIndexValue,
  MemoryNoteRef,
  MemoryNoteWrite,
  MemoryRelatedEntity,
  MemorySearchRequest,
  MemorySearchValue,
  MemorySettings,
  MemorySettingsUpdate,
  MemoryStatus,
} from './types.ts'

export type * from './types.ts'
export { chatComplete, parseGraph } from './extract.ts'
export type { ChatEndpoint, ChatMessage } from './extract.ts'
export { cleanLatex, cleanMarkdown, DEFAULT_EXCLUDE_DIRS, type Extractor } from './ingest.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: Memory
  }
}

/** Maximum related entities returned with a search. */
const RELATED_LIMIT = 12

/** Instructions for transcribing one page image. */
const OCR_PROMPT = 'You transcribe scanned and handwritten pages. Reply with the page content only, as Markdown: '
  + 'keep headings, lists, and paragraph breaks; write all mathematics in LaTeX ($...$ inline, $$...$$ for display); '
  + 'mark words you cannot read as [illegible]; describe figures in one short line in brackets. Do not add commentary. '
  + 'Use plain Markdown and LaTeX only, never HTML tags or entities. '
  // Qwen-family vision models otherwise reason at length before transcribing; other models ignore the tag.
  + '/no_think'

/** Deployment policy for the memory layer. */
export interface Config {
  /** Harness home override; defaults to the resolved DSH home. */
  readonly home?: string
}

/** HTML entities vision models emit despite instructions, with their plain-text replacements. */
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&nbsp;': ' ', '&larr;': '←', '&rarr;': '→', '&harr;': '↔', '&uarr;': '↑', '&darr;': '↓',
  '&lt;': '<', '&gt;': '>', '&le;': '≤', '&ge;': '≥', '&times;': '×', '&middot;': '·', '&hellip;': '…', '&amp;': '&',
}

/**
 * Turn a transcript into Obsidian-ready Markdown: `\(…\)` and `\[…\]` math
 * becomes `$…$` and `$$…$$`, known HTML entities become their characters, and
 * line-break tags become line breaks.
 * @param text - model output.
 * @returns the cleaned text.
 */
export function plainMarkdown(text: string): string {
  return text
    // Obsidian renders $…$ and $$…$$, not the \(…\) and \[…\] delimiters some models emit.
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `$$${math}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, math: string) => `$${math.trim()}$`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&[a-z]+;/gi, entity => HTML_ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/[ \t]{2,}/g, ' ')
}

/** Remote service owning knowledge-base settings, indexes, and memory notes. */
export class Memory extends TypertRemoteService {
  static Config: z<Config> = z.object({ home: z.string() })

  static inject = ['typert']

  private readonly home: string
  private readonly settingsPath: string
  private settings: MemorySettings
  private readonly stores = new Map<string, MemoryStore>()
  private readonly extractors = new ExtractorTable()
  private failures: MemoryStatus['failures'] = []

  /** @param ctx - Host context. @param config - harness home override. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'memory')
    this.home = resolveHome(config.home)
    this.settingsPath = settingsFile(this.home)
    this.settings = readSettings(this.settingsPath)
    for (const extractor of BUILTIN_EXTRACTORS) ctx.effect(() => this.extractors.register(extractor), `memory: ${extractor.id} extractor`)
    ctx.effect(() => () => {
      for (const store of this.stores.values()) store.close()
      this.stores.clear()
    }, 'memory: index databases')
  }

  /**
   * Add a document extractor to the ingestion pipeline.
   * @param extractor - extractor claiming file or bundle suffixes.
   * @returns the disposer that removes it.
   * @throws Error when another extractor already claims one of its suffixes.
   */
  registerExtractor(extractor: Extractor): () => void {
    return this.extractors.register(extractor)
  }

  /**
   * Extract one document's text with the extractor that claims its suffix.
   * @param path - absolute file or bundle directory path.
   * @param signal - caller cancellation.
   * @returns the extracted Markdown text.
   * @throws Error when no extractor claims the path or extraction fails.
   */
  async extractText(path: string, signal: AbortSignal): Promise<string> {
    const info = await stat(path)
    const extractor = this.extractors.claimPath(path, info.isDirectory())
    if (extractor === undefined) throw new Error(`no extractor reads ${path}`)
    return await extractor.extract(path, signal)
  }

  /**
   * Run one chat completion on the local chat model (`chatModel` at `baseUrl`), so
   * private documents stay on the configured local server.
   * @param messages - the conversation; image parts need a vision-capable model.
   * @param signal - caller cancellation.
   * @returns the reply text.
   * @throws Error when the endpoint fails or returns no text.
   */
  async complete(messages: readonly ChatMessage[], signal: AbortSignal): Promise<string> {
    return await chatComplete({ baseUrl: this.settings.baseUrl, model: this.settings.chatModel, apiKey: this.apiKey() }, messages, signal)
  }

  /**
   * Transcribe one page image with the configured vision model. Results are
   * cached under `$DSH_HOME/memory/ocr/` by image hash, so a page is sent to
   * the model once.
   * @param png - the page image.
   * @param hint - what the page is, such as "a handwritten lecture page", for the prompt.
   * @param signal - caller cancellation.
   * @returns the page as Markdown with LaTeX math.
   * @throws Error when no vision model is configured or the model fails.
   */
  async ocrImage(png: Uint8Array, hint: string, signal: AbortSignal): Promise<string> {
    const endpoint = await this.visionEndpoint()
    const key = createHash('sha256').update(png).update(endpoint.model).digest('hex')
    const cached = join(this.home, 'memory', 'ocr', `${key}.md`)
    try {
      return await readFile(cached, 'utf8')
    } catch {
      // Not transcribed yet.
    }
    const text = await chatComplete(endpoint, [
      { role: 'system', content: OCR_PROMPT },
      { role: 'user', content: [
        { type: 'text', text: `Transcribe ${hint}.` },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(png).toString('base64')}` } },
      ] },
    ], signal)
    const transcript = plainMarkdown(text.replace(/^```(?:markdown|md)?\s*|```\s*$/g, '')).trim()
    await mkdir(join(this.home, 'memory', 'ocr'), { recursive: true })
    await writeFile(cached, transcript, 'utf8')
    return transcript
  }

  /**
   * Render one page of an indexed document as an image, for previews.
   * @param request - the document's source path, as search results report it, and a 1-based page.
   * @param signal - caller cancellation.
   * @returns a PNG data URL.
   * @throws RemoteError when the document is not indexed, its format has no pages, or the page does not exist.
   */
  @Remote('previewPage')
  async previewPage(request: { readonly source: string; readonly page: number }, signal: AbortSignal): Promise<{ image: string }> {
    // Only indexed documents render, so the method cannot read arbitrary files.
    const indexed = this.settings.collections.some(collection => this.storeFor(collection.id).documentHash(request.source) !== undefined)
    if (!indexed) throw new RemoteError('gateway/bad-request', `${request.source} is not an indexed document`, {})
    if (!Number.isInteger(request.page) || request.page < 1) throw new RemoteError('gateway/bad-request', 'page must be a positive integer', {})
    let directory = false
    try {
      directory = (await stat(request.source)).isDirectory()
    } catch {
      throw new RemoteError('gateway/bad-request', `${request.source} no longer exists`, {})
    }
    const extractor = this.extractors.claimPath(request.source, directory)
    if (extractor?.renderPage === undefined) throw new RemoteError('gateway/bad-request', `${request.source} has no page previews`, {})
    try {
      const png = await extractor.renderPage(request.source, request.page, signal)
      return { image: `data:image/png;base64,${Buffer.from(png).toString('base64')}` }
    } catch (error: unknown) {
      throw new RemoteError('gateway/bad-request', error instanceof Error ? error.message : String(error), {})
    }
  }

  /**
   * Whether OCR is configured.
   * @returns true when a hosted vision endpoint or a local vision model is set.
   */
  ocrEnabled(): boolean {
    return this.settings.remoteVision !== undefined || this.settings.visionModel !== undefined
  }

  /**
   * Pages to transcribe at once.
   * @returns the configured OCR concurrency.
   */
  ocrConcurrency(): number {
    return this.settings.ocrConcurrency
  }

  /**
   * Resolve the endpoint OCR uses: the hosted vision endpoint when configured, else the local vision model.
   * @returns the endpoint, model, and key.
   * @throws Error when OCR is off, or the hosted endpoint's key is not set.
   */
  private async visionEndpoint(): Promise<ChatEndpoint> {
    const remote = this.settings.remoteVision
    if (remote !== undefined) {
      // The credential store also reads .env files; the process environment covers bare runs.
      const credentials = this.ctx.get('credentials')
      const resolved = credentials === undefined ? undefined : await credentials.resolve(brandString<CredentialRef>(remote.apiKeyEnv))
      const apiKey = resolved?.value ?? process.env[remote.apiKeyEnv] ?? ''
      if (apiKey === '') throw new Error(`${remote.apiKeyEnv} is not set; add it to .env or the environment, or remove the hosted vision endpoint`)
      return { baseUrl: remote.baseUrl, model: remote.model, apiKey }
    }
    const model = this.settings.visionModel
    if (model === undefined) throw new Error('OCR is off: set a vision model in the Memory settings')
    return { baseUrl: this.settings.baseUrl, model, apiKey: this.apiKey() }
  }

  /**
   * Read the current settings.
   * @returns effective settings.
   */
  @Remote('getSettings')
  getSettings(): MemorySettings {
    return this.settings
  }

  /**
   * Update settings. Removing a knowledge base closes its index but keeps its
   * directory, so its memory notes survive re-adding it.
   * @param update - partial settings.
   * @returns the stored settings.
   * @throws RemoteError when a value is invalid.
   */
  @Remote('setSettings')
  async setSettings(update: MemorySettingsUpdate): Promise<MemorySettings> {
    const next = applyUpdate(this.settings, update)
    await writeSettings(this.settingsPath, next)
    this.settings = next
    for (const [id, store] of this.stores) {
      if (next.collections.some(collection => collection.id === id)) continue
      store.close()
      this.stores.delete(id)
    }
    return next
  }

  /**
   * List the models the configured embeddings endpoint advertises.
   * @returns advertised model ids.
   * @throws RemoteError when the endpoint is unreachable.
   */
  @Remote('listModels')
  async remoteListModels(): Promise<{ models: string[] }> {
    try {
      return { models: await listModels(this.settings, this.apiKey(), AbortSignal.timeout(20_000)) }
    } catch (error: unknown) {
      throw new RemoteError('gateway/internal', `model discovery failed: ${String(error)}`, {})
    }
  }

  /**
   * Report index counts across knowledge bases and the last index's failures.
   * @returns current status.
   */
  @Remote('status')
  status(): MemoryStatus {
    let documents = 0
    let chunks = 0
    let entities = 0
    let relations = 0
    let dimensions: number | undefined
    const collections: { id: string; documents: number }[] = []
    for (const collection of this.settings.collections) {
      const counts = this.storeFor(collection.id).counts()
      documents += counts.documents
      chunks += counts.chunks
      entities += counts.entities
      relations += counts.relations
      dimensions ??= counts.dimensions
      collections.push({ id: collection.id, documents: counts.documents })
    }
    return { documents, chunks, entities, relations, ...dimensions === undefined ? {} : { dimensions }, collections, failures: this.failures }
  }

  /**
   * List one knowledge base's indexed documents.
   * @param request - the knowledge base.
   * @returns its source roots and documents, by path.
   * @throws RemoteError when the knowledge base is unknown.
   */
  @Remote('listDocuments')
  listDocuments(request: MemoryCollectionRef): MemoryDocumentList {
    const collection = this.selectOne(request.collection)
    return {
      collection: collection.id,
      roots: [...collection.sources, this.notesDir(collection.id)],
      documents: this.storeFor(collection.id).documents(collection.id),
    }
  }

  /**
   * Index knowledge bases: their sources plus their memory notes, extracting
   * the graph for changed documents.
   * @param request - knowledge bases to index; all when absent.
   * @param signal - caller cancellation.
   * @returns counts plus how many documents were unchanged.
   * @throws RemoteError when a knowledge base is unknown or its remote chat key is unset.
   */
  @Remote('index')
  async index(request: MemoryIndexRequest, signal: AbortSignal): Promise<MemoryIndexValue> {
    const failures: { path: string; message: string }[] = []
    let skipped = 0
    for (const collection of this.select(request.collections)) {
      const store = this.storeFor(collection.id)
      const chat = this.settings.graphEnabled ? this.chatEndpoint(collection) : undefined
      const sources = [...collection.sources, this.notesDir(collection.id)]
      for (const source of sources) {
        for (const { path, extractor } of await this.extractors.collect(source, this.settings.excludeDirs)) {
          signal.throwIfAborted()
          try {
            const fingerprint = await (extractor.fingerprint ?? hashFile)(path)
            const hash = createHash('sha256').update(`${extractor.id}@${extractor.version}:${fingerprint}`).digest('hex')
            if (store.documentHash(path) === hash) {
              skipped += 1
              continue
            }
            const content = await extractor.extract(path, signal)
            if (content.length > this.settings.maxDocumentChars) {
              throw new Error(`extracted text has ${content.length} characters, above maxDocumentChars ${this.settings.maxDocumentChars}`)
            }
            const chunks = chunkMarkdown(content, this.settings.chunkChars, this.settings.overlapChars)
            const vectors = chunks.length === 0 ? [] : await embedAll(this.settings, this.apiKey(), chunks.map(chunk => chunk.text), signal)
            const graph: DocumentGraph = chat === undefined
              ? { entities: EMPTY_GRAPH.entities, relations: EMPTY_GRAPH.relations }
              : await extractGraph(chat, content, signal)
            store.upsert(collection.id, path, (await stat(path)).mtimeMs, hash, chunks, vectors, graph)
          } catch (error: unknown) {
            failures.push({ path, message: error instanceof Error ? error.message : String(error) })
          }
        }
      }
    }
    this.failures = failures
    return { ...this.status(), skipped }
  }

  /**
   * Search knowledge bases, merging hits by score and expanding the top
   * chunks through each knowledge base's graph.
   * @param request - query, result cap, and knowledge bases (all when absent).
   * @param signal - caller cancellation.
   * @returns ranked passages plus related entities.
   * @throws RemoteError when the query is empty, a knowledge base is unknown, or embedding fails.
   */
  @Remote('search')
  async search(request: MemorySearchRequest, signal: AbortSignal): Promise<MemorySearchValue> {
    const query = request.query.trim()
    if (query === '') throw new RemoteError('gateway/bad-request', 'a non-empty query is required', {})
    const collections = this.select(request.collections)
    let vectors: Float32Array[]
    try {
      vectors = await embedAll(this.settings, this.apiKey(), [query], signal)
    } catch (error: unknown) {
      throw new RemoteError('gateway/internal', `query embedding failed: ${String(error)}`, {})
    }
    const vector = vectors[0]
    if (vector === undefined) throw new RemoteError('gateway/internal', 'the embeddings endpoint returned no query vector', {})
    const topK = request.topK ?? this.settings.topK
    const ranked: { hit: MemoryHit; store: MemoryStore }[] = []
    for (const collection of collections) {
      const store = this.storeFor(collection.id)
      for (const hit of store.search(vector, topK, request.folders)) ranked.push({ hit, store })
    }
    const top = ranked.sort((left, right) => right.hit.score - left.hit.score).slice(0, topK)
    const entities: MemoryRelatedEntity[] = []
    for (const store of new Set(top.map(entry => entry.store))) {
      const hits = top.filter(entry => entry.store === store).map(entry => entry.hit)
      entities.push(...store.relatedEntities(store.chunkIdsFor(hits), RELATED_LIMIT - entities.length))
      if (entities.length >= RELATED_LIMIT) break
    }
    return { hits: top.map(entry => entry.hit), entities }
  }

  /**
   * List a knowledge base's memory notes.
   * @param request - the knowledge base.
   * @returns note names in ascending order.
   * @throws RemoteError when the knowledge base is unknown.
   */
  @Remote('listNotes')
  async listNotes(request: { readonly collection: string }): Promise<{ names: string[] }> {
    return { names: await listNotes(this.notesDir(this.selectOne(request.collection).id)) }
  }

  /**
   * Read one memory note.
   * @param request - knowledge base and note name.
   * @returns the note content.
   * @throws RemoteError when the knowledge base is unknown, the name is invalid, or the note does not exist.
   */
  @Remote('readNote')
  async readNote(request: MemoryNoteRef): Promise<{ content: string }> {
    const collection = this.selectOne(request.collection)
    try {
      return { content: await readNote(this.notesDir(collection.id), request.name) }
    } catch (error: unknown) {
      throw new RemoteError('gateway/bad-request', error instanceof Error ? error.message : String(error), {})
    }
  }

  /**
   * Create or replace one memory note; the next index run makes it searchable.
   * @param request - knowledge base, note name, and full content.
   * @returns the stored note name.
   * @throws RemoteError when the knowledge base is unknown, the name is invalid, or the content exceeds `maxDocumentChars`.
   */
  @Remote('writeNote')
  async writeNote(request: MemoryNoteWrite): Promise<{ name: string }> {
    const collection = this.selectOne(request.collection)
    try {
      await writeNote(this.notesDir(collection.id), request.name, request.content, this.settings.maxDocumentChars)
    } catch (error: unknown) {
      throw new RemoteError('gateway/bad-request', error instanceof Error ? error.message : String(error), {})
    }
    return { name: request.name }
  }

  /**
   * Resolve requested knowledge-base ids against the configuration.
   * @param ids - requested ids, or undefined for every configured knowledge base.
   * @returns the matching knowledge bases in request order.
   * @throws RemoteError naming the first unknown id.
   */
  private select(ids: readonly string[] | undefined): MemoryCollection[] {
    return ids === undefined ? [...this.settings.collections] : ids.map(id => this.selectOne(id))
  }

  /**
   * Resolve one knowledge-base id.
   * @param id - requested id.
   * @returns the configured knowledge base.
   * @throws RemoteError when the id is unknown.
   */
  private selectOne(id: string): MemoryCollection {
    const found = this.settings.collections.find(collection => collection.id === id)
    if (found === undefined) throw new RemoteError('gateway/bad-request', `unknown knowledge base "${id}"`, {})
    return found
  }

  private storeFor(id: string): MemoryStore {
    let store = this.stores.get(id)
    if (store === undefined) {
      store = new MemoryStore(join(collectionDir(this.home, id), 'index.db'))
      this.stores.set(id, store)
    }
    return store
  }

  private notesDir(id: string): string {
    return join(collectionDir(this.home, id), 'memories')
  }

  /**
   * Resolve the chat endpoint one knowledge base's generative work uses.
   * @param collection - the knowledge base.
   * @returns the local or remote endpoint.
   * @throws RemoteError when a remote endpoint's key variable is unset.
   */
  private chatEndpoint(collection: MemoryCollection): ChatEndpoint {
    const remote = this.settings.remoteChat
    if (collection.chat !== 'remote' || remote === undefined) {
      return { baseUrl: this.settings.baseUrl, model: this.settings.chatModel, apiKey: this.apiKey() }
    }
    const apiKey = process.env[remote.apiKeyEnv] ?? ''
    if (apiKey === '') throw new RemoteError('gateway/bad-request', `knowledge base "${collection.id}" uses remote chat, but ${remote.apiKeyEnv} is not set`, {})
    return { baseUrl: remote.baseUrl, model: remote.model, apiKey }
  }

  private apiKey(): string {
    return this.settings.apiKey !== '' ? this.settings.apiKey : process.env[this.settings.apiKeyEnv] ?? ''
  }
}

export default Memory
