// @vitest-environment jsdom
/** Class page: schedule helpers, the page's cards and sections, and class items that open it. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgendaItem, CourseConfig } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { isExam, nextMeeting, splitMeetings, weeklyMeetings } from '../src/client/index.ts'
import type { AgendaInjected, AgendaWidgetProps, CoursePageProps } from '../src/client/index.ts'
import { CalendarWidget } from '../src/client/CalendarWidget.tsx'
import { CoursePage } from '../src/client/CoursePage.tsx'
import { en } from '../src/client/locales.ts'
import { AssignmentsWidget, UpcomingWidget } from '../src/client/Widgets.tsx'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]
const NOW = Date.now()
const HOUR = 3_600_000
const iso = (offset: number) => new Date(NOW + offset).toISOString()

const COURSE: CourseConfig = { code: 'STAT 581', name: 'Advanced Theory of Statistical Inference I', aliases: ['BIOST 583'], knowledgeBase: 'academic', folders: ['/UW/Autumn 2026/STAT 581'] }
const OTHER: CourseConfig = { code: 'STAT 516', name: 'Stochastic Processes', folders: [] }

const ITEMS: AgendaItem[] = [
  { id: 'c1', source: 'ics', kind: 'event', title: 'STAT 581 A', start: iso(2 * HOUR), end: iso(3.3 * HOUR), allDay: false, location: 'THO 202', courseCode: 'STAT 581', course: 'STAT 581: Advanced Theory of Statistical Inference I' },
  { id: 'c2', source: 'ics', kind: 'event', title: 'STAT 581 A', start: iso(50 * HOUR), end: iso(51.3 * HOUR), allDay: false, location: 'THO 202', courseCode: 'STAT 581', course: 'STAT 581: Advanced Theory of Statistical Inference I' },
  { id: 'm1', source: 'canvas', kind: 'event', title: 'Midterm exam', start: iso(200 * HOUR), end: iso(202 * HOUR), allDay: false, courseCode: 'STAT 581', course: 'STAT 581' },
  { id: 'a1', source: 'canvas', kind: 'assignment', title: 'Homework 1', start: iso(72 * HOUR), allDay: false, courseCode: 'STAT 581', course: 'STAT 581', points: 10, url: 'https://canvas.uw.edu/a/1', status: 'upcoming' },
  { id: 'a0', source: 'canvas', kind: 'assignment', title: 'Homework 0', start: iso(-24 * HOUR), allDay: false, courseCode: 'STAT 581', course: 'STAT 581', status: 'missing' },
  { id: 'a2', source: 'canvas', kind: 'assignment', title: 'Reading', start: iso(10 * HOUR), allDay: false, courseCode: 'STAT 581', course: 'STAT 581', status: 'submitted' },
  { id: 'x1', source: 'ics', kind: 'event', title: 'STAT 516 B', start: iso(4 * HOUR), end: iso(5 * HOUR), allDay: false, courseCode: 'STAT 516', course: 'STAT 516' },
]

function face(overrides: Partial<AgendaInjected> = {}): AgendaInjected {
  return {
    agenda: vi.fn(async () => ITEMS),
    status: vi.fn(async () => ({ connectors: [] })),
    sync: vi.fn(async () => ({ connectors: [] })),
    getSettings: vi.fn(async () => ({ connectors: [], courses: [COURSE, OTHER], pastDays: 7, horizonDays: 60, syncMinutes: 30 })),
    setSettings: vi.fn(),
    setSecret: vi.fn(),
    knowledgeBases: vi.fn(async () => []),
    openPanel: vi.fn(),
    openCourse: vi.fn(),
    selectedCourse: createSnapshotStore<string | undefined>('STAT 581'),
    openHome: vi.fn(),
    revision: createSnapshotStore(0),
    ...overrides,
  }
}

describe('class schedule helpers', () => {
  it('finds the next meeting, groups weekly meetings, and spots exams', () => {
    expect(nextMeeting(ITEMS, NOW)?.id).toBe('c1')
    expect(nextMeeting(ITEMS, NOW + 2.5 * HOUR)?.id).toBe('c1')
    expect(nextMeeting(ITEMS.slice(5, 6), NOW)).toBeUndefined()
    const meetings = weeklyMeetings(ITEMS.slice(0, 2))
    expect(meetings).toHaveLength(1)
    expect(meetings[0]?.days).toHaveLength(2)
    expect(meetings[0]?.location).toBe('THO 202')
    const office: AgendaItem = { id: 'o1', source: 'canvas', kind: 'event', title: 'Office hour (Chen)', start: iso(1 * HOUR), end: iso(1.5 * HOUR), allDay: false, location: 'Zoom', courseCode: 'STAT 581' }
    const split = splitMeetings([office, ...ITEMS.slice(0, 2)])
    expect(split.classes.map(item => item.id)).toEqual(['c1', 'c2'])
    expect(split.other.map(item => item.id)).toEqual(['o1'])
    expect(nextMeeting(split.classes, NOW)?.id).toBe('c1')
    expect(weeklyMeetings([office])[0]?.title).toBe('Office hour (Chen)')
    expect(splitMeetings([office]).classes).toEqual([office])
    expect(isExam(ITEMS[2]!)).toBe(true)
    expect(isExam(ITEMS[3]!)).toBe(false)
  })
})

describe('CoursePage', () => {
  const props = (injected: AgendaInjected, renderSlot = vi.fn(() => <article aria-label="Study">study section</article>)): CoursePageProps =>
    ({ t, ...injected, renderSlot }) as never

  it('shows the next class, its room, the weekly schedule, exams, open work, sections, and materials', async () => {
    const injected = face()
    const renderSlot = vi.fn(() => <article aria-label="Study">study section</article>)
    render(<CoursePage {...props(injected, renderSlot)} />)
    expect(await screen.findByRole('heading', { name: 'STAT 581' })).toBeTruthy()
    expect(screen.getByText('Advanced Theory of Statistical Inference I')).toBeTruthy()
    expect(screen.getByText('Also listed as BIOST 583')).toBeTruthy()
    expect(screen.getAllByText('THO 202').length).toBeGreaterThan(0)
    expect(screen.getByText(en.weekly)).toBeTruthy()
    expect(screen.getByText('Midterm exam')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Homework 1' }).getAttribute('href')).toBe('https://canvas.uw.edu/a/1')
    expect(screen.getByText('Homework 0')).toBeTruthy()
    expect(screen.queryByText('Reading')).toBeNull()
    expect(screen.queryByText('STAT 516 B')).toBeNull()
    expect(screen.getByText('study section')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith('course.section', expect.objectContaining({ course: COURSE }))
    expect(screen.getByText('/UW/Autumn 2026/STAT 581')).toBeTruthy()
    expect(screen.getByText('Notes are searched in the academic knowledge base.')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'STAT 516' }))
    expect(injected.openCourse).toHaveBeenCalledWith('STAT 516')
    fireEvent.click(screen.getByText(en.backHome))
    expect(injected.openHome).toHaveBeenCalled()
  })

  it('falls back to the first class, and reports empty and failed loads', async () => {
    render(<CoursePage {...props(face({ selectedCourse: createSnapshotStore<string | undefined>(undefined), agenda: vi.fn(async () => []) }))} />)
    expect(await screen.findByRole('heading', { name: 'STAT 581' })).toBeTruthy()
    expect(screen.getByText(en.noNextClass)).toBeTruthy()
    expect(screen.getByText(en.noAssignments)).toBeTruthy()
    cleanup()
    render(<CoursePage {...props(face({ getSettings: vi.fn(async () => ({ connectors: [], courses: [], pastDays: 7, horizonDays: 60, syncMinutes: 30 })) }))} />)
    expect(await screen.findByText(en.noCourses)).toBeTruthy()
    cleanup()
    render(<CoursePage {...props(face({ agenda: vi.fn(async () => { throw new Error('down') }) }))} />)
    expect(await screen.findByText(en.loadFailed)).toBeTruthy()
  })
})

describe('class items', () => {
  const props = (injected: AgendaInjected): AgendaWidgetProps => ({ t, now: NOW, ...injected }) as never

  it('open the class page from the calendar, the upcoming list, and assignments', async () => {
    const injected = face()
    render(<CalendarWidget {...props(injected)} />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'STAT 581 A' }))[0]!)
    expect(injected.openCourse).toHaveBeenCalledWith('STAT 581')
    cleanup()
    render(<UpcomingWidget {...props(injected)} />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'STAT 516 B' }))[0]!)
    expect(injected.openCourse).toHaveBeenLastCalledWith('STAT 516')
    cleanup()
    render(<AssignmentsWidget {...props(injected)} />)
    await waitFor(() => { expect(screen.getAllByRole('button', { name: 'STAT 581' }).length).toBeGreaterThan(0) })
    fireEvent.click(screen.getAllByRole('button', { name: 'STAT 581' })[0]!)
    expect(injected.openCourse).toHaveBeenLastCalledWith('STAT 581')
  })
})
