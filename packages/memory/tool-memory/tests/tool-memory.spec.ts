/** Scoped knowledge-base tools: descriptions, parameters, scope enforcement, and disposal. */

import { Context } from '@deepseek-ai/cordis'
import type { MemoryCollection, MemoryNoteRef, MemoryNoteWrite, MemorySearchRequest } from '@deepseek-ai/dsh-memory'
import { describe, expect, it, onTestFinished } from 'vitest'
import { apply } from '../src/index.ts'

interface RegisteredTool {
  name: string
  description: string
  parameters: { properties: Record<string, unknown> }
  execute: (args: Record<string, unknown>, exec: { signal: AbortSignal }) => Promise<Record<string, unknown>>
  output: { render: (args: unknown, value: never) => { text: string }[] }
  presentCall: (args: Record<string, unknown>) => unknown
}

const COLLECTIONS: MemoryCollection[] = [
  { id: 'academic', name: 'Academic', sources: [], description: 'UW statistics coursework' },
  { id: 'ai', name: 'AI', sources: [] },
  { id: 'personal', name: 'Personal', sources: [] },
]

/**
 * Mount the plugin against a fake memory service and tool registry.
 * @param knowledgeBases - the plugin scope.
 * @returns registered tools by name, recorded service calls, and the context.
 */
function mount(knowledgeBases: string[]) {
  const tools = new Map<string, RegisteredTool>()
  const calls: { method: string; request: unknown }[] = []
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  ctx.provide('tools', { register: (tool: RegisteredTool) => { tools.set(tool.name, tool); return () => { tools.delete(tool.name) } } } as never)
  ctx.provide('memory', {
    getSettings: () => ({ collections: COLLECTIONS }),
    search: async (request: MemorySearchRequest) => {
      calls.push({ method: 'search', request })
      return { hits: [{ source: '/n/a.md', collection: 'academic', heading: 'H', text: 't', score: 0.5 }, { source: '/n/b.md', collection: 'ai', text: 'u', score: 0.25 }], entities: [{ name: 'MLE', type: 'concept', description: 'd', relations: ['r'] }] }
    },
    index: async (request: unknown) => {
      calls.push({ method: 'index', request })
      return { collections: [{ id: 'academic', documents: 3 }, { id: 'ai', documents: 4 }], skipped: 1, failures: [{ path: '/q.pdf', message: 'needs OCR' }] }
    },
    listNotes: async (request: { collection: string }) => { calls.push({ method: 'listNotes', request }); return { names: [] } },
    readNote: async (request: MemoryNoteRef) => { calls.push({ method: 'readNote', request }); return { content: 'c' } },
    writeNote: async (request: MemoryNoteWrite) => { calls.push({ method: 'writeNote', request }); return { name: request.name } },
  } as never)
  apply(ctx, { knowledgeBases })
  return { tools, calls, ctx }
}

const exec = { signal: new AbortController().signal }

describe('tool-memory', () => {
  it('registers every tool and removes them on disposal', async () => {
    const { tools, ctx } = mount(['academic'])
    expect([...tools.keys()]).toEqual(['knowledge_search', 'knowledge_index', 'memory_list', 'memory_read', 'memory_write'])
    await ctx.fiber.dispose()
    expect(tools.size).toBe(0)
  })

  it('binds a single-knowledge-base scope without a knowledge_base parameter', async () => {
    const { tools, calls } = mount(['academic'])
    const search = tools.get('knowledge_search')!
    expect(search.description).toContain('This searches the "Academic" knowledge base (UW statistics coursework).')
    expect(Object.keys(search.parameters.properties)).toEqual(['query', 'top_k'])
    expect(Object.keys(tools.get('memory_write')!.parameters.properties)).toEqual(['name', 'content'])

    await expect(search.execute({ query: 'mle', top_k: 2 }, exec)).resolves.toMatchObject({ results: [{ knowledge_base: 'academic', heading: 'H' }, { knowledge_base: 'ai' }] })
    await tools.get('memory_write')!.execute({ name: 'n', content: 'c' }, exec)
    await tools.get('memory_read')!.execute({ name: 'n' }, exec)
    await tools.get('memory_list')!.execute({}, exec)
    await search.execute({ query: 'x', top_k: 500 }, exec)
    await search.execute({ query: 'y', top_k: 0 }, exec)
    expect(calls).toEqual([
      { method: 'search', request: { query: 'mle', topK: 2, collections: ['academic'] } },
      { method: 'writeNote', request: { collection: 'academic', name: 'n', content: 'c' } },
      { method: 'readNote', request: { collection: 'academic', name: 'n' } },
      { method: 'listNotes', request: { collection: 'academic' } },
      { method: 'search', request: { query: 'x', topK: 20, collections: ['academic'] } },
      { method: 'search', request: { query: 'y', topK: 1, collections: ['academic'] } },
    ])
  })

  it('lists the catalog for a multi-knowledge-base scope and rejects ids outside it at execution', async () => {
    const { tools, calls } = mount(['academic', 'ai'])
    const search = tools.get('knowledge_search')!
    expect(search.description).toContain('Knowledge bases you can use:\n- academic (Academic): UW statistics coursework\n- ai (AI)')
    expect(search.description).not.toContain('personal')
    await search.execute({ query: 'q' }, exec)
    await expect(search.execute({ query: 'q', knowledge_base: 'personal' }, exec)).rejects.toThrow('knowledge base "personal" is not available here; use one of: academic, ai')
    await expect(tools.get('memory_write')!.execute({ name: 'n', content: 'c', knowledge_base: 'personal' }, exec)).rejects.toThrow('not available here')
    await expect(tools.get('memory_list')!.execute({}, exec)).rejects.toThrow('knowledge_base is required; use one of: academic, ai')
    await tools.get('memory_list')!.execute({ knowledge_base: 'ai' }, exec)
    expect(calls).toEqual([
      { method: 'search', request: { query: 'q', collections: ['academic', 'ai'] } },
      { method: 'listNotes', request: { collection: 'ai' } },
    ])
  })

  it('reaches every knowledge base with "*" and still requires a target for notes', async () => {
    const { tools, calls } = mount(['*'])
    expect(tools.get('knowledge_search')!.description).toContain('- personal (Personal)')
    await tools.get('knowledge_search')!.execute({ query: 'q' }, exec)
    await tools.get('knowledge_search')!.execute({ query: 'q', knowledge_base: 'personal' }, exec)
    await expect(tools.get('memory_read')!.execute({ name: 'n' }, exec)).rejects.toThrow('knowledge_base is required; use one of: academic, ai, personal')
    await tools.get('knowledge_index')!.execute({}, exec)
    expect(calls).toEqual([
      { method: 'search', request: { query: 'q' } },
      { method: 'search', request: { query: 'q', collections: ['personal'] } },
      { method: 'index', request: {} },
    ])
  })

  it('reports index counts for the reached knowledge bases only', async () => {
    const { tools } = mount(['ai'])
    const index = tools.get('knowledge_index')!
    const value = await index.execute({}, exec)
    expect(value).toEqual({ documents: 4, skipped: 1, failures: ['/q.pdf: needs OCR'] })
    expect(index.output.render({}, value as never)[0]!.text).toBe('Indexed 4 document(s); 1 unchanged.\nFailures:\n- /q.pdf: needs OCR')
    expect(index.output.render({}, { documents: 0, skipped: 0, failures: [] } as never)[0]!.text).toBe('Indexed 0 document(s); 0 unchanged.')
  })

  it('renders results and notes for the model', async () => {
    const { tools } = mount(['academic'])
    const search = tools.get('knowledge_search')!
    const value = await search.execute({ query: 'q' }, exec)
    expect(search.output.render({}, value as never)[0]!.text).toBe('[0.500] academic: /n/a.md — H\nt\n\n[0.250] ai: /n/b.md\nu\n\nRelated entities:\n- MLE (concept): r')
    expect(search.output.render({}, { results: [], entities: [{ name: 'X', type: 't', description: 'd', relations: [] }] } as never)[0]!.text).toBe('No passages matched.\n\nRelated entities:\n- X (t)')
    expect(tools.get('memory_list')!.output.render({}, { names: [] } as never)[0]!.text).toBe('No memory notes yet.')
    expect(tools.get('memory_list')!.output.render({}, { names: ['a', 'b'] } as never)[0]!.text).toBe('a\nb')
    expect(tools.get('memory_read')!.output.render({}, { content: 'body' } as never)[0]!.text).toBe('body')
    expect(tools.get('memory_write')!.output.render({}, { name: 'n' } as never)[0]!.text).toBe('Saved memory note "n".')
    const validArgs: Record<string, Record<string, unknown>> = { knowledge_search: { query: 'q' }, knowledge_index: {}, memory_list: {}, memory_read: { name: 'n' }, memory_write: { name: 'n', content: 'c' } }
    for (const tool of tools.values()) expect(tool.presentCall(validArgs[tool.name]!)).toMatchObject({ card: 'generic' })
  })

  it('fails loud at load for an empty or unknown scope', () => {
    expect(() => mount([])).toThrow('tool-memory: knowledgeBases must name at least one knowledge base or "*"')
    expect(() => mount(['academic', 'nope'])).toThrow('tool-memory: unknown knowledge base "nope"')
  })
})
