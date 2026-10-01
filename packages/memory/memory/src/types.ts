/** Wire vocabulary for the local knowledge-base Remote namespace. */

/** Which chat endpoint generative work for a knowledge base may use. */
export type ChatRoute = 'local' | 'remote'

/**
 * One knowledge base: named document sources with its own index and agent
 * memories, stored under `$DSH_HOME/memory/kb/<id>/`.
 */
export interface MemoryCollection {
  /** Stable id used by search, indexing, tools, and the storage directory; letters, digits, `-`, `_`. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Directories scanned recursively for this knowledge base. */
  readonly sources: readonly string[]
  /** What the knowledge base holds, shown to agents that can reach several. */
  readonly description?: string
  /** Chat endpoint for graph extraction; `remote` requires {@link MemorySettings.remoteChat}. Defaults to `local`. */
  readonly chat?: ChatRoute
}

/** A hosted OpenAI-compatible chat endpoint for generative work (for example the DeepSeek API). */
export interface RemoteChat {
  /** Endpoint base URL, such as `https://api.deepseek.com/v1`. */
  readonly baseUrl: string
  /** Chat model id. */
  readonly model: string
  /** Environment variable holding the API key; the key is never stored. */
  readonly apiKeyEnv: string
}

/** Mutable memory-layer settings, stored under the harness home. */
export interface MemorySettings {
  /** OpenAI-compatible embeddings base URL (LM Studio, Ollama, OpenAI, …). */
  readonly baseUrl: string
  /** Embedding model id the endpoint accepts. */
  readonly model: string
  /** API key stored locally; empty falls back to {@link MemorySettings.apiKeyEnv}. */
  readonly apiKey: string
  /** Environment variable named for the API key when no stored key is set. */
  readonly apiKeyEnv: string
  /** Chat model on {@link MemorySettings.baseUrl} used for `local` generative work. */
  readonly chatModel: string
  /** Hosted chat endpoint for knowledge bases whose `chat` is `remote`. */
  readonly remoteChat?: RemoteChat
  /** Vision-capable model on {@link MemorySettings.baseUrl} that transcribes scanned and handwritten pages; OCR is off when absent. */
  readonly visionModel?: string
  /** Hosted vision endpoint that transcribes pages in place of {@link MemorySettings.visionModel}, such as OpenAI. */
  readonly remoteVision?: RemoteChat
  /** Pages transcribed at once; raise it for a hosted vision endpoint. */
  readonly ocrConcurrency: number
  /** Whether indexing extracts entities and relations. */
  readonly graphEnabled: boolean
  /** Knowledge bases. */
  readonly collections: readonly MemoryCollection[]
  /** Target characters per chunk. */
  readonly chunkChars: number
  /** Character overlap between adjacent chunks of one oversize block. */
  readonly overlapChars: number
  /** Default number of results returned by search. */
  readonly topK: number
  /** Directory names the indexer never descends into, compared case-insensitively. */
  readonly excludeDirs: readonly string[]
  /** Documents whose extracted text is longer than this fail instead of indexing. */
  readonly maxDocumentChars: number
}

/** Counts describing the current index. */
export interface MemoryStatus {
  /** Indexed documents. */
  readonly documents: number
  /** Indexed chunks. */
  readonly chunks: number
  /** Extracted entities. */
  readonly entities: number
  /** Extracted relations. */
  readonly relations: number
  /** Embedding dimensions of the first stored vector, when any exist. */
  readonly dimensions?: number
  /** Per-knowledge-base document counts. */
  readonly collections: readonly { readonly id: string; readonly documents: number }[]
  /** Failed files from the last index. */
  readonly failures: readonly { readonly path: string; readonly message: string }[]
}

/** One indexed document. */
export interface MemoryDocument {
  /** Absolute source path. */
  readonly path: string
  /** Source modification time when indexed, epoch milliseconds. */
  readonly modified: number
  /** Indexed chunks. */
  readonly chunks: number
}

/** A knowledge base's indexed documents. */
export interface MemoryDocumentList {
  readonly collection: string
  /** The knowledge base's source folders and its memory-notes folder, which the documents sit under. */
  readonly roots: readonly string[]
  readonly documents: readonly MemoryDocument[]
}

/** Names one knowledge base. */
export interface MemoryCollectionRef {
  readonly collection: string
}

/** One graph entity. */
export interface MemoryEntity {
  /** Entity name. */
  readonly name: string
  /** Entity type, as extracted. */
  readonly type: string
  /** Short description. */
  readonly description: string
}

/** One graph entity related to a search result, with its one-hop relations. */
export interface MemoryRelatedEntity extends MemoryEntity {
  /** Descriptions of this entity's one-hop relations. */
  readonly relations: readonly string[]
}

/** One search result. */
export interface MemoryHit {
  /** Source file path. */
  readonly source: string
  /** Collection the document belongs to. */
  readonly collection: string
  /** Nearest markdown heading above the chunk, when known. */
  readonly heading?: string
  /** Chunk text. */
  readonly text: string
  /** Cosine similarity in [-1, 1]. */
  readonly score: number
}

/** Search request. */
export interface MemorySearchRequest {
  /** Natural-language query. */
  readonly query: string
  /** Maximum results; defaults to the configured topK. */
  readonly topK?: number
  /** Knowledge bases to search; all configured ones when absent. */
  readonly collections?: readonly string[]
  /** Only documents under one of these folder paths, such as one course's folders; all when absent. */
  readonly folders?: readonly string[]
}

/** Search response. */
export interface MemorySearchValue {
  readonly hits: readonly MemoryHit[]
  /** Entities linked to the returned chunks, with their one-hop relations. */
  readonly entities: readonly MemoryRelatedEntity[]
}

/** Index request. */
export interface MemoryIndexRequest {
  /** Knowledge bases to index; all configured ones when absent. */
  readonly collections?: readonly string[]
}

/** Names one agent memory note inside a knowledge base. */
export interface MemoryNoteRef {
  /** Knowledge base id. */
  readonly collection: string
  /** Note name: letters, digits, spaces, `.`, `-`, `_`; stored as `<name>.md`. */
  readonly name: string
}

/** Writes one agent memory note. */
export interface MemoryNoteWrite extends MemoryNoteRef {
  /** Full Markdown content, replacing any previous content. */
  readonly content: string
}

/** Index response. */
export interface MemoryIndexValue extends MemoryStatus {
  /** Documents skipped because their content hash was unchanged. */
  readonly skipped: number
}

/** Partial settings update; every field is optional. */
export interface MemorySettingsUpdate {
  readonly baseUrl?: string
  readonly model?: string
  readonly apiKey?: string
  readonly apiKeyEnv?: string
  readonly chatModel?: string
  /** A new hosted chat endpoint, or `null` to remove it. */
  readonly remoteChat?: RemoteChat | null
  /** A vision model for OCR, or `null` to turn OCR off. */
  readonly visionModel?: string | null
  /** A hosted vision endpoint, or `null` to remove it. */
  readonly remoteVision?: RemoteChat | null
  readonly ocrConcurrency?: number
  readonly graphEnabled?: boolean
  readonly collections?: readonly MemoryCollection[]
  readonly chunkChars?: number
  readonly overlapChars?: number
  readonly topK?: number
  readonly excludeDirs?: readonly string[]
  readonly maxDocumentChars?: number
}
