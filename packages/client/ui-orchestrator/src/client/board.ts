/**
 * Pure board folds for the native orchestrator: the client Session list and the
 * unified UI status snapshots become display rows, rows group by project
 * directory, and attention states lead. No React and no subscriptions, so the
 * panel and its tests read the same functions.
 */

import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { RelativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Row order inside one group and the status pill vocabulary: attention first, settled last. */
export const STATUS_PRECEDENCE = {
  'needs-feedback': 0,
  error: 1,
  retrying: 2,
  running: 3,
  done: 4,
  idle: 5,
} as const

/** The status vocabulary a board row's pill renders. */
export type BoardStatus = keyof typeof STATUS_PRECEDENCE

/** One display row: the session facts the board shows and the status it derives. */
export interface BoardRow {
  /** Session identity the row opens. */
  readonly id: SessionId
  /** Display title, falling back to the id inside the session model. */
  readonly title: string
  /** Project directory, empty when the session has none. */
  readonly cwd: string
  /** Agent preset the session runs, or undefined when none is recorded. */
  readonly preset: string | undefined
  /** Durable last-activity timestamp in epoch ms. */
  readonly updatedAt: number
  /** Derived status selecting the row's pill palette. */
  readonly status: BoardStatus
}

/** One project group: the sessions sharing one working directory. */
export interface BoardGroup {
  /** Absolute directory the sessions run in; empty for sessions without one. */
  readonly cwd: string
  /** Group heading: the directory basename, or empty for the directory-less group. */
  readonly name: string
  /** Precedence-ordered rows of this group. */
  readonly rows: readonly BoardRow[]
}

/** Independent per-session facts the row status derives from. */
export interface RowStatusFacts {
  /** Host/client running state. */
  readonly running: boolean
  /** A pending interaction, including approvals, awaits the user. */
  readonly pendingInteraction: boolean
  /** A completed run still needs acknowledgement. */
  readonly completionUnread: boolean
  /**
   * A surfaced agent failure reserved for a per-session error read; the list
   * and status snapshots do not carry one, so the board passes `false` in v1.
   */
  readonly error: boolean
}

/**
 * Map independent facts onto one pill state. Pending interaction outranks a
 * failure because it is answerable; then error, running, unread completion, and
 * idle. The board never derives `retrying`; the pill vocabulary keeps it for
 * callers with retry facts.
 * @param facts - running, pending-interaction, completion, and error facts.
 * @returns the row's pill state.
 */
export function deriveStatus(facts: RowStatusFacts): BoardStatus {
  if (facts.pendingInteraction) return 'needs-feedback'
  if (facts.error) return 'error'
  if (facts.running) return 'running'
  if (facts.completionUnread) return 'done'
  return 'idle'
}

/**
 * Project the session list and unified status snapshots into display rows,
 * dropping subagent children (their parent owns them). A missing status entry
 * falls back to the list row's own running bit.
 * @param sessions - the client Session list snapshot.
 * @param statuses - the unified Session UI status snapshot.
 * @returns the rows in session-list order.
 */
export function buildRows(
  sessions: SessionListState,
  statuses: SessionStatusSnapshot,
): readonly BoardRow[] {
  const rows: BoardRow[] = []
  for (const id of sessions.ids) {
    const summary = sessions.byId[id]
    if (summary === undefined || summary.origin === 'subagent') continue
    rows.push(toRow(summary, statuses))
  }
  return rows
}

/**
 * One session summary plus its status facts as a display row.
 * @param summary - the list row.
 * @param statuses - the unified status snapshot.
 * @returns the display row.
 */
function toRow(summary: SessionSummary, statuses: SessionStatusSnapshot): BoardRow {
  const status = statuses.get(summary.id)
  const preset = summary.projectionValues?.agentPreset
  return {
    id: summary.id,
    title: summary.displayTitle,
    cwd: summary.cwd ?? '',
    preset: typeof preset === 'string' && preset !== '' ? preset : undefined,
    updatedAt: summary.updatedAt,
    status: deriveStatus({
      running: status?.running ?? summary.running,
      pendingInteraction: status?.pendingInteraction !== undefined,
      completionUnread: status?.completionUnread ?? false,
      error: false,
    }),
  }
}

/**
 * Group rows by project directory and order them: groups alphabetically with
 * the directory-less group last, rows by status precedence then most recent
 * activity then id.
 * @param rows - display rows.
 * @returns one group per distinct directory, in display order.
 */
export function orderedGroups(rows: readonly BoardRow[]): readonly BoardGroup[] {
  const byDirectory = new Map<string, BoardRow[]>()
  for (const row of rows) {
    const bucket = byDirectory.get(row.cwd)
    if (bucket === undefined) byDirectory.set(row.cwd, [row])
    else bucket.push(row)
  }
  return [...byDirectory.entries()]
    .sort(([left], [right]) => left === right ? 0 : left === '' ? 1 : right === '' ? -1 : left.localeCompare(right))
    .map(([cwd, groupRows]) => ({
      cwd,
      name: cwd === '' ? '' : directoryBasename(cwd),
      rows: groupRows.sort((left, right) => {
        const byStatus = STATUS_PRECEDENCE[left.status] - STATUS_PRECEDENCE[right.status]
        if (byStatus !== 0) return byStatus
        const byTime = right.updatedAt - left.updatedAt
        if (byTime !== 0) return byTime
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
      }),
    }))
}

/**
 * Final path segment of a directory, handling both separators.
 * @param directory - directory path.
 * @returns the last segment.
 */
export function directoryBasename(directory: string): string {
  const trimmed = directory.replace(/[\\/]+$/u, '')
  const start = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1
  return trimmed.slice(start)
}

/**
 * Localize the structured relative time into the board's own activity words.
 * The bucket arithmetic lives in ui-primitives so two surfaces naming the same
 * session agree; the words stay here, per locale-owned copy.
 * @param t - the orchestrator namespace translate seat.
 * @param relative - the relative-time bucket.
 * @returns the activity label.
 */
export function activityLabel(
  t: (key: 'activity.now' | 'activity.minutes' | 'activity.hours' | 'activity.days' | 'activity.months' | 'activity.years', params?: Record<string, unknown>) => string,
  relative: RelativeTime,
): string {
  switch (relative.unit) {
    case 'now': return t('activity.now')
    case 'minutes': return t('activity.minutes', { n: relative.n })
    case 'hours': return t('activity.hours', { n: relative.n })
    case 'days': return t('activity.days', { n: relative.n })
    case 'months': return t('activity.months', { n: relative.n })
    case 'years': return t('activity.years', { n: relative.n })
  }
}