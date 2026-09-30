/**
 * Native orchestrator board, browser half: one `main` keyed panel over the
 * client Session model plus a `sidebar.panellist` entry that opens it. The board
 * groups every DSH session by project, derives each row's status from the
 * unified Session status facts, and routes one free-form input to the best
 * native session or agent preset through the `session` and `agentPresets`
 * Remote namespaces.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the slot registry merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the layout SlotMap merge (the 'main' keyed slot) and its ids.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the sidebar's SlotMap merge (the 'sidebar.panellist' list).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: the global session hooks and unified status snapshot.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: the cross-Controller Workspace navigation merge (ctx.uiWorkspace).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: the ctx.remote merge and the session/agent-preset wire vocabulary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the Session projection merge carrying the session's agent preset.
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { OrchestratorBoard } from './OrchestratorBoard.tsx'
import type { OrchestratorBoardInjected } from './OrchestratorBoard.tsx'
import { OrchestratorPanelIcon } from './OrchestratorPanelIcon.tsx'
import type { OrchestratorLocaleKey } from './locales.ts'
import { en, zh } from './locales.ts'

export type { BoardGroup, BoardRow, BoardStatus } from './board.ts'
export type { OrchestratorBoardInjected, OrchestratorBoardProps } from './OrchestratorBoard.tsx'
export type { RouteIntentOptions, RoutePreset, RouteSession, RouteTarget } from './router.ts'
export type { StatusPillProps, StatusPillState } from './StatusPill.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'orchestrator'

/** The id shared by the sidebar entry and the main panel it opens. */
const PANEL_ID = 'orchestrator' as MainPanelId

/** Required services: slots, locale, the Session model, and the navigation service. */
export const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.session', 'remote.agentPresets', 'uiWorkspace']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Native orchestrator board and auto-router copy. */
    orchestrator: OrchestratorLocaleKey
  }
}

/**
 * Mount the orchestrator board panel and its sidebar entry.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-orchestrator: dictionaries')

  const board: OrchestratorBoardInjected = {
    loadPresets: async () => {
      const result = await ctx.remote.agentPresets.list()
      // Agent presets are optional: an unmounted service is an empty roster,
      // not a board failure.
      if (!result.ok) return []
      return result.value.presets
        .filter(preset => preset.broken === undefined)
        .map(preset => ({
          id: preset.id,
          name: preset.name ?? undefined,
          description: preset.description ?? undefined,
        }))
    },
    createSessionForPreset: async (presetId) => {
      const sessionId = await ctx.sessions.create()
      // Selecting the preset before the first turn is the existing binding
      // path; the Host resolves the preset's bound model through the
      // agent-models service at composition. No new model store is introduced.
      const selected = await ctx.remote.agentPresets.select(sessionId, presetId)
      if (!selected.ok) {
        throw new Error(`agentPresets/select failed: ${selected.error.code}: ${selected.error.message}`)
      }
      return sessionId
    },
    promptSession: async (sessionId: SessionId, text: string): Promise<void> => {
      const result = await ctx.remote.session.prompt({
        requestId: brandString<SessionRequestId>(randomUUID()),
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      })
      if (!result.ok) {
        throw new Error(`session/prompt failed: ${result.error.code}: ${result.error.message}`)
      }
    },
    openSession: (sessionId) => { ctx.uiWorkspace.openSession(sessionId) },
  }

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: (): OrchestratorBoardInjected => board,
  }, OrchestratorBoard))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 25,
    locale: NS,
    label: () => t('nav'),
  }, OrchestratorPanelIcon))
}