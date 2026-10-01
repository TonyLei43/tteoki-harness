/** Local SQLite store of one knowledge base: documents, chunks, vectors, and the knowledge graph. */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Chunk } from './chunk.ts'
import type { MemoryDocument, MemoryEntity, MemoryHit, MemoryRelatedEntity } from './types.ts'

/** Schema version; a lower stored version recreates the tables. */
const SCHEMA_VERSION = 2

/** Schema for documents, chunks, vectors, and the graph. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  collection TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  mtime INTEGER NOT NULL,
  hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vectors (
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  dim INTEGER NOT NULL,
  embedding BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY,
  collection TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  UNIQUE(collection, name)
);
CREATE TABLE IF NOT EXISTS relations (
  id INTEGER PRIMARY KEY,
  collection TEXT NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mentions (
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  PRIMARY KEY (entity_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS chunks_document ON chunks(document_id);
CREATE INDEX IF NOT EXISTS entities_collection ON entities(collection);
CREATE INDEX IF NOT EXISTS relations_collection ON relations(collection);
`

/** Extracted graph for one document. */
export interface DocumentGraph {
  readonly entities: readonly MemoryEntity[]
  readonly relations: readonly { readonly source: string; readonly target: string; readonly description: string }[]
}

/** Counts from the store. */
export interface StoreCounts {
  readonly documents: number
  readonly chunks: number
  readonly entities: number
  readonly relations: number
  readonly dimensions: number | undefined
  readonly collections: readonly { readonly id: string; readonly documents: number }[]
}

/** A chunk row with its document context. */
interface ChunkRow {
  readonly source: string
  readonly collection: string
  readonly heading: string | null
  readonly text: string
}

/**
 * Cosine similarity between two equal-length vectors.
 * @param left - first vector.
 * @param right - second vector.
 * @returns similarity in [-1, 1]; 0 when either vector has zero magnitude.
 */
function cosine(left: Float32Array, right: Float32Array): number {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index] as number
    const b = right[index] as number
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

/** Borrowed view over one stored BLOB. */
function toVector(bytes: Uint8Array): Float32Array {
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4))
}

/** SQLite-backed document, chunk, vector, and graph store. */
export class MemoryStore {
  private readonly db: DatabaseSync

  /** @param file - index database path; parent directories are created. */
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA foreign_keys = ON')
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (version !== 0 && version < SCHEMA_VERSION) {
      // The local dev index is disposable; a schema bump recreates it.
      for (const table of ['mentions', 'relations', 'entities', 'vectors', 'chunks', 'documents']) {
        this.db.exec(`DROP TABLE IF EXISTS ${table}`)
      }
    }
    this.db.exec(SCHEMA)
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }

  /**
   * Read a document's stored content hash.
   * @param path - absolute document path.
   * @returns the stored hash, or undefined when the path is not indexed.
   */
  documentHash(path: string): string | undefined {
    const row = this.db.prepare('SELECT hash FROM documents WHERE path = ?').get(path) as { hash?: string } | undefined
    return row?.hash
  }

  /**
   * Replace one document's row, chunks, vectors, and graph contributions.
   * @param collection - owning collection id.
   * @param path - absolute document path.
   * @param mtime - file modification time in milliseconds.
   * @param hash - content hash.
   * @param chunks - chunks to store.
   * @param vectors - one vector per chunk.
   * @param graph - entities and relations extracted from the document.
   */
  upsert(
    collection: string,
    path: string,
    mtime: number,
    hash: string,
    chunks: readonly Chunk[],
    vectors: readonly Float32Array[],
    graph: DocumentGraph,
  ): void {
    this.db.prepare('DELETE FROM documents WHERE path = ?').run(path)
    const created = this.db.prepare('INSERT INTO documents (collection, path, mtime, hash) VALUES (?, ?, ?, ?)').run(collection, path, mtime, hash)
    const documentId = Number(created.lastInsertRowid)
    const insertChunk = this.db.prepare('INSERT INTO chunks (document_id, ordinal, heading, text) VALUES (?, ?, ?, ?)')
    const insertVector = this.db.prepare('INSERT INTO vectors (chunk_id, dim, embedding) VALUES (?, ?, ?)')
    const chunkIds: number[] = []
    chunks.forEach((chunk, ordinal) => {
      const inserted = insertChunk.run(documentId, ordinal, chunk.heading ?? null, chunk.text)
      const chunkId = Number(inserted.lastInsertRowid)
      chunkIds.push(chunkId)
      const vector = vectors[ordinal] as Float32Array
      insertVector.run(chunkId, vector.length, new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength))
    })
    if (chunkIds.length === 0) return
    const upsertEntity = this.db.prepare(
      'INSERT INTO entities (collection, name, type, description) VALUES (?, ?, ?, ?) ON CONFLICT(collection, name) DO UPDATE SET type = excluded.type, description = excluded.description',
    )
    const selectEntity = this.db.prepare('SELECT id FROM entities WHERE collection = ? AND name = ?')
    const insertMention = this.db.prepare('INSERT OR IGNORE INTO mentions (entity_id, chunk_id) VALUES (?, ?)')
    const insertRelation = this.db.prepare('INSERT INTO relations (collection, source, target, description) VALUES (?, ?, ?, ?)')
    for (const entity of graph.entities) {
      upsertEntity.run(collection, entity.name, entity.type, entity.description)
      const row = selectEntity.get(collection, entity.name) as { id: number } | undefined
      if (row === undefined) continue
      for (const chunkId of chunkIds) insertMention.run(row.id, chunkId)
    }
    for (const relation of graph.relations) insertRelation.run(collection, relation.source, relation.target, relation.description)
  }

  /**
   * Rank stored chunks against a query vector.
   * @param query - query embedding.
   * @param topK - maximum results.
   * @param folders - only documents under one of these folder paths; all when absent.
   * @returns the most similar chunks with their scores.
   */
  search(query: Float32Array, topK: number, folders?: readonly string[]): MemoryHit[] {
    const prefixes = folders?.map(folder => folder.endsWith('/') ? folder : `${folder}/`)
    const vectors = this.db.prepare('SELECT chunk_id, embedding FROM vectors').all()
    const chunk = this.db.prepare('SELECT d.path AS source, d.collection, c.heading, c.text FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id = ?')
    const scored = vectors
      .map(row => ({ id: Number(row.chunk_id), score: cosine(query, toVector(row.embedding as Uint8Array)) }))
      .sort((left, right) => right.score - left.score)
    const hits: MemoryHit[] = []
    for (const entry of scored) {
      if (hits.length >= topK) break
      const row = chunk.get(entry.id) as ChunkRow | undefined
      if (row === undefined) continue
      if (prefixes !== undefined && !prefixes.some(prefix => row.source.startsWith(prefix))) continue
      hits.push({
        source: row.source,
        collection: row.collection,
        ...row.heading === null ? {} : { heading: row.heading },
        text: row.text,
        score: entry.score,
      })
    }
    return hits
  }

  /**
   * Read the entities linked to the given chunk ids, with their one-hop relations.
   * @param chunkIds - chunk ids to expand.
   * @param limit - maximum entities to return.
   * @returns related entities carrying relation descriptions.
   */
  relatedEntities(chunkIds: readonly number[], limit: number): MemoryRelatedEntity[] {
    if (chunkIds.length === 0) return []
    const placeholders = chunkIds.map(() => '?').join(', ')
    const rows = this.db.prepare(
      `SELECT DISTINCT e.id, e.collection, e.name, e.type, e.description FROM entities e JOIN mentions m ON m.entity_id = e.id WHERE m.chunk_id IN (${placeholders})`,
    ).all(...chunkIds)
    const relations = this.db.prepare('SELECT description FROM relations WHERE collection = ? AND (source = ? OR target = ?)')
    const out: MemoryRelatedEntity[] = []
    for (const row of rows) {
      if (out.length >= limit) break
      const name = String(row.name)
      const linked = relations.all(String(row.collection), name, name).map(entry => String(entry.description))
      out.push({ name, type: String(row.type), description: String(row.description), relations: linked })
    }
    return out
  }

  /**
   * Resolve the chunk ids a query's best hits came from, for graph expansion.
   * @param hits - search hits.
   * @returns matching chunk ids.
   */
  chunkIdsFor(hits: readonly MemoryHit[]): number[] {
    const find = this.db.prepare('SELECT c.id FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.path = ? AND c.text = ?')
    const ids: number[] = []
    for (const hit of hits) {
      const row = find.get(hit.source, hit.text) as { id: number } | undefined
      if (row !== undefined) ids.push(Number(row.id))
    }
    return ids
  }

  /**
   * List the indexed documents of one knowledge base.
   * @param collection - knowledge-base id.
   * @returns each document's path, source modification time, and chunk count, by path.
   */
  documents(collection: string): MemoryDocument[] {
    return this.db.prepare(
      'SELECT d.path AS path, d.mtime AS mtime, COUNT(c.id) AS chunks FROM documents d LEFT JOIN chunks c ON c.document_id = d.id WHERE d.collection = ? GROUP BY d.id ORDER BY d.path',
    ).all(collection).map(row => ({ path: String(row.path), modified: Number(row.mtime), chunks: Number(row.chunks) }))
  }

  /**
   * Count stored rows and the vector dimension.
   * @returns current counts.
   */
  counts(): StoreCounts {
    const count = (table: string): number => (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
    const dimension = this.db.prepare('SELECT dim FROM vectors LIMIT 1').get() as { dim: number } | undefined
    const perCollection = this.db.prepare('SELECT collection AS id, COUNT(*) AS n FROM documents GROUP BY collection').all()
      .map(row => ({ id: String(row.id), documents: Number(row.n) }))
    return {
      documents: count('documents'),
      chunks: count('chunks'),
      entities: count('entities'),
      relations: count('relations'),
      dimensions: dimension === undefined ? undefined : Number(dimension.dim),
      collections: perCollection,
    }
  }

  /** Close the database connection. */
  close(): void {
    this.db.close()
  }
}
