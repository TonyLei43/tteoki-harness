/**
 * Memory browser half: a `settings.section` entry that configures the memory
 * layer, and a Knowledge main panel with its sidebar entry for search, memory
 * notes, and indexing, both over the generated `memory` Remote namespace.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the slot registry merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the layout SlotMap merge (the 'main' keyed slot).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the sidebar's SlotMap merge (the 'sidebar.panellist' list).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: the ctx.remote merge and the memory wire vocabulary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { KnowledgePanel } from './KnowledgePanel.tsx'
import type { KnowledgePanelInjected } from './KnowledgePanel.tsx'
import { KnowledgePanelIcon } from './KnowledgePanelIcon.tsx'
import { en as knowledgeEn } from './knowledge-locales.ts'
import { MemorySection } from './MemorySection.tsx'
import type { MemorySectionInjected } from './MemorySection.tsx'
import { en, zh } from './locales.ts'

export type { KnowledgePanelInjected, KnowledgePanelProps } from './KnowledgePanel.tsx'
export type { MemorySectionInjected, MemorySectionProps } from './MemorySection.tsx'

/** Dictionary namespace of the settings section. */
const NS = 'memory'

/** Dictionary namespace of the Knowledge panel. */
const KNOWLEDGE_NS = 'knowledge'

/** Main-panel and sidebar-entry id of the Knowledge panel. */
const PANEL_ID = 'knowledge' as MainPanelId

/** Required services: slots, locale, and the mounted memory Remote namespace. */
export const inject = ['slots', 'locale', 'remote', 'remote.memory', 'remote.workspaceFiles']

/** Text pages the Knowledge preview reads before it stops and reports truncation. */
const MAX_PREVIEW_PAGES = 40

/**
 * Unwrap a Remote result.
 * @param method - method name for the failure message.
 * @param result - the Remote call result.
 * @returns the success value.
 * @throws Error naming the method, code, and message on failure.
 */
function unwrap<T>(method: string, result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`memory/${method} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

/**
 * Mount the Memory settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-memory: dictionaries')

  const injected = (): MemorySectionInjected => ({
    load: async () => {
      const [settings, status] = await Promise.all([ctx.remote.memory.getSettings(), ctx.remote.memory.status()])
      if (!settings.ok) throw new Error(`memory/getSettings failed: ${settings.error.code}: ${settings.error.message}`)
      if (!status.ok) throw new Error(`memory/status failed: ${status.error.code}: ${status.error.message}`)
      return { settings: settings.value, status: status.value }
    },
    save: async (update) => {
      const result = await ctx.remote.memory.setSettings(update)
      if (!result.ok) throw new Error(`memory/setSettings failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    listModels: async () => {
      const result = await ctx.remote.memory.listModels()
      if (!result.ok) throw new Error(`memory/listModels failed: ${result.error.code}: ${result.error.message}`)
      return result.value.models
    },
    index: async (collection) => {
      const result = await ctx.remote.memory.index(collection === undefined ? {} : { collections: [collection] })
      if (!result.ok) throw new Error(`memory/index failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    search: async (query) => {
      const result = await ctx.remote.memory.search({ query })
      if (!result.ok) throw new Error(`memory/search failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'memory',
    order: 23,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, MemorySection))

  const tk = ctx.locale.bind(KNOWLEDGE_NS)
  ctx.effect(() => ctx.locale.register(KNOWLEDGE_NS, 'en', knowledgeEn), 'ui-memory: knowledge dictionaries')
  const knowledge: KnowledgePanelInjected = {
    load: async () => {
      const [settings, status] = await Promise.all([ctx.remote.memory.getSettings(), ctx.remote.memory.status()])
      return { collections: unwrap('getSettings', settings).collections, status: unwrap('status', status) }
    },
    search: async (query, collections) => unwrap('search', await ctx.remote.memory.search(collections === undefined ? { query } : { query, collections })),
    index: async collections => unwrap('index', await ctx.remote.memory.index(collections === undefined ? {} : { collections })),
    listDocuments: async collection => unwrap('listDocuments', await ctx.remote.memory.listDocuments({ collection })),
    listNotes: async collection => unwrap('listNotes', await ctx.remote.memory.listNotes({ collection })).names,
    readNote: async (collection, name) => unwrap('readNote', await ctx.remote.memory.readNote({ collection, name })).content,
    writeNote: async (collection, name, content) => { unwrap('writeNote', await ctx.remote.memory.writeNote({ collection, name, content })) },
    previewPage: async (source, page) => unwrap('previewPage', await ctx.remote.memory.previewPage({ source, page })).image,
    readDocument: async (sessionId, path, signal) => {
      let offset = 1
      let text = ''
      for (let page = 0; page < MAX_PREVIEW_PAGES; page += 1) {
        const result = await ctx.remote.workspaceFiles.read(sessionId, path, { offset }, signal)
        if (!result.ok) throw new Error(`workspaceFiles/read failed: ${result.error.code}: ${result.error.message}`)
        text += `${page === 0 ? '' : '\n'}${result.value.text}`
        if (result.value.eof) return { text, truncated: false }
        offset += result.value.lines
      }
      return { text, truncated: true }
    },
  }
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: KNOWLEDGE_NS,
    inject: (): KnowledgePanelInjected => knowledge,
  }, KnowledgePanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 15,
    locale: KNOWLEDGE_NS,
    label: () => tk('nav'),
  }, KnowledgePanelIcon))
}
