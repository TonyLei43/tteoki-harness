// @vitest-environment jsdom
/** What the browser half registers, and its native Remote/navigation behavior. */

import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
  }
})

type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The agent-preset roster shape the list Remote answers with. */
interface PresetRoster {
  readonly presets: readonly {
    readonly id: string
    readonly name?: string
    readonly description?: string
    readonly broken?: string
  }[]
}

/**
 * Brand one fixture session id at the test boundary.
 * @param value - the raw id text.
 * @returns the branded id.
 */
function sid(value: string): SessionId {
  return brandString<SessionId>(value)
}

/** Assemble a runtime with the locale, a recording navigation stub, and scripted Remote faces. */
async function bench() {
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  runtime.ctx.provide('locale', locale)
  runtime.ctx.slots.installLocale(locale)

  const openSession = vi.fn<(sessionId: SessionId) => void>()
  runtime.ctx.provide('uiWorkspace', { openSession } as never)

  const prompt = vi.fn(async (_request: unknown): Promise<RemoteResult<{ accepted: true }>> =>
    ({ ok: true, value: { accepted: true } }))
  const list = vi.fn(async (): Promise<RemoteResult<PresetRoster>> => ({ ok: true, value: { presets: [] } }))
  const select = vi.fn(async (_sessionId: SessionId, _presetId: string): Promise<RemoteResult<string>> =>
    ({ ok: true, value: 'research' }))
  runtime.remote.provideNamespaces({ session: { prompt }, agentPresets: { list, select } })

  await runtime.declare({
    'main': { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
  })
  const handle = await runtime.mount({ inject: [...inject], apply })

  /** Render the board panel and return its view. */
  const board = () => runtime.renderSlot('main', {}, { entryKey: 'orchestrator' })

  /** Type into the auto-router input and submit. */
  const route = async (view: ReturnType<typeof board>, text: string): Promise<void> => {
    fireEvent.change(view.view.getByRole('textbox', { name: en['ask.placeholder'] }), { target: { value: text } })
    fireEvent.click(view.view.getByRole('button', { name: en['ask.send'] }))
  }

  return { runtime, openSession, prompt, list, select, handle, board, route }
}

describe('ui-orchestrator browser plugin', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'remote', 'remote.session', 'remote.agentPresets', 'uiWorkspace'])
  })

  it('registers the panel and sidebar entry; disposal removes both', async () => {
    const subject = await bench()
    expect(subject.runtime.slots.entries('main')[0]).toMatchObject({ options: { key: 'orchestrator' }, locale: 'orchestrator' })
    const entry = subject.runtime.slots.entries('sidebar.panellist')[0]
    expect(entry).toMatchObject({ options: { id: 'orchestrator', order: 25 }, locale: 'orchestrator' })
    expect(resolveSlotLabel(entry?.options.label)).toBe(en.nav)

    await subject.handle.dispose()
    expect(subject.runtime.slots.entries('main')).toEqual([])
    expect(subject.runtime.slots.entries('sidebar.panellist')).toEqual([])
  })

  it('renders the board and routes free-form input to a session', async () => {
    const subject = await bench()
    await subject.runtime.sessions.add({
      id: 'ses_a',
      summary: { displayTitle: 'Fix login', cwd: '/w/alpha', running: true, updatedAt: 5 },
    })
    const main = subject.board()
    expect(await main.view.findByRole('button', { name: 'Open session Fix login' })).toBeTruthy()

    await subject.route(main, 'fix login')
    await waitFor(() => {
      expect(subject.prompt).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: sid('ses_a'), mode: 'queue', content: [{ type: 'text', text: 'fix login' }],
      }))
    })
    expect(subject.openSession).toHaveBeenCalledWith(sid('ses_a'))
    expect(main.view.getByRole('status').textContent).toBe(en['ask.routed'].replace('{target}', 'Fix login'))
  })

  it('creates and prompts a preset session when no session matches', async () => {
    const subject = await bench()
    subject.list.mockResolvedValue({
      ok: true,
      value: { presets: [
        { id: 'research', name: 'Research', description: 'Investigate a codebase' },
        { id: 'broken', broken: 'no plugin' },
      ] },
    })
    let n = 0
    subject.runtime.sessions.stubCreate(async () => {
      n += 1
      return subject.runtime.sessions.add({ id: `ses_${n}`, summary: { displayTitle: 'New research' } })
    })
    const main = subject.board()
    await waitFor(() => { expect(subject.list).toHaveBeenCalled() })
    await subject.route(main, 'investigate codebase')
    await waitFor(() => { expect(subject.select).toHaveBeenCalledWith(sid('ses_1'), 'research') })
    expect(subject.prompt).toHaveBeenCalledWith(expect.objectContaining({ sessionId: sid('ses_1') }))
    expect(subject.openSession).toHaveBeenCalledWith(sid('ses_1'))
    expect(main.view.getByRole('status').textContent).toBe(en['ask.routed'].replace('{target}', 'Research'))
  })

  it('reports a send failure without navigating', async () => {
    const subject = await bench()
    subject.prompt.mockResolvedValueOnce({ ok: false, error: { code: 'session/not-found', message: 'gone' } })
    await subject.runtime.sessions.add({
      id: 'ses_a', summary: { displayTitle: 'Fix login', cwd: '/w/alpha' },
    })
    const main = subject.board()
    await subject.route(main, 'fix login')
    await waitFor(() => { expect(main.view.getByRole('alert').textContent).toBe(en['ask.error']) })
    expect(subject.openSession).not.toHaveBeenCalled()
  })

  it('reports a preset-selection refusal as a route failure', async () => {
    const subject = await bench()
    subject.list.mockResolvedValue({ ok: true, value: { presets: [{ id: 'research', name: 'Research' }] } })
    subject.select.mockResolvedValueOnce({ ok: false, error: { code: 'agent-preset/locked', message: 'started' } })
    subject.runtime.sessions.stubCreate(async () => subject.runtime.sessions.add({
      id: 'ses_new', summary: { displayTitle: 'New research' },
    }))
    const main = subject.board()
    await waitFor(() => { expect(subject.list).toHaveBeenCalled() })
    await subject.route(main, 'research')
    await waitFor(() => { expect(main.view.getByRole('alert').textContent).toBe(en['ask.error']) })
    expect(subject.openSession).not.toHaveBeenCalled()
  })

  it('reports no targets when nothing matches and treats a failed preset read as empty', async () => {
    const subject = await bench()
    subject.list.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'no' } })
    await subject.runtime.sessions.add({
      id: 'ses_a', summary: { displayTitle: 'Fix login', cwd: '/w/alpha' },
    })
    const main = subject.board()
    await subject.route(main, 'zzz unrelated')
    await waitFor(() => { expect(main.view.getByRole('alert').textContent).toBe(en['ask.noTargets']) })
    expect(subject.prompt).not.toHaveBeenCalled()
  })
})