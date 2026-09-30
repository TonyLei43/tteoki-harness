/** The workbench's business face and pure helpers. */

import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Registration-side face shared by the tab strip and status bar. */
export interface WorkbenchInjected {
  /** Session ids open as tabs, in tab order. */
  readonly openTabs: ObservableSnapshot<readonly SessionId[]>
  /** The current Session, or undefined. */
  readonly currentSession: ObservableSnapshot<SessionId | undefined>
  /** Open a Session in the conversation view. */
  readonly openSession: (id: SessionId) => void
  /** Remove a tab; the Session itself is untouched. */
  readonly closeTab: (id: SessionId) => void
  /** Show Home. */
  readonly openHome: () => void
  /** Start a new Session in the current or recent workspace. */
  readonly newSession: () => void
  /** @returns the status bar's facts: next deadline, knowledge document count, and last sync. */
  readonly statusFacts: () => Promise<StatusFacts>
}

/** Facts the status bar shows beside the running-session count. */
export interface StatusFacts {
  /** The next unfinished assignment, when any is due in the next two weeks. */
  readonly nextDue?: { readonly title: string; readonly start: string; readonly course?: string }
  /** Indexed documents across knowledge bases, when the memory service answers. */
  readonly documents?: number
  /** Last agenda sync, epoch milliseconds. */
  readonly syncedAt?: number
}

/** Tab status, derived from a Session's unified status facts. */
export type TabStatus = 'needs-feedback' | 'running' | 'done' | 'idle'

/**
 * Derive a tab's status.
 * @param facts - running, pending interaction, and unread completion.
 * @returns the status.
 */
export function tabStatus(facts: { readonly running: boolean; readonly pendingInteraction: boolean; readonly completionUnread: boolean }): TabStatus {
  if (facts.pendingInteraction) return 'needs-feedback'
  if (facts.running) return 'running'
  if (facts.completionUnread) return 'done'
  return 'idle'
}

/** Most Session tabs kept open; opening another drops the oldest. */
export const MAX_TABS = 10

/**
 * Add a Session to the open tabs, keeping existing tab order.
 * @param tabs - open tabs.
 * @param id - the Session just opened.
 * @returns the next tab list.
 */
export function withTab(tabs: readonly SessionId[], id: SessionId): readonly SessionId[] {
  if (tabs.includes(id)) return tabs
  const next = [...tabs, id]
  return next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next
}

/**
 * Relative description of an instant.
 * @param iso - ISO time or epoch milliseconds.
 * @param now - the current time.
 * @returns text such as "in 2 days".
 */
export function relative(iso: string | number, now: number): string {
  const delta = new Date(iso).getTime() - now
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (Math.abs(delta) < 3_600_000) return format.format(Math.round(delta / 60_000), 'minute')
  if (Math.abs(delta) < 86_400_000) return format.format(Math.round(delta / 3_600_000), 'hour')
  return format.format(Math.round(delta / 86_400_000), 'day')
}
