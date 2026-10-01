// @vitest-environment jsdom
/** Agenda: date helpers, dashboard widgets, the connectors panel, and plugin wiring. */

import { Context, Service } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { AgendaItem, ConnectorSettingsUpdate } from '@deepseek-ai/dsh-api-remotes/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, byDay, connectorIdentity, dayHeading, dayKey, inject, relative } from '../src/client/index.ts'
import type { AgendaInjected, AgendaPanelProps, AgendaWidgetProps } from '../src/client/index.ts'
import { AgendaPanel } from '../src/client/AgendaPanel.tsx'
import { CalendarWidget } from '../src/client/CalendarWidget.tsx'
import { en } from '../src/client/locales.ts'
import { addDays, calendarWindow, dateKey, groupByDay, hourLabel, layoutDay, periodTitle, startOfDay, stepAnchor } from '../src/client/model.ts'
import { AssignmentsWidget, UpcomingWidget } from '../src/client/Widgets.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]
const NOW = new Date(2026, 8, 29, 9, 0).getTime()
const at = (days: number, hours = 0) => new Date(NOW + days * 86_400_000 + hours * 3_600_000).toISOString()

const ITEMS: AgendaItem[] = [
  { id: 'e1', source: 'g', kind: 'event', title: 'STAT 538 Lecture', start: at(0, 1.5), end: at(0, 2.3), allDay: false, location: 'Padelford C-36' },
  { id: 'e2', source: 'g', kind: 'event', title: 'Holiday', start: `${dayKey(at(1), false)}T00:00:00.000Z`, allDay: true },
  { id: 'a0', source: 'c', kind: 'assignment', title: 'HW3', start: at(-2), allDay: false, course: 'STAT 534', status: 'missing' },
  { id: 'a1', source: 'c', kind: 'assignment', title: 'HW4', start: at(2), allDay: false, course: 'STAT 534', points: 10, url: 'https://canvas.uw.edu/a/4', status: 'upcoming' },
  { id: 'a2', source: 'c', kind: 'assignment', title: 'Quiz', start: at(3), allDay: false, status: 'submitted' },
]

function face(overrides: Partial<AgendaInjected> = {}): AgendaInjected {
  return {
    agenda: vi.fn(async (_from: Date, _to: Date, kinds?: readonly string[]) =>
      ITEMS.filter(item => kinds === undefined || kinds.includes(item.kind))),
    status: vi.fn(async () => ({ connectors: [{ id: 'canvas', syncedAt: NOW - 3_600_000, items: 3, configured: true }], syncedAt: NOW - 3_600_000 })),
    sync: vi.fn(async () => ({ connectors: [], syncedAt: NOW })),
    getSettings: vi.fn(async () => ({ connectors: [], courses: [], pastDays: 7, horizonDays: 60, syncMinutes: 30 })),
    setSettings: vi.fn(async (update: ConnectorSettingsUpdate) => ({
      connectors: update.connectors ?? [],
      courses: update.courses ?? [],
      pastDays: 7,
      horizonDays: 60,
      syncMinutes: 30,
      ...update.notesDir === undefined || update.notesDir === null ? {} : { notesDir: update.notesDir },
    })),
    knowledgeBases: vi.fn(async () => [{ id: 'academic', name: 'Academic' }]),
    setSecret: vi.fn(async () => {}),
    openPanel: vi.fn(),
    openCourse: vi.fn(),
    selectedCourse: createSnapshotStore<string | undefined>(undefined),
    openHome: vi.fn(),
    revision: createSnapshotStore(0),
    ...overrides,
  }
}

describe('date helpers', () => {
  it('keys days locally, keeps all-day items on their date, and labels today and tomorrow', () => {
    expect(dayKey('2026-10-12T00:00:00.000Z', true)).toBe('2026-10-12')
    expect(dayHeading(dayKey(at(0), false), NOW, { today: 'Today', tomorrow: 'Tomorrow' })).toBe('Today')
    expect(dayHeading(dayKey(at(1), false), NOW, { today: 'Today', tomorrow: 'Tomorrow' })).toBe('Tomorrow')
    expect(dayHeading(dayKey(at(3), false), NOW, { today: 'Today', tomorrow: 'Tomorrow' })).not.toMatch(/Today|Tomorrow/)
    expect(byDay(ITEMS.slice(0, 2)).map(group => group.items.length)).toEqual([1, 1])
    expect(relative(at(0, 0.5), NOW)).toMatch(/30 minutes/)
    expect(relative(at(0, -3), NOW)).toMatch(/3 hours ago/)
    expect(relative(at(2), NOW)).toMatch(/2 days/)
  })

  it('derives unique connector ids and credential names', () => {
    expect(connectorIdentity('canvas', 'UW Canvas', new Set())).toEqual({ id: 'uw-canvas', secret: 'CANVAS_UW_CANVAS' })
    expect(connectorIdentity('ics', 'Google', new Set(['google']))).toEqual({ id: 'google-2', secret: 'ICS_GOOGLE_2' })
    expect(connectorIdentity('ics', '!!!', new Set())).toEqual({ id: 'ics', secret: 'ICS_ICS' })
  })
})

describe('widgets', () => {
  const props = (agenda: AgendaInjected) => ({ t, now: NOW, ...agenda }) as unknown as AgendaWidgetProps

  it('lists this week\'s events by day and syncs on demand', async () => {
    const agenda = face()
    render(<UpcomingWidget {...props(agenda)} />)
    expect(await screen.findByText('STAT 538 Lecture')).toBeTruthy()
    expect(screen.getByText('Today')).toBeTruthy()
    expect(screen.getByText('Tomorrow')).toBeTruthy()
    expect(screen.getByText(en.allDay)).toBeTruthy()
    expect(await screen.findByText(/Synced .*hour ago/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.syncNow }))
    await waitFor(() => { expect(agenda.sync).toHaveBeenCalledOnce() })
  })

  it('shows overdue work first, upcoming deadlines with details, and counts finished work', async () => {
    render(<AssignmentsWidget {...props(face())} />)
    expect(await screen.findByText(en.overdue)).toBeTruthy()
    expect(screen.getByText('HW3')).toBeTruthy()
    expect(screen.getByText(en['status.missing'])).toBeTruthy()
    expect(screen.getByRole('link', { name: 'HW4' }).getAttribute('href')).toBe('https://canvas.uw.edu/a/4')
    expect(screen.getByText('STAT 534 · 10 pts')).toBeTruthy()
    expect(screen.getByText('1 done')).toBeTruthy()
  })

  it('offers setup when nothing is connected and reports a failed load', async () => {
    const agenda = face({ agenda: vi.fn(async () => []), status: vi.fn(async () => ({ connectors: [] })) })
    render(<AssignmentsWidget {...props(agenda)} />)
    expect(await screen.findByText(en.noAssignments)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: en.setUp }))
    expect(agenda.openPanel).toHaveBeenCalledOnce()
    cleanup()
    render(<UpcomingWidget {...props(face({ agenda: vi.fn(async () => { throw new Error('down') }) }))} />)
    expect(await screen.findByText(en.loadFailed)).toBeTruthy()
  })
})

describe('calendar helpers', () => {
  const anchor = new Date(2026, 8, 29, 9, 0).getTime()

  it('builds day, week, and month grids around the anchor', () => {
    expect(dateKey(anchor)).toBe('2026-09-29')
    const day = calendarWindow('day', anchor, NOW)
    expect(day.days.map(entry => entry.key)).toEqual(['2026-09-29'])
    expect(day.from).toBe(startOfDay(anchor))
    expect(day.to).toBe(addDays(startOfDay(anchor), 1))
    const week = calendarWindow('week', anchor, NOW)
    expect(week.days.map(entry => entry.key)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'])
    expect(week.days.every(entry => entry.inMonth)).toBe(true)
    expect(week.days.filter(entry => entry.today).map(entry => entry.key)).toEqual(['2026-09-29'])
    const month = calendarWindow('month', anchor, NOW)
    expect(month.days).toHaveLength(42)
    expect(month.days[0]!.key).toBe('2026-08-30')
    expect(month.days[0]!.inMonth).toBe(false)
    expect(month.days.find(entry => entry.key === '2026-09-01')!.inMonth).toBe(true)
  })

  it('titles and steps each period', () => {
    expect(periodTitle('day', anchor)).toMatch(/Tuesday, September 29/)
    expect(periodTitle('week', anchor)).toMatch(/Sep 27/)
    expect(periodTitle('month', anchor)).toMatch(/September 2026/)
    expect(dateKey(stepAnchor('day', anchor, 1))).toBe('2026-09-30')
    expect(dateKey(stepAnchor('week', anchor, 1))).toBe('2026-10-06')
    expect(dateKey(stepAnchor('week', anchor, -1))).toBe('2026-09-22')
    expect(dateKey(stepAnchor('month', anchor, 1))).toBe('2026-10-01')
    expect(dateKey(stepAnchor('month', anchor, -1))).toBe('2026-08-01')
    expect(hourLabel(9)).toMatch(/9/)
  })

  it('place items on days, split all-day from timed, and drops items outside the grid', () => {
    const days = calendarWindow('week', anchor, NOW).days
    const grouped = groupByDay(ITEMS, days)
    expect(grouped.get('2026-09-29')!.timed.map(item => item.id)).toEqual(['e1'])
    expect(grouped.get('2026-09-30')!.allDay.map(item => item.id)).toEqual(['e2'])
    expect(grouped.get('2026-10-01')!.timed.map(item => item.id)).toEqual(['a1'])
    expect(groupByDay([{ ...ITEMS[0]!, id: 'old', start: at(-30) }], days).size).toBe(0)
    expect(byDay([ITEMS[0]!, { ...ITEMS[0]!, id: 'e1b' }])).toEqual([{ key: '2026-09-29', items: [ITEMS[0], { ...ITEMS[0]!, id: 'e1b' }] }])
  })

  it('lays overlapping timed items into lanes and clamps them to the day', () => {
    const day = startOfDay(anchor)
    const ev = (id: string, hour: number, minute = 0, endHour?: number, endMinute = minute): AgendaItem => ({
      id, source: 'g', kind: 'event', title: id, allDay: false,
      start: new Date(2026, 8, 29, hour, minute).toISOString(),
      ...endHour === undefined ? {} : { end: new Date(2026, 8, 29, endHour, endMinute).toISOString() },
    })
    const placed = layoutDay([ev('b', 9, 30, 10), ev('a', 9, 0, 10)], day)
    expect(placed.map(entry => [entry.item.id, entry.startMinute, entry.lane, entry.lanes])).toEqual([['a', 540, 0, 2], ['b', 570, 1, 2]])
    expect(layoutDay([ev('z', 9, 0, 10), ev('a', 9, 0, 11)], day).map(entry => entry.item.id)).toEqual(['a', 'z'])
    const reused = layoutDay([ev('p', 9, 0, 9, 30), ev('q', 9, 0, 10), ev('r', 9, 30, 9, 45)], day)
    expect(reused.map(entry => [entry.item.id, entry.startMinute, entry.endMinute, entry.lane, entry.lanes])).toEqual([['p', 540, 570, 0, 2], ['q', 540, 600, 1, 2], ['r', 570, 585, 0, 2]])
    const clamped = layoutDay([{ ...ev('early', 0, 0, 2), start: new Date(2026, 8, 28, 23, 0).toISOString() }, ev('later', 1), ev('evening', 3)], day)
    expect(clamped.map(entry => [entry.item.id, entry.startMinute, entry.endMinute, entry.lane, entry.lanes])).toEqual([['early', 0, 120, 0, 2], ['later', 60, 90, 1, 2], ['evening', 180, 210, 0, 1]])
  })
})

describe('CalendarWidget', () => {
  const props = (agenda: AgendaInjected) => ({ t, now: NOW, ...agenda }) as unknown as AgendaWidgetProps

  it('shows the month grid, the time grid, and the day view', async () => {
    render(<CalendarWidget {...props(face())} />)
    expect(await screen.findByText(/September 2026/)).toBeTruthy()
    expect(screen.getByText('Sun')).toBeTruthy()
    expect(screen.getByText('Sat')).toBeTruthy()
    expect(screen.getByText('Holiday')).toBeTruthy()
    expect(screen.getByRole('link', { name: /HW4/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: en.viewWeek }))
    expect(screen.getByText(en.allDay)).toBeTruthy()
    expect(screen.getAllByText(hourLabel(9)).length).toBeGreaterThan(0)
    expect(screen.getByText(/STAT 538 Lecture/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /HW4/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: en.viewDay }))
    expect(screen.getByText(/Tuesday, September 29/)).toBeTruthy()
    expect(screen.getByText(/STAT 538 Lecture/)).toBeTruthy()
  })

  it('navigates periods and returns to today', async () => {
    render(<CalendarWidget {...props(face())} />)
    expect(await screen.findByText(/September 2026/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.next }))
    expect(screen.getByText(/October 2026/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.previous }))
    expect(screen.getByText(/September 2026/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.previous }))
    expect(screen.getByText(/August 2026/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.todayButton }))
    expect(screen.getByText(/September 2026/)).toBeTruthy()
  })

  it('caps a busy day and reports the remaining items', async () => {
    const many = Array.from({ length: 4 }, (_, index) => ({ id: `m${index}`, source: 'g', kind: 'event' as const, title: `Meeting ${index}`, start: at(0, index), allDay: false }))
    render(<CalendarWidget {...props(face({ agenda: vi.fn(async () => many) }))} />)
    expect(await screen.findByText('+1 more')).toBeTruthy()
  })

  it('reports an empty calendar and a failed load', async () => {
    render(<CalendarWidget {...props(face({ agenda: vi.fn(async () => []) }))} />)
    expect(await screen.findByText(en.calendarEmpty)).toBeTruthy()
    cleanup()
    render(<CalendarWidget {...props(face({ agenda: vi.fn(async () => { throw new Error('down') }) }))} />)
    expect(await screen.findByText(en.loadFailed)).toBeTruthy()
  })

  it('ignores a window result that settles after unmount', async () => {
    let settle: () => void = () => {}
    const pending = new Promise<readonly AgendaItem[]>((resolve) => { settle = () => { resolve(ITEMS) } })
    const view = render(<CalendarWidget {...props(face({ agenda: vi.fn(() => pending) }))} />)
    view.unmount()
    settle()
    let fail: () => void = () => {}
    const failing = new Promise<readonly AgendaItem[]>((_resolve, reject) => { fail = () => { reject(new Error('late')) } })
    const second = render(<CalendarWidget {...props(face({ agenda: vi.fn(() => failing) }))} />)
    second.unmount()
    fail()
    await Promise.resolve()
    expect(screen.queryByText(/September 2026/)).toBeNull()
  })
})

describe('AgendaPanel', () => {
  it('adds a Canvas connector with its token, then syncs', async () => {
    const agenda = face()
    render(<AgendaPanel {...({ t, ...agenda } as unknown as AgendaPanelProps)} />)
    expect(await screen.findByText(en.noConnectors)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.addCanvas }))
    expect((screen.getByRole('textbox', { name: en.baseUrl }) as HTMLInputElement).value).toBe('https://canvas.uw.edu')
    fireEvent.change(screen.getByLabelText(en.secretCanvas), { target: { value: 'token-1' } })
    fireEvent.click(within(screen.getByLabelText(en.secretCanvas).closest('form')!).getByRole('button', { name: en.save }))
    await waitFor(() => { expect(agenda.setSecret).toHaveBeenCalledWith('canvas', 'token-1') })
    expect(agenda.setSettings).toHaveBeenCalledWith({ connectors: [{ id: 'canvas', kind: 'canvas', name: 'Canvas', enabled: true, secret: 'CANVAS_CANVAS', baseUrl: 'https://canvas.uw.edu' }] })
    await waitFor(() => { expect(agenda.sync).toHaveBeenCalledOnce() })
  })

  it('toggles, replaces the secret of, and removes an existing connector; saves the notes folder', async () => {
    const connector = { id: 'google', kind: 'ics' as const, name: 'Google', enabled: true, secret: 'ICS_GOOGLE' }
    const agenda = face({
      getSettings: vi.fn(async () => ({ connectors: [connector], courses: [], pastDays: 7, horizonDays: 60, syncMinutes: 30 })),
      status: vi.fn(async () => ({ connectors: [{ id: 'google', syncedAt: NOW, items: 4, configured: true, error: 'calendar feed returned HTTP 404' }], syncedAt: NOW })),
    })
    render(<AgendaPanel {...({ t, ...agenda } as unknown as AgendaPanelProps)} />)
    const row = within((await screen.findByText('Google')).closest('li')!)
    expect(row.getByText('calendar feed returned HTTP 404')).toBeTruthy()
    fireEvent.click(row.getByRole('checkbox', { name: `${en.enabled}: Google` }))
    await waitFor(() => { expect(agenda.setSettings).toHaveBeenCalledWith({ connectors: [{ ...connector, enabled: false }] }) })
    fireEvent.click(row.getByRole('button', { name: en.replaceSecret }))
    fireEvent.change(row.getByLabelText(en.secretCalendar), { target: { value: 'https://calendar.google.com/x.ics' } })
    fireEvent.click(row.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(agenda.setSecret).toHaveBeenCalledWith('google', 'https://calendar.google.com/x.ics') })
    fireEvent.change(screen.getByRole('textbox', { name: en.notesTitle }), { target: { value: '~/Documents/tony\'s vault' } })
    fireEvent.click(within(screen.getByRole('textbox', { name: en.notesTitle }).closest('form')!).getByRole('button', { name: en.save }))
    await waitFor(() => { expect(agenda.setSettings).toHaveBeenCalledWith({ notesDir: '~/Documents/tony\'s vault' }) })
    expect(screen.getByText('STAT 538 Lecture')).toBeTruthy()
  })

  it('names a class and links it to a knowledge base and folders', async () => {
    const course = { code: 'STAT 536/427', name: 'Analysis of Categorical and Count Data', folders: [] }
    const agenda = face({
      getSettings: vi.fn(async () => ({ connectors: [], courses: [course], pastDays: 7, horizonDays: 60, syncMinutes: 30 })),
    })
    render(<AgendaPanel {...({ t, ...agenda } as unknown as AgendaPanelProps)} />)
    const name = await screen.findByRole('textbox', { name: `${en.courseName}: STAT 536/427` }) as HTMLInputElement
    expect(name.value).toBe('Analysis of Categorical and Count Data')
    const save = screen.getByRole('button', { name: en.saveCourses }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(name, { target: { value: 'Categorical Data' } })
    await screen.findByRole('option', { name: 'Academic' })
    fireEvent.change(screen.getByRole('combobox', { name: `${en.courseKb}: STAT 536/427` }), { target: { value: 'academic' } })
    fireEvent.change(screen.getByRole('textbox', { name: `${en.courseFolders}: STAT 536/427` }), { target: { value: '~/UW/STAT 536\n\n' } })
    fireEvent.change(screen.getByRole('textbox', { name: `${en.courseAliases}: STAT 536/427` }), { target: { value: 'STAT 427, ' } })
    fireEvent.click(save)
    await waitFor(() => { expect(agenda.setSettings).toHaveBeenCalledWith({ courses: [{ code: 'STAT 536/427', name: 'Categorical Data', aliases: ['STAT 427'], folders: ['~/UW/STAT 536'], knowledgeBase: 'academic' }] }) })
    expect(await screen.findByText(en.coursesSaved)).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: `${en.courseKb}: STAT 536/427` }), { target: { value: '' } })
    expect(screen.queryByText(en.coursesSaved)).toBeNull()
  })

  it('reports a failed action', async () => {
    const agenda = face({ setSettings: vi.fn(async () => { throw new Error('connector "x" needs a name') }) })
    render(<AgendaPanel {...({ t, ...agenda } as unknown as AgendaPanelProps)} />)
    fireEvent.click(await screen.findByRole('button', { name: en.addCalendar }))
    fireEvent.change(screen.getByRole('textbox', { name: en.name }), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText(en.secretCalendar), { target: { value: 'https://a/b.ics' } })
    fireEvent.click(within(screen.getByLabelText(en.secretCalendar).closest('form')!).getByRole('button', { name: en.save }))
    expect((await screen.findByRole('alert')).textContent).toBe('The request failed: connector "x" needs a name')
  })
})

describe('ui-agenda browser plugin', () => {
  it('registers three widgets, the panel, and its sidebar entry, and wires the Remote calls', async () => {
    expect(hostApply).not.toThrow()
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    class RemoteService extends Service {
      constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
    }
    new RemoteService(ctx)
    const ok = <T,>(value: T) => ({ ok: true as const, value })
    const connectors = {
      agenda: vi.fn(async () => ok({ items: ITEMS })),
      status: vi.fn(async () => ok({ connectors: [] })),
      sync: vi.fn(async () => ok({ connectors: [], syncedAt: 1 })),
      getSettings: vi.fn(async () => ok({ connectors: [] })),
      setSettings: vi.fn(async () => ok({ connectors: [] })),
      setSecret: vi.fn(async () => ({ ok: false as const, error: { code: 'gateway/bad-request', message: 'unknown connector "x"' } })),
    }
    const layout = { selectPanel: vi.fn() }
    ctx.provide('remote.connectors', connectors)
    type MemoryResult =
      | { ok: true; value: { collections: { id: string; name: string; sources: string[] }[] } }
      | { ok: false; error: { code: string; message: string } }
    const memory = vi.fn(async (): Promise<MemoryResult> => ok({ collections: [{ id: 'academic', name: 'Academic', sources: [] }] }))
    ctx.provide('remote.memory', { getSettings: memory })
    ctx.provide('layout', layout)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'dashboard.widget': { kind: 'list', scope: 'root' }, 'main': { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } } } as never, () => null)
    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(slots.entries('dashboard.widget').map(entry => [(entry.options as { id: string }).id, resolveSlotLabel(entry.options.label)])).toEqual([['agenda.calendar', 'Calendar'], ['agenda.upcoming', 'Upcoming'], ['agenda.assignments', 'Assignments due']])
    expect(resolveSlotLabel(slots.entries('sidebar.panellist')[0]!.options.label)).toBe('Agenda')
    const agenda = (slots.entries('main')[0]!.inject as unknown as () => AgendaInjected)()
    for (const entry of slots.entries('dashboard.widget')) (entry.inject as unknown as () => AgendaInjected)()
    await expect(agenda.agenda(new Date(0), new Date(1), ['event'])).resolves.toEqual(ITEMS)
    expect(connectors.agenda).toHaveBeenCalledWith({ from: '1970-01-01T00:00:00.000Z', to: '1970-01-01T00:00:00.001Z', kinds: ['event'] })
    await agenda.agenda(new Date(0), new Date(1))
    expect(connectors.agenda).toHaveBeenCalledWith({ from: '1970-01-01T00:00:00.000Z', to: '1970-01-01T00:00:00.001Z' })
    await expect(agenda.status()).resolves.toEqual({ connectors: [] })
    await expect(agenda.getSettings()).resolves.toEqual({ connectors: [] })
    await expect(agenda.setSettings({ connectors: [] })).resolves.toEqual({ connectors: [] })
    expect(agenda.revision.getSnapshot()).toBe(0)
    await agenda.sync()
    expect(agenda.revision.getSnapshot()).toBe(1)
    await expect(agenda.setSecret('x', 'y')).rejects.toThrow('connectors/setSecret: unknown connector "x"')
    agenda.openPanel()
    expect(layout.selectPanel).toHaveBeenCalledWith('agenda')
    agenda.openCourse('STAT 581')
    expect(agenda.selectedCourse.getSnapshot()).toBe('STAT 581')
    expect(layout.selectPanel).toHaveBeenCalledWith('course')
    agenda.openHome()
    expect(layout.selectPanel).toHaveBeenLastCalledWith('home')
    expect(slots.entries('main').map(entry => entry.options.key)).toEqual(['agenda', 'course'])
    await expect(agenda.knowledgeBases()).resolves.toEqual([{ id: 'academic', name: 'Academic' }])
    memory.mockImplementationOnce(async () => ({ ok: false as const, error: { code: 'memory/unavailable', message: 'off' } }))
    await expect(agenda.knowledgeBases()).resolves.toEqual([])
  })
})
