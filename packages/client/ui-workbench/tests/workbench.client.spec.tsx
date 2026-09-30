// @vitest-environment jsdom
/** Workbench chrome: tab bookkeeping, the tab strip, the status bar, and plugin wiring. */

import { Context, Service } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject, MAX_TABS, relative, tabStatus, withTab } from '../src/client/index.ts'
import type { SessionTabsProps, StatusBarProps, WorkbenchInjected } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'
import { SessionTabs } from '../src/client/SessionTabs.tsx'
import { StatusBar } from '../src/client/StatusBar.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]
const id = (value: string) => value as SessionId

describe('helpers', () => {
  it('keeps tab order, adds new sessions at the end, and caps the strip', () => {
    expect(withTab([id('a')], id('a'))).toEqual(['a'])
    expect(withTab([id('a')], id('b'))).toEqual(['a', 'b'])
    const full = Array.from({ length: MAX_TABS }, (_, index) => id(`s${index}`))
    expect(withTab(full, id('new'))).toEqual([...full.slice(1), 'new'])
    expect(tabStatus({ running: true, pendingInteraction: true, completionUnread: false })).toBe('needs-feedback')
    expect(tabStatus({ running: true, pendingInteraction: false, completionUnread: true })).toBe('running')
    expect(tabStatus({ running: false, pendingInteraction: false, completionUnread: true })).toBe('done')
    expect(tabStatus({ running: false, pendingInteraction: false, completionUnread: false })).toBe('idle')
    expect(relative(Date.now() + 2 * 86_400_000, Date.now())).toMatch(/2 days/)
  })
})

function face(overrides: Partial<WorkbenchInjected> = {}): WorkbenchInjected {
  return {
    openTabs: createSnapshotStore<readonly SessionId[]>([id('a'), id('b'), id('gone')]),
    currentSession: createSnapshotStore<SessionId | undefined>(id('b')),
    openSession: vi.fn(),
    closeTab: vi.fn(),
    openHome: vi.fn(),
    newSession: vi.fn(),
    statusFacts: vi.fn(async () => ({ nextDue: { title: 'HW1', start: new Date(Date.now() + 2 * 86_400_000).toISOString(), course: 'STAT 534: Statistical Computing' }, documents: 178, syncedAt: Date.now() - 300_000 })),
    ...overrides,
  }
}

const sessions = {
  ids: [id('a'), id('b'), id('c')],
  byId: {
    a: { id: 'a', displayTitle: 'STAT 534 HW4', running: true },
    b: { id: 'b', displayTitle: '', running: false },
    c: { id: 'c', displayTitle: 'Child', running: true, origin: 'subagent' },
  },
}
const statuses = new Map([[id('a'), { running: true, completionUnread: false }], [id('b'), { running: false, pendingInteraction: { kind: 'approval' }, completionUnread: false }]])

function hooks(panel: string | null) {
  return {
    useSessions: (select: (state: typeof sessions) => unknown) => select(sessions),
    useSessionStatus: (select: (map: typeof statuses) => unknown) => select(statuses),
    usePanelInfo: (select: (info: { activePanelId: string | null }) => unknown) => select({ activePanelId: panel }),
  }
}

describe('SessionTabs', () => {
  it('shows Home first, then open sessions with status, and routes clicks', () => {
    const workbench = face()
    render(<SessionTabs {...({ t, ...hooks(null), ...workbench } as unknown as SessionTabsProps)} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual(['Home', 'STAT 534 HW4', en.untitled])
    expect(tabs.map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true'])
    expect(screen.getByRole('img', { name: en['status.running'] })).toBeTruthy()
    expect(screen.getByRole('img', { name: en['status.needs-feedback'] })).toBeTruthy()
    fireEvent.click(tabs[1]!)
    expect(workbench.openSession).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByRole('button', { name: `${en.closeTab}: STAT 534 HW4` }))
    expect(workbench.closeTab).toHaveBeenCalledWith('a')
    fireEvent.click(tabs[0]!)
    expect(workbench.openHome).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: en.newSession }))
    expect(workbench.newSession).toHaveBeenCalledOnce()
  })

  it('marks Home active while Home is shown', () => {
    render(<SessionTabs {...({ t, ...hooks('home'), ...face() } as unknown as SessionTabsProps)} />)
    expect(screen.getAllByRole('tab').map(tab => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
  })
})

describe('StatusBar', () => {
  it('shows running sessions, the next deadline, knowledge, and sync', async () => {
    render(<StatusBar {...({ t, ...hooks(null), ...face() } as unknown as StatusBarProps)} />)
    const bar = within(screen.getByRole('status', { name: en.statusBar }))
    expect(bar.getByText('1 running')).toBeTruthy()
    expect(await bar.findByText(/^Next due: HW1 \(STAT 534\) · in 2 days$/)).toBeTruthy()
    expect(bar.getByText('Knowledge: 178 docs')).toBeTruthy()
    expect(bar.getByText(/^Synced 5 minutes ago$/)).toBeTruthy()
  })

  it('says when nothing is due', async () => {
    render(<StatusBar {...({ t, ...hooks(null), ...face({ statusFacts: vi.fn(async () => ({})) }) } as unknown as StatusBarProps)} />)
    expect(await screen.findByText(en.nothingDue)).toBeTruthy()
  })
})

describe('ui-workbench browser plugin', () => {
  it('follows the current session into tabs and wires navigation and status facts', async () => {
    expect(hostApply).not.toThrow()
    localStorage.clear()
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    class RemoteService extends Service {
      constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
    }
    new RemoteService(ctx)
    const current = createSnapshotStore<{ key: string | undefined }>({ key: 'a' })
    const layout = { selectPanel: vi.fn((panel: string | null) => { if (panel === 'home') throw new Error('main panel "home" is not registered') }) }
    const uiWorkspace = { openSession: vi.fn(), startSession: vi.fn() }
    const ok = <T,>(value: T) => ({ ok: true as const, value })
    ctx.provide('layout', layout)
    ctx.provide('uiSession', { adapter: { current } })
    ctx.provide('uiWorkspace', uiWorkspace)
    ctx.provide('remote.connectors', {
      agenda: vi.fn(async () => ok({ items: [{ title: 'Quiz', start: '2026-10-01T00:00:00.000Z', status: 'submitted' }, { title: 'HW2', start: '2026-10-02T00:00:00.000Z', status: 'upcoming', course: 'MATH 491' }] })),
      status: vi.fn(async () => ok({ connectors: [], syncedAt: 5 })),
    })
    ctx.provide('remote.memory', { status: vi.fn(async () => ({ ok: false as const, error: { code: 'x', message: 'y' } })) })
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'shell.tabs': { kind: 'list', scope: 'root' }, 'shell.status': { kind: 'list', scope: 'root' } } } as never, () => null)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const workbench = (slots.entries('shell.tabs')[0]!.inject as unknown as () => WorkbenchInjected)()
    expect(slots.entries('shell.status')).toHaveLength(1)
    expect(workbench.openTabs.getSnapshot()).toEqual(['a'])
    current.set({ key: 'b' })
    await waitFor(() => { expect(workbench.openTabs.getSnapshot()).toEqual(['a', 'b']) })
    expect(workbench.currentSession.getSnapshot()).toBe('b')
    workbench.closeTab(id('a'))
    expect(workbench.openTabs.getSnapshot()).toEqual(['b'])
    workbench.openSession(id('b'))
    expect(uiWorkspace.openSession).toHaveBeenCalledWith('b')
    workbench.newSession()
    expect(uiWorkspace.startSession).toHaveBeenCalledOnce()
    workbench.openHome()
    expect(layout.selectPanel).toHaveBeenLastCalledWith(null)
    await expect(workbench.statusFacts()).resolves.toEqual({ nextDue: { title: 'HW2', start: '2026-10-02T00:00:00.000Z', course: 'MATH 491' }, syncedAt: 5 })
  })
})
