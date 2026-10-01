// @vitest-environment jsdom
/** The Home dashboard: greeting, widget cards in order, roster tracking, and opening on Home. */

import { Context } from '@deepseek-ai/cordis'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, greetingFor, HOME_PANEL_ID, inject } from '../src/client/index.ts'
import type { DashboardInjected, DashboardProps, DashboardWidgetMetadata } from '../src/client/index.ts'
import { Dashboard } from '../src/client/Dashboard.tsx'
import { en } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(cleanup)

describe('greetingFor', () => {
  it('greets by the hour', () => {
    expect([4, 5, 11, 12, 17, 18, 23].map(greetingFor)).toEqual(['evening', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening'])
  })
})

describe('Dashboard', () => {
  it('greets with the date, shows an empty state, then one titled card per widget in order', () => {
    const widgets = createSnapshotStore<readonly DashboardWidgetMetadata[]>([])
    const props = {
      t: (key: keyof typeof en) => en[key],
      widgets,
      now: () => new Date(2026, 8, 29, 9).getTime(),
      renderSlot: (name: string, share: { now: number }, options?: { only: string }) => name === 'dashboard.hero' ? <span>{`hero@${new Date(share.now).getHours()}`}</span> : <span>{`${options?.only}@${new Date(share.now).getHours()}`}</span>,
    } as unknown as DashboardProps
    const { rerender } = render(<Dashboard {...props} />)
    expect(screen.getByRole('heading', { level: 1, name: en.morning })).toBeTruthy()
    expect(screen.getByText(/September 29/)).toBeTruthy()
    expect(screen.getByText(en.empty)).toBeTruthy()
    widgets.set([{ id: 'agenda.upcoming', order: 10, label: 'Upcoming' }, { id: 'agenda.assignments', order: 20, label: 'Assignments due' }])
    rerender(<Dashboard {...props} />)
    expect(screen.queryByText(en.empty)).toBeNull()
    expect(screen.getAllByRole('article').map(card => card.getAttribute('aria-label'))).toEqual(['Upcoming', 'Assignments due'])
    expect(screen.getByText('agenda.upcoming@9')).toBeTruthy()
    expect(screen.getByText('hero@9')).toBeTruthy()
  })
})

describe('ui-dashboard browser plugin', () => {
  it('registers Home first in the sidebar, opens it once, and tracks widgets in order', async () => {
    expect(hostApply).not.toThrow()
    expect(inject).toEqual(['slots', 'locale', 'layout'])
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const layout = { selectPanel: vi.fn() }
    ctx.provide('layout', layout)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'main': { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } } } as never, () => null)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const nav = slots.entries('sidebar.panellist')[0]!
    expect(nav.options).toMatchObject({ id: HOME_PANEL_ID, order: -10 })
    expect(resolveSlotLabel(nav.options.label)).toBe('Home')
    await vi.waitFor(() => { expect(layout.selectPanel).toHaveBeenCalledWith(HOME_PANEL_ID) })
    expect(layout.selectPanel).toHaveBeenCalledOnce()

    const face = (slots.entries('main')[0]!.inject as unknown as () => DashboardInjected)()
    expect(face.widgets.getSnapshot()).toEqual([])
    const second = slots.register({ name: 'dashboard.widget', id: 'b', order: 20, label: () => 'B' } as never, () => null)
    slots.register({ name: 'dashboard.widget', id: 'a', order: 10, label: () => 'A' } as never, () => null)
    await vi.waitFor(() => { expect(face.widgets.getSnapshot()).toEqual([{ id: 'a', order: 10, label: 'A' }, { id: 'b', order: 20, label: 'B' }]) })
    second()
    await vi.waitFor(() => { expect(face.widgets.getSnapshot().map(widget => widget.id)).toEqual(['a']) })
    expect(typeof face.now()).toBe('number')
  })
})
