/** Pure orchestrator board folds: status derivation, grouping, ordering, labels. */

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  activityLabel, buildRows, deriveStatus, directoryBasename, orderedGroups,
} from '../src/client/board.ts'
import type { OrchestratorLocaleKey } from '../src/client/locales.ts'
import { en } from '../src/client/locales.ts'

/**
 * Brand one fixture session id at the test boundary.
 * @param value - the raw id text.
 * @returns the branded id.
 */
function sid(value: string): SessionId {
  return brandString<SessionId>(value)
}

/**
 * One list row with the listed overrides.
 * @param id - raw session id.
 * @param overrides - row overrides.
 * @returns the row.
 */
function summary(id: string, overrides: Partial<Omit<SessionSummary, 'id'>> = {}): SessionSummary {
  return {
    id: sid(id),
    displayTitle: id,
    running: false,
    retainedBy: {},
    blank: false,
    updatedAt: 1,
    ...overrides,
  }
}

/**
 * A ready list snapshot over the supplied rows.
 * @param rows - list rows.
 * @returns the snapshot.
 */
function listOf(rows: readonly SessionSummary[]): SessionListState {
  return {
    ids: rows.map(row => row.id),
    byId: Object.fromEntries(rows.map(row => [row.id, row])),
    phase: 'ready',
    projectionsBySession: {},
  }
}

/**
 * A status snapshot over the supplied facts.
 * @param facts - per-session facts.
 * @returns the snapshot.
 */
function statusesOf(facts: readonly (readonly [string, Partial<SessionStatus>])[]): SessionStatusSnapshot {
  return new Map(facts.map(([id, fact]) => [sid(id), {
    running: undefined,
    pendingInteraction: undefined,
    completionUnread: false,
    ...fact,
  }]))
}

/**
 * A pending-interaction fact standing for any domain's answerable request.
 * @param sessionId - the awaiting session.
 * @returns the interaction value the status snapshot carries.
 */
function pending(sessionId: SessionId): SessionPendingInteraction {
  return { key: 'k', kind: 'approval', sessionId } as SessionPendingInteraction
}

describe('deriveStatus', () => {
  it('orders pending interaction, then error, running, done, idle', () => {
    const idle = { running: false, pendingInteraction: false, completionUnread: false, error: false }
    expect(deriveStatus({ ...idle, pendingInteraction: true })).toBe('needs-feedback')
    expect(deriveStatus({ ...idle, running: true, pendingInteraction: true })).toBe('needs-feedback')
    expect(deriveStatus({ ...idle, error: true })).toBe('error')
    expect(deriveStatus({ ...idle, error: true, running: true })).toBe('error')
    expect(deriveStatus({ ...idle, running: true })).toBe('running')
    expect(deriveStatus({ ...idle, running: true, completionUnread: true })).toBe('running')
    expect(deriveStatus({ ...idle, completionUnread: true })).toBe('done')
    expect(deriveStatus(idle)).toBe('idle')
  })
})

describe('buildRows', () => {
  it('maps list facts and derives each row status from the status snapshot', () => {
    const rows = buildRows(
      listOf([
        summary('ses_a', {
          displayTitle: 'Fix login', cwd: '/w/alpha', updatedAt: 5, projectionValues: { agentPreset: 'build' },
        }),
        summary('ses_b'),
      ]),
      statusesOf([
        ['ses_a', { running: true }],
        ['ses_b', { pendingInteraction: pending(sid('ses_b')) }],
      ]),
    )
    expect(rows[0]).toMatchObject({
      id: sid('ses_a'), title: 'Fix login', cwd: '/w/alpha', preset: 'build', status: 'running',
    })
    expect(rows[1]).toMatchObject({ id: sid('ses_b'), cwd: '', preset: undefined, status: 'needs-feedback' })
  })

  it('falls back to the row running bit and drops subagent children', () => {
    const rows = buildRows(listOf([
      summary('ses_parent', { running: true }),
      summary('ses_child', { origin: 'subagent', parentId: sid('ses_parent') }),
    ]), statusesOf([]))
    expect(rows.map(row => row.id)).toEqual([sid('ses_parent')])
    expect(rows[0]?.status).toBe('running')
  })
})

describe('orderedGroups', () => {
  it('groups by directory with the directory-less group last, attention states first', () => {
    const rows = buildRows(listOf([
      summary('ses_idle', { cwd: '/w/b', updatedAt: 5 }),
      summary('ses_done', { cwd: '/w/b', updatedAt: 9 }),
      summary('ses_run', { cwd: '/w/a', updatedAt: 2 }),
      summary('ses_feedback', { cwd: '/w/b', updatedAt: 1 }),
      summary('ses_bare'),
    ]), statusesOf([
      ['ses_run', { running: true }],
      ['ses_feedback', { pendingInteraction: pending(sid('ses_feedback')) }],
      ['ses_done', { completionUnread: true }],
    ]))
    const groups = orderedGroups(rows)
    expect(groups.map(group => group.cwd)).toEqual(['/w/a', '/w/b', ''])
    expect(groups[0]?.name).toBe('a')
    expect(groups[0]?.rows.map(row => row.id)).toEqual([sid('ses_run')])
    expect(groups[1]?.name).toBe('b')
    expect(groups[1]?.rows.map(row => row.id)).toEqual([sid('ses_feedback'), sid('ses_done'), sid('ses_idle')])
    expect(groups[2]?.name).toBe('')
  })

  it('breaks recency ties by id', () => {
    const groups = orderedGroups(buildRows(
      listOf([summary('ses_b', { updatedAt: 3 }), summary('ses_a', { updatedAt: 5 })]),
      statusesOf([]),
    ))
    expect(groups[0]?.rows.map(row => row.id)).toEqual([sid('ses_a'), sid('ses_b')])
  })
})

describe('directoryBasename', () => {
  it('reads both separators and trailing slashes', () => {
    expect(directoryBasename('/home/t/project')).toBe('project')
    expect(directoryBasename('C:\\repo\\pkg')).toBe('pkg')
    expect(directoryBasename('/home/repo/')).toBe('repo')
  })
})

describe('activityLabel', () => {
  const t = (key: OrchestratorLocaleKey, params?: Record<string, unknown>): string => {
    let text = en[key]
    if (params !== undefined) {
      for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
    }
    return text
  }

  it('localizes every relative bucket', () => {
    expect(activityLabel(t, { unit: 'now', n: 0 })).toBe('now')
    expect(activityLabel(t, { unit: 'minutes', n: 5 })).toBe('5m')
    expect(activityLabel(t, { unit: 'hours', n: 3 })).toBe('3h')
    expect(activityLabel(t, { unit: 'days', n: 2 })).toBe('2d')
    expect(activityLabel(t, { unit: 'months', n: 4 })).toBe('4mo')
    expect(activityLabel(t, { unit: 'years', n: 1 })).toBe('1y')
  })
})