/**
 * Workbench chrome, browser half: an Orca-style tab strip across the top of
 * the centre column (Home, then open Sessions with status dots) and a status
 * bar along its bottom (running Sessions, the next deadline, the knowledge
 * index, and the last agenda sync).
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the slot registry merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the layout SlotMap merge (the 'shell.tabs' and 'shell.status' lists) and ctx.layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the current Session selection (ctx.uiSession).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: the cross-Controller Workspace navigation merge (ctx.uiWorkspace).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: the ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { en } from './locales.ts'
import { withTab } from './model.ts'
import type { StatusFacts, WorkbenchInjected } from './model.ts'
import { SessionTabs } from './SessionTabs.tsx'
import { StatusBar } from './StatusBar.tsx'

export { MAX_TABS, relative, tabStatus, withTab } from './model.ts'
export type { StatusFacts, TabStatus, WorkbenchInjected } from './model.ts'
export type { SessionTabsProps } from './SessionTabs.tsx'
export type { StatusBarProps } from './StatusBar.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'workbench'

/** Home's main-panel id, registered by the dashboard. */
const HOME = 'home' as MainPanelId

/** Required services. */
export const inject = ['slots', 'locale', 'layout', 'uiSession', 'uiWorkspace', 'remote', 'remote.connectors', 'remote.memory']

/**
 * Mount the tab strip and status bar.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, 'en', en), 'ui-workbench: dictionary')
  const openTabs = createSnapshotStore<readonly SessionId[]>([], { persist: { name: 'dsh-workbench-tabs' } })
  const currentSession = createSnapshotStore<SessionId | undefined>(undefined)
  const source = ctx.uiSession.adapter.current
  const follow = (): void => {
    const key = source.getSnapshot().key as SessionId | undefined
    currentSession.set(key)
    if (key !== undefined) openTabs.set(withTab(openTabs.getSnapshot(), key))
  }
  ctx.effect(() => source.subscribe(follow), 'ui-workbench: current session')
  follow()

  const statusFacts = async (): Promise<StatusFacts> => {
    const now = Date.now()
    const [agenda, status, memory] = await Promise.all([
      ctx.remote.connectors.agenda({ from: new Date(now).toISOString(), to: new Date(now + 14 * 86_400_000).toISOString(), kinds: ['assignment'] }),
      ctx.remote.connectors.status(),
      ctx.remote.memory.status(),
    ])
    const next = agenda.ok ? agenda.value.items.find(item => item.status !== 'submitted' && item.status !== 'graded' && item.status !== 'excused') : undefined
    return {
      ...next === undefined ? {} : { nextDue: { title: next.title, start: next.start, ...next.course === undefined ? {} : { course: next.course } } },
      ...memory.ok ? { documents: memory.value.documents } : {},
      ...status.ok && status.value.syncedAt !== undefined ? { syncedAt: status.value.syncedAt } : {},
    }
  }

  const face: WorkbenchInjected = {
    openTabs,
    currentSession,
    openSession: (id) => { ctx.uiWorkspace.openSession(id) },
    closeTab: (id) => { openTabs.set(openTabs.getSnapshot().filter(tab => tab !== id)) },
    openHome: () => {
      try {
        ctx.layout.selectPanel(HOME)
      } catch {
        // Without the dashboard there is no Home panel; the conversation stays.
        ctx.layout.selectPanel(null)
      }
    },
    newSession: () => { ctx.uiWorkspace.startSession() },
    statusFacts,
  }
  ctx.slots.inject('shell.tabs', () => ctx.slots.register({ name: 'shell.tabs', id: 'workbench.tabs', locale: NS, inject: () => face }, SessionTabs))
  ctx.slots.inject('shell.status', () => ctx.slots.register({ name: 'shell.status', id: 'workbench.status', locale: NS, inject: () => face }, StatusBar))
}
