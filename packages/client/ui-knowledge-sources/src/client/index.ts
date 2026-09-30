/**
 * Knowledge Sources, browser half: a Turn-tail card under every grounded
 * answer listing the notes the `knowledge-context` plugin gave the model, with
 * passage text, page previews over the `memory` Remote namespace, and file
 * opening; and the `mind_map` Tool card, an interactive concept map.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the slot registry merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the conversation engine merge (ctx.uiConversation).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the Chat SlotMap merge (the 'conversation.chat.turnTail' list).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: the keyed Tool view SlotMap merge ('tool.call.toolview').
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
// Type-only: the ctx.remote merge and the memory namespace.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { en } from './locales.ts'
import { MindMapCard, MindMapTail } from './MindMapCard.tsx'
import { mindMapTurnDefinition } from './mind-map-turn.ts'
import { SourcesCard } from './SourcesCard.tsx'
import type { SourcesCardInjected } from './SourcesCard.tsx'
import { sourcesTurnDefinition } from './sources-turn.ts'

export { fileLabel, SourcesCard } from './SourcesCard.tsx'
export { MindMapCard, MindMapTail, readMindMap } from './MindMapCard.tsx'
export type { MindMapArgs, MindMapCardProps, MindMapTailProps } from './MindMapCard.tsx'
export { MIND_MAP_TOOL, mindMapTurnDefinition, selectMindMaps } from './mind-map-turn.ts'
export type { MindMapTurnData, TurnMindMap } from './mind-map-turn.ts'
export type { SourcesCardInjected, SourcesCardProps } from './SourcesCard.tsx'
export { readSources, selectSources, sourcesTurnDefinition } from './sources-turn.ts'
export type { KnowledgeSourcesData, SourcePassage } from './sources-turn.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'knowledge-sources'

/** Required services. */
export const inject = ['slots', 'locale', 'uiConversation', 'remote', 'remote.memory']

/**
 * Register the grounding projection and the Sources card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, 'en', en), 'ui-knowledge-sources: dictionary')
  ctx.effect(() => ctx.uiConversation.events.register(sourcesTurnDefinition), 'ui-knowledge-sources: grounding projection')
  ctx.effect(() => ctx.uiConversation.events.register(mindMapTurnDefinition), 'ui-knowledge-sources: mind map projection')
  const face: SourcesCardInjected = {
    previewPage: async (source, page) => {
      const result = await ctx.remote.memory.previewPage({ source, page })
      if (!result.ok) throw new Error(result.error.message)
      return result.value.image
    },
  }
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: 'knowledge-sources',
    // Above the other turn cards: sources belong right under the answer.
    order: 5,
    locale: NS,
    inject: () => face,
  }, SourcesCard))
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: 'knowledge-mind-maps',
    // Maps sit right under the answer, above its Sources.
    order: 4,
    locale: NS,
  }, MindMapTail))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'mind_map', locale: NS }, MindMapCard))
}
