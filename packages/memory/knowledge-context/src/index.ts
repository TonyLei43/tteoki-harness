/**
 * Knowledge-first grounding. On the first step of every turn that the user
 * opens with a message, this plugin searches the user's knowledge bases with
 * that message (together with the earlier questions when it is a short
 * follow-up) and adds the best passages to the request as one context
 * message, numbered `[K1]`, `[K2]`, …, with the instruction to answer from the
 * notes first and then confirm with outside sources cited as `[W1]`, `[W2]`, ….
 * The message is appended through `agent/pre-step`, so it is logged as a
 * `user/message` whose source records the query and the passages; the chat
 * renders that source as the turn's Sources card.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, UserMessage } from '@deepseek-ai/dsh-llm'
import type { MemoryHit } from '@deepseek-ai/dsh-memory'
import { SessionSeq } from '@deepseek-ai/dsh-session'

/** One passage the grounding step retrieved, as recorded in the message source. */
export interface KnowledgePassage {
  /** Citation label, such as `K1`. */
  readonly label: string
  /** Knowledge base id. */
  readonly collection: string
  /** Source document path. */
  readonly source: string
  /** Nearest heading above the passage, such as `Page 3` or `Lecture 2`. */
  readonly heading?: string
  /** 1-based page, when the heading names one. */
  readonly page?: number
  /** Passage text as the model saw it. */
  readonly text: string
  /** Cosine similarity. */
  readonly score: number
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'knowledge-context': {
      readonly kind: 'knowledge-context'
      /** The user's message. */
      readonly query: string
      /** What was searched: the message, preceded by earlier questions when it is a short follow-up. */
      readonly searched?: string
      /** Knowledge bases searched; empty means all. */
      readonly knowledgeBases: readonly string[]
      /** Passages given to the model, best first. */
      readonly passages: readonly KnowledgePassage[]
      /** Why the search failed, when it did. */
      readonly error?: string
    } & ContextFormed
  }
}

export const name = 'knowledge-context'

export const inject = ['memory']

/** Grounding policy. */
export interface Config {
  /** Knowledge bases searched; `*` searches every one. */
  knowledgeBases: string[]
  /** Passages retrieved per turn. */
  topK?: number
  /** Minimum cosine similarity for a passage to be included. */
  minScore?: number
  /** Characters of each passage given to the model. */
  maxPassageChars?: number
  /** Whether the model is told to confirm with outside sources (needs web tools in the same agent). */
  verify?: boolean
  /** Whether the model is told to connect ideas and show them with `mind_map` (needs tool-mind-map in the same agent). */
  mindMap?: boolean
}

export const Config: z<Config> = z.object({
  knowledgeBases: z.array(z.string()).required(),
  topK: z.natural().min(1).max(20).default(6),
  minScore: z.number().min(-1).max(1).default(0.35),
  maxPassageChars: z.natural().min(200).max(4000).default(900),
  verify: z.boolean().default(true),
  mindMap: z.boolean().default(false),
})

/** Longest query sent to the embedding model. */
const MAX_QUERY_CHARS = 1000

/** Messages shorter than this many words are follow-ups searched together with the earlier questions. */
const FOLLOW_UP_WORDS = 12

/** Earlier questions a follow-up is searched with. */
const EARLIER_QUESTIONS = 2

/**
 * The user's earlier questions in this session, most recent last.
 * @param agent - the agent whose session log is read.
 * @param limit - most questions returned.
 * @returns the texts of the latest user-typed messages already in the log.
 */
export function earlierQuestions(agent: Agent, limit: number): string[] {
  const found: string[] = []
  for (let seq = agent.session.seq - 1; seq >= 0 && found.length < limit; seq -= 1) {
    // oxlint-disable-next-line typescript/no-deprecated -- Bounded backward read of recent history, as time-context does.
    const event = agent.session.eventAt(SessionSeq(seq))
    if (event?.type !== 'user/message' || event.data.source.kind !== 'user') continue
    const text = userQuery([event.data])
    if (text !== '') found.unshift(text)
  }
  return found
}

/**
 * The text searched for a message: the message itself, or for a short
 * follow-up such as "and the proof?", the earlier questions followed by it.
 * @param latest - the user's message.
 * @param earlier - earlier questions, most recent last.
 * @returns the search text.
 */
export function searchText(latest: string, earlier: readonly string[]): string {
  if (earlier.length === 0 || latest.split(/\s+/).length >= FOLLOW_UP_WORDS) return latest
  return [...earlier, latest].join('\n').slice(-MAX_QUERY_CHARS)
}

/**
 * The text of the user-typed messages among a step's input.
 * @param messages - the step's claimed input.
 * @returns the joined user text, empty when the step has no user message.
 */
export function userQuery(messages: readonly UserMessage[]): string {
  return messages
    .filter(message => message.source.kind === 'user')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim()
    .slice(0, MAX_QUERY_CHARS)
}

/**
 * Drop repeated passages: the same text indexed from two copies of a file, or
 * two chunks of one section of one file.
 * @param hits - search hits, best first.
 * @returns the best hit of each distinct passage, in order.
 */
export function distinctHits(hits: readonly MemoryHit[]): MemoryHit[] {
  const seen = new Set<string>()
  return hits.filter((hit) => {
    const text = `text:${hit.text.replace(/\s+/g, ' ').trim().slice(0, 200).toLowerCase()}`
    const section = `section:${hit.source}#${hit.heading ?? ''}`
    if (seen.has(text) || seen.has(section)) return false
    seen.add(text)
    seen.add(section)
    return true
  })
}

/**
 * Number and trim the passages worth showing.
 * @param hits - search hits, best first.
 * @param minScore - similarity floor.
 * @param maxChars - passage length limit.
 * @param limit - most passages kept.
 * @returns labeled passages.
 */
export function toPassages(hits: readonly MemoryHit[], minScore: number, maxChars: number, limit = Number.POSITIVE_INFINITY): KnowledgePassage[] {
  return distinctHits(hits.filter(hit => hit.score >= minScore)).slice(0, limit).map((hit, index) => {
    const page = /^Page (\d+)\b/.exec(hit.heading ?? '')?.[1]
    const text = hit.text.length > maxChars ? `${hit.text.slice(0, maxChars).trimEnd()} …` : hit.text
    return {
      label: `K${index + 1}`,
      collection: hit.collection,
      source: hit.source,
      ...hit.heading === undefined ? {} : { heading: hit.heading },
      ...page === undefined ? {} : { page: Number(page) },
      text,
      score: Math.round(hit.score * 100) / 100,
    }
  })
}

/**
 * The model-facing grounding text.
 * @param passages - retrieved passages.
 * @param scope - names of the searched knowledge bases.
 * @param verify - whether to ask for confirmation from outside sources.
 * @param error - search failure, if any.
 * @param mindMap - whether to ask for connections and a mind map.
 * @returns the context text.
 */
export function groundingText(passages: readonly KnowledgePassage[], scope: string, verify: boolean, error?: string, mindMap = false): string {
  const connect = mindMap
    ? ' When the user is studying or asks how ideas relate, go beyond the direct answer: connect it to related definitions, results, and earlier lectures or other courses in these notes, and call mind_map to show those connections with their [K] citations.'
    : ''
  const outside = verify
    ? ' Then check the key facts against outside sources with web search, cite those as [W1], [W2], …, and say plainly where the notes and outside sources disagree.'
    : ''
  if (error !== undefined) {
    return `Searching the user's knowledge base (${scope}) for this message failed: ${error}. Tell the user their notes could not be searched.${verify ? ' Answer from outside sources with web search and cite them as [W1], [W2], ….' : ''}`
  }
  if (passages.length === 0) {
    return `No passage in the user's knowledge base (${scope}) matched this message. Say that their notes do not cover it.${verify ? ' Answer from outside sources with web search and cite them as [W1], [W2], ….' : ''}`
  }
  return [
    `Passages from the user's own notes (${scope}) that match this message, best first. Answer from these first and cite them inline as [K1], [K2], …; ignore passages that are not relevant.${outside}${connect} If the notes do not answer the question, say so.`,
    '',
    ...passages.flatMap(passage => [
      `[${passage.label}] ${passage.source}${passage.heading === undefined ? '' : ` — ${passage.heading}`}`,
      passage.text,
      '',
    ]),
  ].join('\n').trimEnd()
}

/**
 * Register the grounding step.
 * @param ctx - plugin context.
 * @param config - grounding policy.
 */
export function apply(ctx: Context, config: Config): void {
  const all = config.knowledgeBases.includes('*')
  const collections = all ? undefined : config.knowledgeBases
  const topK = config.topK ?? 6
  const minScore = config.minScore ?? 0.35
  const maxChars = config.maxPassageChars ?? 900
  const verify = config.verify ?? true
  const mindMap = config.mindMap ?? false
  ctx.on('agent/pre-step', async ({ agent, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || step !== 1 || signal.aborted) return decision
    const query = userQuery(decision.messages)
    if (query === '') return decision
    const searched = searchText(query, earlierQuestions(agent, EARLIER_QUESTIONS))
    const settings = ctx.memory.getSettings()
    const bases = settings.collections.filter(collection => collections === undefined || collections.includes(collection.id))
    const scope = bases.map(collection => collection.name).join(', ') || 'none configured'
    let passages: KnowledgePassage[] = []
    let error: string | undefined
    try {
      // Twice as many candidates, so dropping repeats still leaves topK passages.
      const result = await ctx.memory.search({ query: searched, topK: topK * 2, ...collections === undefined ? {} : { collections } }, signal)
      passages = toPassages(result.hits, minScore, maxChars, topK)
    } catch (failure: unknown) {
      if (signal.aborted) return decision
      error = failure instanceof Error ? failure.message : String(failure)
    }
    const text = groundingText(passages, scope, verify, error, mindMap)
    const summary = error !== undefined
      ? 'Knowledge search failed'
      : `Searched ${scope}: ${passages.length === 0 ? 'no matching passages' : `${passages.length} passage${passages.length === 1 ? '' : 's'}`}`
    return {
      ...decision,
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: {
            kind: 'knowledge-context',
            form: 'notice',
            summary,
            query,
            ...searched === query ? {} : { searched },
            knowledgeBases: collections ?? [],
            passages,
            ...error === undefined ? {} : { error },
          },
        }),
      ],
    }
  })
}
