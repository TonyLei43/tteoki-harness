/** Connectors: ICS expansion, Canvas planner mapping, the agenda note, and the sync service. */

import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { assignmentStatus, BLOCK_END, BLOCK_START, Connectors, nextPage, parseIcs, plannerItem, renderAgenda, validateSettings, writeAgendaNote } from '../src/index.ts'
import type { AgendaItem } from '../src/index.ts'

afterEach(() => { vi.unstubAllGlobals() })

const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-CALNAME:UW Classes',
  'BEGIN:VTIMEZONE',
  'TZID:America/Los_Angeles',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'TZOFFSETFROM:-0800',
  'TZOFFSETTO:-0700',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0800',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:lecture-538',
  'SUMMARY:STAT 538 Lecture',
  'LOCATION:Padelford C-36',
  'DTSTART;TZID=America/Los_Angeles:20260928T103000',
  'DTEND;TZID=America/Los_Angeles:20260928T112000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:lecture-538',
  'RECURRENCE-ID;TZID=America/Los_Angeles:20260930T103000',
  'SUMMARY:STAT 538 Lecture (moved)',
  'DTSTART;TZID=America/Los_Angeles:20261001T140000',
  'DTEND;TZID=America/Los_Angeles:20261001T145000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:lecture-538',
  'RECURRENCE-ID;TZID=America/Los_Angeles:20261005T103000',
  'STATUS:CANCELLED',
  'DTSTART;TZID=America/Los_Angeles:20261005T103000',
  'DTEND;TZID=America/Los_Angeles:20261005T112000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:holiday',
  'SUMMARY:Holiday',
  'DTSTART;VALUE=DATE:20261012',
  'DTEND;VALUE=DATE:20261013',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-123',
  'SUMMARY:HW4',
  'URL:https://canvas.uw.edu/courses/1/assignments/123',
  'DESCRIPTION:Metropolis-Hastings',
  'DTSTART:20261002T065900Z',
  'DTEND:20261002T065900Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:old',
  'SUMMARY:Old',
  'DTSTART:20250101T100000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

const WINDOW = { from: new Date('2026-09-27T00:00:00Z'), to: new Date('2026-10-20T00:00:00Z') }

describe('parseIcs', () => {
  it('expands recurrences with moved and cancelled occurrences, all-day events, and Canvas assignments', () => {
    const items = parseIcs(FEED, { id: 'google', name: 'Google' }, WINDOW)
    expect(items.map(item => [item.title, item.start, item.kind, item.allDay])).toEqual([
      ['STAT 538 Lecture', '2026-09-28T17:30:00.000Z', 'event', false],
      ['STAT 538 Lecture (moved)', '2026-10-01T21:00:00.000Z', 'event', false],
      ['HW4', '2026-10-02T06:59:00.000Z', 'assignment', false],
      ['STAT 538 Lecture', '2026-10-07T17:30:00.000Z', 'event', false],
      ['STAT 538 Lecture', '2026-10-12T17:30:00.000Z', 'event', false],
      ['Holiday', '2026-10-12T00:00:00.000Z', 'event', true],
      ['STAT 538 Lecture', '2026-10-14T17:30:00.000Z', 'event', false],
    ].sort((left, right) => String(left[1]).localeCompare(String(right[1]))))
    expect(items[0]).toMatchObject({ id: 'google:lecture-538:2026-09-28T17:30:00.000Z', source: 'google', course: 'UW Classes', location: 'Padelford C-36', end: '2026-09-28T18:20:00.000Z' })
    expect(items.find(item => item.title === 'HW4')).toMatchObject({ url: 'https://canvas.uw.edu/courses/1/assignments/123', description: 'Metropolis-Hastings' })
    expect(items.find(item => item.title === 'HW4')!.end).toBeUndefined()
  })

  it('rejects text that is not a calendar', () => {
    expect(() => parseIcs('BEGIN:VCARD\r\nEND:VCARD', { id: 'x', name: 'x' }, WINDOW)).toThrow('not an iCalendar calendar')
  })
})

describe('Canvas', () => {
  it('derives assignment status from submission facts', () => {
    expect(assignmentStatus(undefined)).toBe('upcoming')
    expect(assignmentStatus(false)).toBe('upcoming')
    expect(assignmentStatus({ excused: true, graded: true })).toBe('excused')
    expect(assignmentStatus({ graded: true, submitted: true })).toBe('graded')
    expect(assignmentStatus({ missing: true })).toBe('missing')
    expect(assignmentStatus({ late: true, submitted: true })).toBe('late')
    expect(assignmentStatus({ submitted: true })).toBe('submitted')
    expect(assignmentStatus({})).toBe('upcoming')
  })

  it('maps planner items and skips notes and undated items', () => {
    const base = 'https://canvas.uw.edu'
    expect(plannerItem({ plannable_id: 7, plannable_type: 'assignment', plannable_date: '2026-10-02T06:59:00Z', context_name: 'STAT 534', html_url: '/courses/1/assignments/7', submissions: { submitted: false }, plannable: { title: 'HW4', points_possible: 10 } }, 'canvas', base))
      .toEqual({ id: 'canvas:assignment:7', source: 'canvas', kind: 'assignment', title: 'HW4', start: '2026-10-02T06:59:00.000Z', allDay: false, course: 'STAT 534', url: 'https://canvas.uw.edu/courses/1/assignments/7', status: 'upcoming', points: 10 })
    expect(plannerItem({ plannable_id: 'e1', plannable_type: 'calendar_event', plannable_date: '2026-10-03T17:00:00Z', plannable: { title: 'Office hours', end_at: '2026-10-03T18:00:00Z', location_name: 'B-301' } }, 'canvas', base))
      .toMatchObject({ kind: 'event', end: '2026-10-03T18:00:00.000Z', location: 'B-301' })
    expect(plannerItem({ plannable_id: 1, plannable_type: 'planner_note', plannable_date: '2026-10-03T17:00:00Z', plannable: { title: 'x' } }, 'canvas', base)).toBeUndefined()
    expect(plannerItem({ plannable_id: 1, plannable_type: 'quiz', plannable_date: null, plannable: { title: 'x', due_at: null } }, 'canvas', base)).toBeUndefined()
  })

  it('follows next links only on the Canvas origin', () => {
    expect(nextPage('<https://canvas.uw.edu/api/v1/planner/items?page=2>; rel="next", <https://canvas.uw.edu/x>; rel="last"', 'https://canvas.uw.edu')).toBe('https://canvas.uw.edu/api/v1/planner/items?page=2')
    expect(nextPage('<https://evil.example/steal>; rel="next"', 'https://canvas.uw.edu')).toBeUndefined()
    expect(nextPage('<https://canvas.uw.edu/x>; rel="last"', 'https://canvas.uw.edu')).toBeUndefined()
    expect(nextPage(null, 'https://canvas.uw.edu')).toBeUndefined()
  })
})

const ITEMS: AgendaItem[] = [
  { id: 'a', source: 'canvas', kind: 'assignment', title: 'HW3', start: '2026-09-27T06:59:00.000Z', allDay: false, course: 'STAT 534', status: 'missing' },
  { id: 'b', source: 'canvas', kind: 'assignment', title: 'Quiz 1', start: '2026-09-28T06:59:00.000Z', allDay: false, status: 'submitted' },
  { id: 'c', source: 'google', kind: 'event', title: 'STAT 538 Lecture', start: '2026-09-29T17:30:00.000Z', end: '2026-09-29T18:20:00.000Z', allDay: false, course: 'UW Classes', location: 'Padelford C-36' },
  { id: 'd', source: 'canvas', kind: 'assignment', title: 'HW4 [draft]', start: '2026-09-30T06:59:00.000Z', allDay: false, course: 'STAT 534', url: 'https://canvas.uw.edu/a/4', points: 10, status: 'upcoming' },
  { id: 'e', source: 'google', kind: 'event', title: 'Holiday', start: '2026-09-30T00:00:00.000Z', allDay: true },
  { id: 'f', source: 'google', kind: 'event', title: 'Far away', start: '2026-12-01T17:00:00.000Z', allDay: false },
]

describe('agenda note', () => {
  it('renders overdue work and the next days by local date', () => {
    const block = renderAgenda(ITEMS, new Date('2026-09-29T16:00:00Z'), 'America/Los_Angeles')
    expect(block).toBe([
      BLOCK_START,
      '_Synced Sep 29, 2026, 9:00 AM by Tteoki. This block is replaced on every sync; write notes outside it._',
      '',
      '## Overdue',
      '',
      '- [ ] Sep 26, 23:59 **HW3** — STAT 534 · missing',
      '',
      '## Next 14 days',
      '',
      '### Tue, Sep 29',
      '',
      '- 10:30–11:20 STAT 538 Lecture — UW Classes · Padelford C-36',
      '- [ ] 23:59 **[HW4 draft](https://canvas.uw.edu/a/4)** — STAT 534 · 10 pts',
      '',
      '### Wed, Sep 30',
      '',
      '- All day Holiday',
      '',
      BLOCK_END,
    ].join('\n'))
    expect(renderAgenda([], new Date('2026-09-29T16:00:00Z'), 'UTC')).toContain('Nothing scheduled.')
  })

  it('creates the note, replaces only its block, and appends a block to a note without one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-agenda-'))
    onTestFinished(() => { rmSync(dir, { recursive: true, force: true }) })
    const path = await writeAgendaNote(join(dir, 'vault'), `${BLOCK_START}\none\n${BLOCK_END}`)
    expect(readFileSync(path, 'utf8')).toBe(`# Agenda\n\n${BLOCK_START}\none\n${BLOCK_END}\n`)
    writeFileSync(path, `# My agenda\n\nMy own plan.\n\n${BLOCK_START}\none\n${BLOCK_END}\n\nFooter I wrote.\n`)
    await writeAgendaNote(join(dir, 'vault'), `${BLOCK_START}\ntwo\n${BLOCK_END}`)
    expect(readFileSync(path, 'utf8')).toBe(`# My agenda\n\nMy own plan.\n\n${BLOCK_START}\ntwo\n${BLOCK_END}\n\nFooter I wrote.\n`)
    writeFileSync(path, 'No block here.\n')
    await writeAgendaNote(join(dir, 'vault'), `${BLOCK_START}\nthree\n${BLOCK_END}`)
    expect(readFileSync(path, 'utf8')).toBe(`No block here.\n\n${BLOCK_START}\nthree\n${BLOCK_END}\n`)
  })
})

describe('validateSettings', () => {
  const base = { connectors: [], courses: [], pastDays: 7, horizonDays: 60, syncMinutes: 30 }
  it('normalizes connectors and rejects invalid values', () => {
    expect(validateSettings({ ...base, notesDir: ' ~/vault ', connectors: [{ id: 'uw', kind: 'canvas', name: ' Canvas ', enabled: true, secret: 'CANVAS_TOKEN', baseUrl: 'https://canvas.uw.edu/courses' }] }))
      .toEqual({ ...base, notesDir: join(process.env.HOME ?? '', 'vault'), connectors: [{ id: 'uw', kind: 'canvas', name: 'Canvas', enabled: true, secret: 'CANVAS_TOKEN', baseUrl: 'https://canvas.uw.edu' }] })
    const ics = { id: 'g', kind: 'ics' as const, name: 'G', enabled: true, secret: 'GCAL_ICS' }
    expect(() => validateSettings({ ...base, pastDays: -1 })).toThrow('pastDays must be an integer from 0 to 365')
    expect(() => validateSettings({ ...base, connectors: [{ ...ics, id: '../x' }] })).toThrow('may use only letters')
    expect(() => validateSettings({ ...base, connectors: [ics, ics] })).toThrow('duplicate connector id "g"')
    expect(() => validateSettings({ ...base, connectors: [{ ...ics, name: ' ' }] })).toThrow('needs a name')
    expect(() => validateSettings({ ...base, connectors: [{ ...ics, secret: 'lower' }] })).toThrow('upper-case environment-variable name')
    expect(() => validateSettings({ ...base, connectors: [{ ...ics, kind: 'canvas', baseUrl: 'http://canvas.uw.edu' }] })).toThrow('needs an https Canvas base URL')
    expect(() => validateSettings({ ...base, connectors: [{ ...ics, kind: 'canvas' }] })).toThrow('needs an https Canvas base URL')
    expect(() => validateSettings({ ...base, connectors: [{ ...ics, kind: 'outlook' as never }] })).toThrow('unknown kind "outlook"')
  })
})

describe('Connectors service', () => {
  function bench() {
    const home = mkdtempSync(join(tmpdir(), 'dsh-connectors-'))
    onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
    const secrets = new Map<string, string>()
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    ctx.provide('credentials', {
      resolve: async (ref: string) => secrets.has(ref) ? { value: secrets.get(ref), source: 'file' } : undefined,
      describe: async (ref: string) => ({ configured: secrets.has(ref), writable: true }),
      set: async (ref: string, value: string) => { secrets.set(ref, value) },
    } as never)
    return { home, secrets, service: new Connectors(ctx, { home, timeZone: 'America/Los_Angeles' }), signal: new AbortController().signal }
  }

  it('stores settings and secrets, syncs every connector, writes the note, and serves the agenda', async () => {
    const subject = bench()
    const now = Date.now()
    const due = new Date(now + 2 * 86_400_000).toISOString()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('https://calendar.example/')) {
        const start = new Date(now + 86_400_000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
        return new Response(`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e1\r\nSUMMARY:Seminar\r\nDTSTART:${start}\r\nEND:VEVENT\r\nEND:VCALENDAR`, { status: 200 })
      }
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-1')
      return new Response(JSON.stringify([{ plannable_id: 4, plannable_type: 'assignment', plannable_date: due, context_name: 'STAT 534', plannable: { title: 'HW4' } }]), { status: 200 })
    }))
    await subject.service.setSettings({
      syncMinutes: 0,
      notesDir: join(subject.home, 'vault'),
      connectors: [
        { id: 'google', kind: 'ics', name: 'Google', enabled: true, secret: 'GOOGLE_ICS' },
        { id: 'canvas', kind: 'canvas', name: 'Canvas', enabled: true, secret: 'CANVAS_TOKEN', baseUrl: 'https://canvas.uw.edu' },
        { id: 'off', kind: 'ics', name: 'Off', enabled: false, secret: 'OFF_ICS' },
      ],
    })
    await expect(subject.service.setSecret({ connector: 'nope', value: 'x' })).rejects.toThrow('unknown connector "nope"')
    await expect(subject.service.setSecret({ connector: 'google', value: ' ' })).rejects.toThrow('must not be empty')
    await subject.service.setSecret({ connector: 'google', value: ' webcal://calendar.example/private.ics ' })
    await subject.service.setSecret({ connector: 'canvas', value: 'token-1' })
    expect(subject.secrets.get('GOOGLE_ICS')).toBe('webcal://calendar.example/private.ics')

    const status = await subject.service.sync({}, subject.signal)
    expect(status.connectors.map(entry => [entry.id, entry.items, entry.error, entry.configured])).toEqual([['google', 1, undefined, true], ['canvas', 1, undefined, true], ['off', 0, undefined, false]])
    const agenda = await subject.service.agenda({})
    expect(agenda.items.map(item => item.title)).toEqual(['Seminar', 'HW4'])
    expect((await subject.service.agenda({ kinds: ['assignment'] })).items.map(item => item.title)).toEqual(['HW4'])
    await expect(subject.service.agenda({ from: 'nope' })).rejects.toThrow('from and to must be ISO 8601 times')
    expect(readFileSync(join(subject.home, 'vault', 'Agenda.md'), 'utf8')).toContain('**HW4** — STAT 534')
    expect(readFileSync(join(subject.home, 'connectors', 'config.json'), 'utf8')).not.toContain('token-1')
  })

  it('keeps a failing connector\'s previous items and reports why it failed', async () => {
    const subject = bench()
    let fail = false
    vi.stubGlobal('fetch', vi.fn(async () => fail
      ? new Response('nope', { status: 401 })
      : new Response(JSON.stringify([{ plannable_id: 1, plannable_type: 'quiz', plannable_date: new Date(Date.now() + 86_400_000).toISOString(), plannable: { title: 'Quiz' } }]), { status: 200 })))
    await subject.service.setSettings({ syncMinutes: 0, connectors: [{ id: 'canvas', kind: 'canvas', name: 'Canvas', enabled: true, secret: 'CANVAS_TOKEN', baseUrl: 'https://canvas.uw.edu' }] })
    expect((await subject.service.sync({}, subject.signal)).connectors[0]!.error).toBe('CANVAS_TOKEN is not set; add the secret in the connector settings')
    subject.secrets.set('CANVAS_TOKEN', 'token')
    expect((await subject.service.sync({}, subject.signal)).connectors[0]!.items).toBe(1)
    fail = true
    const status = await subject.service.sync({}, subject.signal)
    expect(status.connectors[0]).toMatchObject({ items: 1, error: 'Canvas rejected the access token (HTTP 401)' })
    expect((await subject.service.agenda({})).items.map(item => item.title)).toEqual(['Quiz'])
  })

  it('shares one sync between concurrent calls and falls back to defaults for a corrupt settings file', async () => {
    const subject = bench()
    writeFileSync(join(subject.home, 'x'), '')
    expect(await subject.service.getSettings()).toEqual({ connectors: [], courses: [], pastDays: 7, horizonDays: 60, syncMinutes: 30 })
    const [first, second] = await Promise.all([subject.service.sync({}, subject.signal), subject.service.sync({}, subject.signal)])
    expect(first).toBe(second)
    await subject.service.setSettings({ notesDir: '/tmp/x' })
    expect((await subject.service.setSettings({ notesDir: null })).notesDir).toBeUndefined()
  })
})
