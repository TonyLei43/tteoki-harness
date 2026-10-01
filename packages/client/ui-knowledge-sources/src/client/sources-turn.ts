/**
 * Turn-scoped projection of the knowledge grounding. The `knowledge-context`
 * plugin logs one `user/message` per grounded turn whose source records the
 * searched query and the passages the model received; this Definition
 * publishes that record against the Turn it was logged in so the Turn tail
 * can render it, and Session-log replay reproduces the card with no Host call.
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { ConversationNodeDefinition, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** One passage the model received, read back from the log. */
export interface SourcePassage {
  readonly label: string
  readonly collection: string
  readonly source: string
  readonly heading?: string
  readonly page?: number
  readonly text: string
  readonly score: number
}

/** The grounding of one Turn. */
export interface KnowledgeSourcesData {
  readonly query: string
  readonly passages: readonly SourcePassage[]
  readonly summary: string
  readonly error?: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** The knowledge grounding recorded in this Turn, when one ran. */
    'knowledge-sources': KnowledgeSourcesData
  }
}

/**
 * Read a logged `knowledge-context` source; the log is durable data written by
 * any version, so every field is checked.
 * @param source - the message source.
 * @returns the grounding, or undefined when the source is another kind or malformed.
 */
export function readSources(source: unknown): KnowledgeSourcesData | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const record = source as Record<string, unknown>
  if (record.kind !== 'knowledge-context' || typeof record.query !== 'string' || !Array.isArray(record.passages)) return undefined
  const entries: readonly unknown[] = record.passages
  const passages: SourcePassage[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const passage = entry as Record<string, unknown>
    if (typeof passage.label !== 'string' || typeof passage.source !== 'string' || typeof passage.text !== 'string') continue
    passages.push({
      label: passage.label,
      collection: typeof passage.collection === 'string' ? passage.collection : '',
      source: passage.source,
      ...typeof passage.heading === 'string' ? { heading: passage.heading } : {},
      ...typeof passage.page === 'number' ? { page: passage.page } : {},
      text: passage.text,
      score: typeof passage.score === 'number' ? passage.score : 0,
    })
  }
  return {
    query: record.query,
    passages,
    summary: typeof record.summary === 'string' ? record.summary : '',
    ...typeof record.error === 'string' ? { error: record.error } : {},
  }
}

interface SourcesTurnState {
  readonly turn: number
  readonly data: KnowledgeSourcesData
}

/**
 * The grounding of the Turn a tail belongs to.
 * @param turn - the Turn location.
 * @returns the grounding, or null when none ran.
 */
export function selectSources(turn: TurnLocation): KnowledgeSourcesData | null {
  return turn.data.get('knowledge-sources') ?? null
}

/** One grounding record, published against the Turn it was logged in; it publishes no view Node. */
export const sourcesTurnDefinition: ConversationNodeDefinition<SourcesTurnState | null> = {
  kind: 'knowledge-sources',
  match: event => event.type === 'user/message' && isAppendSurfaceEvent(event) && String(event.data.source.kind) === 'knowledge-context'
    ? { id: String(event.data.id), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'user/message') throw new Error('knowledge-sources start requires user/message')
    const location = match.location
    const turn = location.kind === 'step' || location.kind === 'turn' ? location.turn.turn : undefined
    const data = readSources(match.event.data.source)
    return turn === undefined || data === undefined ? null : { turn, data }
  },
  update: context => context.state,
  buildLocationData: (context, scope, previous) => {
    const state = context.state
    if (scope !== 'turn' || state === undefined || state === null) return null
    if (previous?.kind === 'turn' && previous.turn === state.turn && previous.key === 'knowledge-sources' && previous.value === state.data) return previous
    return { kind: 'turn', turn: state.turn, key: 'knowledge-sources', value: state.data }
  },
}
