/**
 * Model-facing tools over the memory service, scoped to the knowledge bases one
 * agent preset may reach: passage search, indexing, and named memory notes.
 * Every tool call checks its knowledge base against the configured scope, so a
 * preset for one knowledge base cannot read or write another.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { MemoryCollection } from '@deepseek-ai/dsh-memory'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'tool-memory'

export const inject = ['tools', 'memory']

/** Which knowledge bases this agent reaches. */
export interface Config {
  /** Knowledge-base ids; `['*']` reaches every configured knowledge base, including ones added later. */
  knowledgeBases: string[]
}

export const Config: z<Config> = z.object({
  knowledgeBases: z.array(z.string()).required(),
})

/** Longest search result list the model may request. */
const MAX_TOP_K = 20

/**
 * Describe knowledge bases for a tool description.
 * @param collections - knowledge bases in scope.
 * @returns one line per knowledge base.
 */
function catalog(collections: readonly MemoryCollection[]): string {
  return collections.map(collection => `- ${collection.id} (${collection.name})${collection.description === undefined ? '' : `: ${collection.description}`}`).join('\n')
}

/**
 * Register the scoped knowledge-base tools.
 * @param ctx - preset context with `tools` and `memory` injected.
 * @param config - knowledge-base scope.
 * @throws Error when the scope is empty or names an unconfigured knowledge base.
 */
export function apply(ctx: Context, config: Config): void {
  const everything = config.knowledgeBases.includes('*')
  const configured = ctx.memory.getSettings().collections
  if (!everything) {
    if (config.knowledgeBases.length === 0) throw new Error('tool-memory: knowledgeBases must name at least one knowledge base or "*"')
    for (const id of config.knowledgeBases) {
      if (!configured.some(collection => collection.id === id)) throw new Error(`tool-memory: unknown knowledge base "${id}"`)
    }
  }
  const visible = everything ? configured : configured.filter(collection => config.knowledgeBases.includes(collection.id))
  const single = !everything && visible.length === 1 ? visible[0] : undefined
  const scopeText = single === undefined
    ? `Knowledge bases you can use:\n${catalog(visible)}`
    : `This searches the "${single.name}" knowledge base${single.description === undefined ? '' : ` (${single.description})`}.`

  /**
   * Resolve the knowledge bases one call may reach.
   * @param requested - the model's `knowledge_base` argument.
   * @returns ids to pass to the service, or undefined for every configured knowledge base.
   * @throws Error when the requested knowledge base is outside the scope.
   */
  const scopeFor = (requested: string | undefined): string[] | undefined => {
    if (requested !== undefined) {
      if (!everything && !config.knowledgeBases.includes(requested)) throw new Error(`knowledge base "${requested}" is not available here; use one of: ${config.knowledgeBases.join(', ')}`)
      return [requested]
    }
    return everything ? undefined : [...config.knowledgeBases]
  }

  /**
   * Resolve the one knowledge base a note operation targets.
   * @param requested - the model's `knowledge_base` argument.
   * @returns the knowledge-base id.
   * @throws Error when none is given and the scope has several, or the id is outside the scope.
   */
  const targetFor = (requested: string | undefined): string => {
    const ids = scopeFor(requested)
    if (ids?.length === 1 && ids[0] !== undefined) return ids[0]
    throw new Error(`knowledge_base is required; use one of: ${visible.map(collection => collection.id).join(', ')}`)
  }

  const knowledgeBaseParameter = single === undefined
    ? { knowledge_base: { type: 'string', description: 'Knowledge base id.' } } as const
    : {}

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'knowledge_search',
    description: `Search the user's own notes and documents for passages relevant to a query, plus related entities. Use it when the answer may live in their coursework, papers, or saved notes, and cite the returned source paths. ${scopeText}`,
    parameters: {
      query: { type: 'string', required: true, description: 'What to look for, in natural language.' },
      top_k: { type: 'integer', description: `Maximum passages to return, 1 to ${MAX_TOP_K}.` },
      ...single === undefined ? { knowledge_base: { type: 'string', description: 'Search only this knowledge base id; omit to search all of them.' } } as const : {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                source: { type: 'string', required: true },
                knowledge_base: { type: 'string', required: true },
                heading: { type: 'string' },
                text: { type: 'string', required: true },
                score: { type: 'number', required: true },
              },
            },
          },
          entities: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                type: { type: 'string', required: true },
                description: { type: 'string', required: true },
                relations: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const parts: string[] = []
        if (value.results.length === 0) parts.push('No passages matched.')
        else {
          parts.push(value.results
            .map(hit => `[${hit.score.toFixed(3)}] ${hit.knowledge_base}: ${hit.source}${hit.heading === undefined ? '' : ` — ${hit.heading}`}\n${hit.text}`)
            .join('\n\n'))
        }
        if (value.entities.length > 0) {
          parts.push(`Related entities:\n${value.entities.map(entity => `- ${entity.name} (${entity.type})${entity.relations.length === 0 ? '' : `: ${entity.relations.join('; ')}`}`).join('\n')}`)
        }
        return [{ type: 'text', text: parts.join('\n\n') }]
      },
    },
    execute: async (args, exec) => {
      const collections = scopeFor('knowledge_base' in args ? args.knowledge_base : undefined)
      const value = await ctx.memory.search({
        query: args.query,
        ...args.top_k === undefined ? {} : { topK: Math.min(Math.max(args.top_k, 1), MAX_TOP_K) },
        ...collections === undefined ? {} : { collections },
      }, exec.signal)
      return {
        results: value.hits.map(hit => ({
          source: hit.source,
          knowledge_base: hit.collection,
          ...hit.heading === undefined ? {} : { heading: hit.heading },
          text: hit.text,
          score: hit.score,
        })),
        entities: value.entities.map(entity => ({ name: entity.name, type: entity.type, description: entity.description, relations: [...entity.relations] })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Search knowledge base', kind: 'read', rawInput: args.query }),
  })), 'tool-memory: knowledge_search')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'knowledge_index',
    description: `Re-index knowledge-base sources and saved memory notes so knowledge_search finds new or edited documents. Unchanged documents are skipped. ${scopeText}`,
    parameters: {
      ...single === undefined ? { knowledge_base: { type: 'string', description: 'Index only this knowledge base id; omit to index all of them.' } } as const : {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          documents: { type: 'integer', required: true },
          skipped: { type: 'integer', required: true },
          failures: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Indexed ${value.documents} document(s); ${value.skipped} unchanged.${value.failures.length === 0 ? '' : `\nFailures:\n${value.failures.map(failure => `- ${failure}`).join('\n')}`}`,
      }],
    },
    execute: async (args, exec) => {
      const collections = scopeFor('knowledge_base' in args ? args.knowledge_base : undefined)
      const value = await ctx.memory.index(collections === undefined ? {} : { collections }, exec.signal)
      const reached = collections === undefined ? value.collections : value.collections.filter(entry => collections.includes(entry.id))
      return {
        documents: reached.reduce((total, entry) => total + entry.documents, 0),
        skipped: value.skipped,
        failures: value.failures.map(failure => `${failure.path}: ${failure.message}`),
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Index knowledge base', kind: 'other' }),
  })), 'tool-memory: knowledge_index')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'memory_list',
    description: `List the names of saved memory notes. Check it at the start of a task for notes about the user, their courses, or earlier conclusions. ${scopeText}`,
    parameters: { ...knowledgeBaseParameter },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { names: { type: 'array', required: true, items: { type: 'string' } } } },
      render: (_args, value) => [{ type: 'text', text: value.names.length === 0 ? 'No memory notes yet.' : value.names.join('\n') }],
    },
    execute: async args => await ctx.memory.listNotes({ collection: targetFor('knowledge_base' in args ? args.knowledge_base : undefined) }),
    presentCall: () => ({ card: 'generic', title: 'List memory notes', kind: 'read' }),
  })), 'tool-memory: memory_list')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'memory_read',
    description: `Read one saved memory note by name. ${scopeText}`,
    parameters: {
      name: { type: 'string', required: true, description: 'Note name from memory_list.' },
      ...knowledgeBaseParameter,
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.content }],
    },
    execute: async args => await ctx.memory.readNote({ collection: targetFor('knowledge_base' in args ? args.knowledge_base : undefined), name: args.name }),
    presentCall: args => ({ card: 'generic', title: 'Read memory note', kind: 'read', rawInput: args.name }),
  })), 'tool-memory: memory_read')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'memory_write',
    description: `Save a memory note that later sessions can read and search: durable facts about the user, their courses, conventions, or conclusions worth keeping. It replaces any note with the same name, so read an existing note first and write the merged content. Keep notes short and specific. ${scopeText}`,
    parameters: {
      name: { type: 'string', required: true, description: 'Short note name: letters, digits, spaces, ".", "-", "_".' },
      content: { type: 'string', required: true, description: 'Full Markdown content of the note.' },
      ...knowledgeBaseParameter,
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Saved memory note "${value.name}".` }],
    },
    execute: async args => await ctx.memory.writeNote({ collection: targetFor('knowledge_base' in args ? args.knowledge_base : undefined), name: args.name, content: args.content }),
    presentCall: args => ({ card: 'generic', title: 'Save memory note', kind: 'edit', rawInput: args.name }),
  })), 'tool-memory: memory_write')
}
