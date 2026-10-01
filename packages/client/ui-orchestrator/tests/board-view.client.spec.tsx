// @vitest-environment jsdom
/** The orchestrator board: grouping, pills, and the auto-router dispatch. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { OrchestratorBoardInjected, OrchestratorBoardProps } from '../src/client/OrchestratorBoard.tsx'
import { OrchestratorBoard } from '../src/client/OrchestratorBoard.tsx'
import type { OrchestratorLocaleKey } from '../src/client/locales.ts'
import { en } from '../src/client/locales.ts'
import type { RoutePreset } from '../src/client/router.ts'

afterEach(cleanup)

/** Dictionary-backed `t` with the runtime's `{name}` templating. */
const t = (key: OrchestratorLocaleKey, params?: Record<string, unknown>): string => {
  let text = en[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

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

/** A status snapshot with the supplied per-session facts. */
function statusesOf(facts: readonly (readonly [string, Partial<SessionStatus>])[] = []): SessionStatusSnapshot {
  return new Map(facts.map(([id, fact]) => [sid(id), {
    running: undefined,
    pendingInteraction: undefined,
    completionUnread: false,
    ...fact,
  }]))
}

/** Bind a plain snapshot to the generic selector-hook shape the frame supplies. */
function hook<S>(state: S) {
  return <T,>(selector: (value: S) => T): T => selector(state)
}

/** The board face doubles and the render entry. */
function renderBoard(
  sessions: SessionListState,
  statuses: SessionStatusSnapshot,
  overrides: Partial<OrchestratorBoardInjected> = {},
) {
  const face: OrchestratorBoardInjected = {
    loadPresets: vi.fn(async (): Promise<readonly RoutePreset[]> => []),
    createSessionForPreset: vi.fn(async () => sid('ses_new')),
    promptSession: vi.fn(async () => {}),
    openSession: vi.fn(),
    ...overrides,
  }
  render(<OrchestratorBoard {...({
    t,
    useSessions: hook(sessions),
    useSessionStatus: hook(statuses),
    ...face,
  } as OrchestratorBoardProps)} />)
  return face
}

const ROWS = [
  summary('ses_a', { displayTitle: 'Fix login', cwd: '/w/alpha', updatedAt: 5, projectionValues: { agentPreset: 'build' } }),
  summary('ses_b', { displayTitle: 'Write docs', cwd: '', updatedAt: 3 }),
]
const STATUSES = statusesOf([['ses_a', { running: true }]])

describe('OrchestratorBoard', () => {
  it('groups rows by project with the directory-less group last and shows each pill', async () => {
    renderBoard(listOf(ROWS), STATUSES)
    expect(await screen.findByRole('heading', { name: en.title })).toBeTruthy()
    const headings = screen.getAllByRole('heading', { level: 3 })
    expect(headings[0]?.textContent).toBe('alpha — /w/alpha')
    expect(headings[1]?.textContent).toBe(en['group.untitled'])
    const runningRow = screen.getByRole('button', { name: 'Open session Fix login' })
    expect(within(runningRow).getByText(en['state.running'])).toBeTruthy()
    expect(within(runningRow).getByText(/Agent: build/u)).toBeTruthy()
  })

  it('shows the empty notice without sessions and the loading notice while pending', async () => {
    renderBoard(listOf([]), statusesOf())
    expect(await screen.findByText(en.empty)).toBeTruthy()
    cleanup()
    renderBoard({ ...listOf([]), phase: 'pending' }, statusesOf())
    expect(screen.getByText(en.loading)).toBeTruthy()
  })

  it('opens a row through openSession', async () => {
    const face = renderBoard(listOf(ROWS), STATUSES)
    fireEvent.click(await screen.findByRole('button', { name: 'Open session Fix login' }))
    expect(face.openSession).toHaveBeenCalledWith(sid('ses_a'))
  })

  it('routes to the best-matching session, prompts it, and reports the decision', async () => {
    const face = renderBoard(listOf(ROWS), STATUSES)
    fireEvent.change(await screen.findByRole('textbox', { name: en['ask.placeholder'] }), { target: { value: 'fix login' } })
    fireEvent.click(screen.getByRole('button', { name: en['ask.send'] }))
    await waitFor(() => { expect(face.promptSession).toHaveBeenCalledWith(sid('ses_a'), 'fix login') })
    expect(face.openSession).toHaveBeenCalledWith(sid('ses_a'))
    expect(screen.getByRole('status').textContent).toBe(t('ask.routed', { target: 'Fix login' }))
  })

  it('creates a preset session when no session matches and prompts it', async () => {
    const face = renderBoard(listOf(ROWS), STATUSES, {
      loadPresets: vi.fn(async () => [{
        id: 'research', name: 'Research', description: 'Investigate a codebase',
      }]),
    })
    fireEvent.change(await screen.findByRole('textbox', { name: en['ask.placeholder'] }), { target: { value: 'investigate codebase' } })
    fireEvent.click(screen.getByRole('button', { name: en['ask.send'] }))
    await waitFor(() => { expect(face.createSessionForPreset).toHaveBeenCalledWith('research') })
    expect(face.promptSession).toHaveBeenCalledWith(sid('ses_new'), 'investigate codebase')
    expect(face.openSession).toHaveBeenCalledWith(sid('ses_new'))
    expect(screen.getByRole('status').textContent).toBe(t('ask.routed', { target: 'Research' }))
  })

  it('reports no targets when the input matches nothing or nothing exists', async () => {
    const face = renderBoard(listOf(ROWS), STATUSES)
    fireEvent.change(await screen.findByRole('textbox', { name: en['ask.placeholder'] }), { target: { value: 'zzz unrelated' } })
    fireEvent.click(screen.getByRole('button', { name: en['ask.send'] }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en['ask.noTargets']) })
    expect(face.promptSession).not.toHaveBeenCalled()

    cleanup()
    const empty = renderBoard(listOf([]), statusesOf())
    fireEvent.change(await screen.findByRole('textbox', { name: en['ask.placeholder'] }), { target: { value: 'anything' } })
    fireEvent.click(screen.getByRole('button', { name: en['ask.send'] }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en['ask.noTargets']) })
    expect(empty.promptSession).not.toHaveBeenCalled()
  })

  it('reports a failed send without navigating', async () => {
    const face = renderBoard(listOf(ROWS), STATUSES, {
      promptSession: vi.fn(async () => { throw new Error('down') }),
    })
    fireEvent.change(await screen.findByRole('textbox', { name: en['ask.placeholder'] }), { target: { value: 'fix login' } })
    fireEvent.click(screen.getByRole('button', { name: en['ask.send'] }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en['ask.error']) })
    expect(face.openSession).not.toHaveBeenCalled()
  })

  it('uses an injected classifier in place of the token router', async () => {
    const classify = vi.fn(async () => ({
      kind: 'session' as const,
      session: { id: sid('ses_b'), title: 'Write docs', cwd: undefined, agentPreset: undefined, updatedAt: 3 },
      score: 99,
    }))
    const face = renderBoard(listOf(ROWS), STATUSES, { classify })
    fireEvent.change(await screen.findByRole('textbox', { name: en['ask.placeholder'] }), { target: { value: 'anything at all' } })
    fireEvent.click(screen.getByRole('button', { name: en['ask.send'] }))
    await waitFor(() => { expect(face.promptSession).toHaveBeenCalledWith(sid('ses_b'), 'anything at all') })
    expect(classify).toHaveBeenCalled()
  })
})