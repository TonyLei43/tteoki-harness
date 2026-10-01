/** Mutable memory-layer settings: defaults, migration, validation, persistence. */

import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { expandHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { DEFAULT_EXCLUDE_DIRS } from './ingest.ts'
import type { MemoryCollection, MemorySettings, MemorySettingsUpdate } from './types.ts'

/** Embedding and extraction defaults; a deployment overrides these in the store. */
export const DEFAULT_SETTINGS: MemorySettings = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  apiKey: '',
  apiKeyEnv: 'OPENAI_API_KEY',
  chatModel: 'gpt-4o-mini',
  graphEnabled: true,
  collections: [],
  chunkChars: 1200,
  overlapChars: 200,
  topK: 6,
  excludeDirs: DEFAULT_EXCLUDE_DIRS,
  ocrConcurrency: 1,
  maxDocumentChars: 2_000_000,
}

/**
 * Absolute settings file under the harness home.
 * @param home - resolved harness home.
 * @returns the settings file path.
 */
export function settingsFile(home: string): string {
  return join(home, 'memory', 'config.json')
}

/** Knowledge-base ids: safe as one path segment and as a tool argument. */
const COLLECTION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/**
 * Absolute storage directory of one knowledge base: its `index.db` and `memories/`.
 * @param home - resolved harness home.
 * @param id - knowledge-base id.
 * @returns the directory path.
 * @throws Error when the id is not a single safe path segment.
 */
export function collectionDir(home: string, id: string): string {
  if (!COLLECTION_ID.test(id)) throw new Error(`invalid knowledge base id "${id}"`)
  return join(home, 'memory', 'kb', id)
}

/**
 * Resolve the harness home for the memory layer.
 * @param configured - explicit override.
 * @returns the resolved harness home.
 */
export function resolveHome(configured: string | undefined): string {
  return configured ?? resolveDshHome()
}

/** Legacy shape carrying one flat `sources` list. */
interface LegacySettings {
  readonly sources?: readonly string[]
}

/**
 * Read stored settings, migrating the legacy flat source list and merging defaults.
 * @param file - absolute settings path.
 * @returns the effective settings.
 */
export function readSettings(file: string): MemorySettings {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<MemorySettings> & LegacySettings
    const migrated: Partial<MemorySettings> = parsed.collections === undefined && (parsed.sources?.length ?? 0) > 0
      ? { ...parsed, collections: [{ id: 'default', name: 'Default', sources: parsed.sources ?? [] }] }
      : parsed
    return normalize({ ...DEFAULT_SETTINGS, ...migrated })
  } catch {
    // Absent or unreadable settings fall back to defaults.
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Merge and validate a settings update.
 * @param current - current settings.
 * @param update - partial update.
 * @returns the next settings.
 * @throws RemoteError when a value is invalid.
 */
export function applyUpdate(current: MemorySettings, update: MemorySettingsUpdate): MemorySettings {
  const { remoteChat, visionModel, remoteVision, ...rest } = update
  const { remoteChat: currentRemote, visionModel: currentVision, remoteVision: currentRemoteVision, ...base } = current
  const nextRemote = remoteChat === undefined ? currentRemote : remoteChat ?? undefined
  const nextVision = visionModel === undefined ? currentVision : visionModel?.trim() || undefined
  const nextRemoteVision = remoteVision === undefined ? currentRemoteVision : remoteVision ?? undefined
  const merged: MemorySettings = {
    ...base,
    ...rest,
    ...nextRemote === undefined ? {} : { remoteChat: nextRemote },
    ...nextVision === undefined ? {} : { visionModel: nextVision },
    ...nextRemoteVision === undefined ? {} : { remoteVision: nextRemoteVision },
  }
  if (!Number.isInteger(merged.ocrConcurrency) || merged.ocrConcurrency < 1 || merged.ocrConcurrency > 16) {
    throw new RemoteError('gateway/bad-request', 'ocrConcurrency must be an integer from 1 to 16', {})
  }
  if (merged.remoteVision !== undefined) {
    for (const field of ['baseUrl', 'model', 'apiKeyEnv'] as const) {
      if (merged.remoteVision[field].trim() === '') throw new RemoteError('gateway/bad-request', `remoteVision.${field} must not be empty`, {})
    }
  }
  for (const field of ['baseUrl', 'model', 'chatModel'] as const) {
    if (merged[field].trim() === '') {
      throw new RemoteError('gateway/bad-request', `${field} must not be empty`, {})
    }
  }
  if (!Number.isInteger(merged.chunkChars) || merged.chunkChars < 256) {
    throw new RemoteError('gateway/bad-request', 'chunkChars must be an integer of at least 256', {})
  }
  if (!Number.isInteger(merged.overlapChars) || merged.overlapChars < 0 || merged.overlapChars >= merged.chunkChars) {
    throw new RemoteError('gateway/bad-request', 'overlapChars must be an integer below chunkChars', {})
  }
  if (!Number.isInteger(merged.topK) || merged.topK < 1) {
    throw new RemoteError('gateway/bad-request', 'topK must be a positive integer', {})
  }
  if (!Number.isInteger(merged.maxDocumentChars) || merged.maxDocumentChars < merged.chunkChars) {
    throw new RemoteError('gateway/bad-request', 'maxDocumentChars must be an integer of at least chunkChars', {})
  }
  if (merged.remoteChat !== undefined) {
    for (const field of ['baseUrl', 'model', 'apiKeyEnv'] as const) {
      if (merged.remoteChat[field].trim() === '') throw new RemoteError('gateway/bad-request', `remoteChat.${field} must not be empty`, {})
    }
  }
  const ids = new Set<string>()
  for (const collection of merged.collections) {
    if (collection.id.trim() === '' || collection.name.trim() === '') {
      throw new RemoteError('gateway/bad-request', 'every collection needs an id and a name', {})
    }
    if (!COLLECTION_ID.test(collection.id.trim())) {
      throw new RemoteError('gateway/bad-request', `collection id "${collection.id}" may use only letters, digits, "-", and "_"`, {})
    }
    if (collection.chat === 'remote' && merged.remoteChat === undefined) {
      throw new RemoteError('gateway/bad-request', `collection "${collection.id}" uses remote chat, but remoteChat is not configured`, {})
    }
    if (ids.has(collection.id)) {
      throw new RemoteError('gateway/bad-request', `duplicate collection id "${collection.id}"`, {})
    }
    ids.add(collection.id)
  }
  return normalize(merged)
}

/**
 * Trim text fields and expand `~` in every collection source path.
 * @param settings - settings to normalize.
 * @returns normalized settings.
 */
export function normalize(settings: MemorySettings): MemorySettings {
  const seen = new Set<string>()
  const collections: MemoryCollection[] = []
  for (const collection of settings.collections) {
    const id = collection.id.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    const description = collection.description?.trim() ?? ''
    collections.push({
      id,
      name: collection.name.trim(),
      sources: collection.sources.map(source => expandHomePath(source.trim())).filter(source => source !== ''),
      ...description === '' ? {} : { description },
      ...collection.chat === 'remote' ? { chat: 'remote' as const } : {},
    })
  }
  return {
    ...settings,
    baseUrl: settings.baseUrl.replace(/\/+$/, ''),
    model: settings.model.trim(),
    apiKey: settings.apiKey.trim(),
    apiKeyEnv: settings.apiKeyEnv.trim(),
    chatModel: settings.chatModel.trim(),
    ...settings.remoteChat === undefined ? {} : {
      remoteChat: {
        baseUrl: settings.remoteChat.baseUrl.trim().replace(/\/+$/, ''),
        model: settings.remoteChat.model.trim(),
        apiKeyEnv: settings.remoteChat.apiKeyEnv.trim(),
      },
    },
    collections,
    excludeDirs: [...new Set(settings.excludeDirs.map(name => name.trim()).filter(name => name !== ''))],
  }
}

/**
 * Persist settings, creating the memory directory when absent.
 * @param file - absolute settings path.
 * @param settings - complete settings to write.
 */
export async function writeSettings(file: string, settings: MemorySettings): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}
