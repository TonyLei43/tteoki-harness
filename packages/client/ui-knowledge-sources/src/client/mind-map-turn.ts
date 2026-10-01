/**
 * Turn-scoped projection of `mind_map` calls. The Chat folds tool calls into
 * the Turn's work details, so the maps a Turn drew are published against the
 * Turn and rendered in its tail, under the answer; the map is read from the
 * call's logged arguments, so replay reproduces it.
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { ConversationNodeDefinition, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Wire name of the tool. */
export const MIND_MAP_TOOL = 'mind_map'

/** One map a Turn drew. */
export interface TurnMindMap {
  readonly callId: string
  /** The call's raw argument JSON. */
  readonly argsRaw: string
}

/** Maps drawn in one Turn, in settlement order. */
export interface MindMapTurnData {
  readonly maps: readonly TurnMindMap[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Successful `mind_map` calls of this Turn. */
    'mind-maps': MindMapTurnData
  }
}

interface MindMapTurnState {
  readonly turn: number
  /** Pending `mind_map` calls by call id. */
  readonly calls: ReadonlyMap<string, string>
  readonly maps: readonly TurnMindMap[]
}

/**
 * The maps of the Turn a tail belongs to.
 * @param turn - the Turn location.
 * @returns the maps, empty when the Turn drew none.
 */
export function selectMindMaps(turn: TurnLocation): readonly TurnMindMap[] {
  return turn.data.get('mind-maps')?.maps ?? []
}

/** Turn-local accumulator of successful `mind_map` calls; it publishes no view Node. */
export const mindMapTurnDefinition: ConversationNodeDefinition<MindMapTurnState> = {
  kind: 'mind-maps',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return event.data.name === MIND_MAP_TOOL ? { id: String(event.data.turn), role: 'update' } : null
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('mind-maps start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), maps: [] }
  },
  update: (context, match) => {
    const event = match.event
    if (event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(String(event.data.callId), event.data.arguments)
      return { ...context.state, calls }
    }
    if (event.type !== 'tool/result') return context.state
    const callId = String(event.data.message.source.callId)
    const argsRaw = context.state.calls.get(callId)
    // Failed maps stay in the work details, where the call shows its error.
    if (argsRaw === undefined || event.data.message.isError === true) return context.state
    return { ...context.state, maps: [...context.state.maps, { callId, argsRaw }] }
  },
  buildLocationData: (context, scope, previous) => {
    const state = context.state
    if (scope !== 'turn' || state === undefined || state.maps.length === 0) return null
    if (previous?.kind === 'turn' && previous.turn === state.turn && previous.key === 'mind-maps' && previous.value.maps === state.maps) return previous
    return { kind: 'turn', turn: state.turn, key: 'mind-maps', value: { maps: state.maps } }
  },
}
