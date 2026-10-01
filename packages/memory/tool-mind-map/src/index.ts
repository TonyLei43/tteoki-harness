/**
 * The `mind_map` tool: the model shows the user how ideas connect as a visual
 * map — a center topic, the concepts around it, and labeled links, each
 * concept tied to the note passages it comes from. The map lives in the call's
 * arguments, which the Web client draws as an interactive card; the tool only
 * checks it and confirms.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'tool-mind-map'

export const inject = ['tools']

/** Map size limits. */
export interface Config {
  /** Most concepts in one map. */
  maxConcepts?: number
}

export const Config: z<Config> = z.object({
  maxConcepts: z.natural().min(3).max(80).default(40),
})

/** One concept as the model sends it. */
export interface MindMapConcept {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly sources?: readonly string[]
}

/** One link as the model sends it. */
export interface MindMapConnection {
  readonly from: string
  readonly to: string
  readonly label?: string
}

/**
 * Check a map.
 * @param center - center concept id.
 * @param concepts - concepts.
 * @param links - links.
 * @param maxConcepts - size limit.
 * @returns an error message, or undefined when the map is valid.
 */
export function checkMap(center: string, concepts: readonly MindMapConcept[], links: readonly MindMapConnection[], maxConcepts: number): string | undefined {
  if (concepts.length < 2) return 'a mind map needs at least 2 concepts'
  if (concepts.length > maxConcepts) return `a mind map holds at most ${maxConcepts} concepts; merge or drop the least important ones`
  const ids = new Set<string>()
  for (const concept of concepts) {
    if (concept.id.trim() === '' || concept.label.trim() === '') return 'every concept needs a non-empty id and label'
    if (ids.has(concept.id)) return `duplicate concept id "${concept.id}"`
    ids.add(concept.id)
  }
  if (!ids.has(center)) return `center "${center}" is not a concept id`
  if (links.length > maxConcepts * 2) return `a mind map holds at most ${maxConcepts * 2} links`
  for (const link of links) {
    if (!ids.has(link.from) || !ids.has(link.to)) return `link ${link.from} -> ${link.to} names an unknown concept`
    if (link.from === link.to) return `link ${link.from} -> ${link.to} connects a concept to itself`
  }
  return undefined
}

/**
 * Register the tool.
 * @param ctx - agent-scoped context with `tools`.
 * @param config - size limits.
 */
export function apply(ctx: Context, config: Config): void {
  const maxConcepts = config.maxConcepts ?? 40
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'mind_map',
    description: 'Show the user a visual mind map of how ideas connect: a center topic, the concepts around it, and labeled links between them. '
      + 'Use it when the user is studying or reviewing a topic, or asks how ideas relate, after you have the material (search the notes first). '
      + 'Prefer 6 to 20 concepts: definitions, theorems, proof steps, examples, and related ideas from other lectures or courses. '
      + 'Link each concept to what it depends on or leads to, and label every link with the relation ("used in the proof of", "special case of", "contrasts with"). '
      + 'Give each concept a one or two sentence detail and the note citations it comes from, such as "K2" or a file name. '
      + 'The map is shown to the user; still explain the main connections in your reply.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short title of the map.' },
      center: { type: 'string', required: true, description: 'Id of the central concept.' },
      concepts: {
        type: 'array', required: true, description: 'The concepts, including the center.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'Short unique id, such as "chebyshev".' },
            label: { type: 'string', required: true, description: 'Concept name as shown, under 26 characters when possible.' },
            detail: { type: 'string', description: 'One or two sentences on the concept in this context.' },
            sources: { type: 'array', items: { type: 'string' }, description: 'Note citations such as "K1", or file names.' },
          },
        },
      },
      links: {
        type: 'array', required: true, description: 'Connections between concepts.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            from: { type: 'string', required: true, description: 'Concept id.' },
            to: { type: 'string', required: true, description: 'Concept id.' },
            label: { type: 'string', description: 'The relation, read from `from` to `to`.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          concepts: { type: 'integer', required: true },
          links: { type: 'integer', required: true },
        },
      },
      render: (args, value) => [{ type: 'text', text: `Showed the mind map "${args.title}" to the user: ${value.concepts} concepts, ${value.links} links.` }],
    },
    execute: async (args) => {
      const error = checkMap(args.center, args.concepts, args.links, maxConcepts)
      if (error !== undefined) throw new Error(error)
      return { concepts: args.concepts.length, links: args.links.length }
    },
    presentCall: args => ({ card: 'generic', title: 'Mind map', kind: 'other', rawInput: args.title }),
  })), 'tool-mind-map: mind_map')
}
