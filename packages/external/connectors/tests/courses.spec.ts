/** Course labels, course detection, syllabus deadlines, and course settings. */

import { Context } from '@deepseek-ai/cordis'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  Connectors, courseLabel, detectCourses, findSyllabi, isDuplicate, labelItems, parseCourse, parseDeadlines, scanSyllabi, syllabusPrompt, titleCase, validateSettings,
} from '../src/index.ts'
import type { AgendaItem, SyllabusCacheEntry } from '../src/index.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('course labels', () => {
  it('parses Canvas course names into a code and a readable title', () => {
    expect(parseCourse('BIOST 583 A Au 26: Advanced Theory Of Statistical Inference I')).toEqual({ code: 'BIOST 583', name: 'Advanced Theory of Statistical Inference I' })
    expect(parseCourse('MATH 491 A Au 26: Introduction To Stochastic Processes I')).toEqual({ code: 'MATH 491', name: 'Introduction to Stochastic Processes I' })
    expect(parseCourse('STAT 536/427 Au 26: Analysis Of Categorical And Count Data')).toEqual({ code: 'STAT 536/427', name: 'Analysis of Categorical and Count Data' })
    expect(parseCourse('STAT 534 Statistical Computing')).toEqual({ code: 'STAT 534', name: 'Statistical Computing' })
    expect(parseCourse('Tony Work Calendar')).toBeUndefined()
    expect(titleCase('INTRO TO R AND SQL')).toBe('Intro to R and SQL')
    expect(titleCase('Topics In GLM Theory')).toBe('Topics in GLM Theory')
    expect(courseLabel({ code: 'STAT 534', name: '' })).toBe('STAT 534')
  })

  it('relabels items with configured names and detects new courses', () => {
    const items: AgendaItem[] = [
      { id: 'a', source: 'canvas', kind: 'assignment', title: 'HW1', start: '2026-10-02T06:59:00.000Z', allDay: false, course: 'STAT 534 A Au 26: Statistical Computing' },
      { id: 'b', source: 'google', kind: 'event', title: 'Work', start: '2026-10-02T16:00:00.000Z', allDay: false, course: 'Tony Work Calendar' },
    ]
    const labeled = labelItems(items, [{ code: 'STAT 534', name: 'Computing', folders: [] }])
    expect(labeled.map(item => [item.course, item.courseCode])).toEqual([['STAT 534: Computing', 'STAT 534'], ['Tony Work Calendar', undefined]])
    expect(labelItems(labeled, []).map(item => item.course)).toEqual(['STAT 534: Computing', 'Tony Work Calendar'])
    expect(detectCourses([], labelItems(items, []))).toEqual([{ code: 'STAT 534', name: 'Statistical Computing', folders: [] }])
    expect(detectCourses([{ code: 'STAT 534', name: 'x', folders: [] }], labeled)).toHaveLength(1)
  })

  it('labels items under a cross-listed alias with the configured course', () => {
    const base = { connectors: [], pastDays: 7, horizonDays: 60, syncMinutes: 30 }
    const items: AgendaItem[] = [
      { id: 'a', source: 'canvas', kind: 'event', title: 'Office hour', start: '2026-10-01T17:00:00Z', allDay: false, course: 'BIOST 583 A Au 26: Advanced Theory of Statistical Inference I' },
      { id: 'b', source: 'canvas', kind: 'assignment', title: 'HW1', start: '2026-10-09T06:59:00Z', allDay: false, courseCode: 'STAT 536/427', course: 'STAT 536/427: Count Data' },
    ]
    const courses = [
      { code: 'STAT 581', name: 'Advanced Theory of Statistical Inference I', aliases: ['BIOST 583'], folders: [] },
      { code: 'STAT 536', name: 'Analysis of Categorical and Count Data', aliases: ['STAT 536/427'], folders: [] },
    ]
    expect(labelItems(items, courses).map(item => [item.courseCode, item.course])).toEqual([
      ['STAT 581', 'STAT 581: Advanced Theory of Statistical Inference I'],
      ['STAT 536', 'STAT 536: Analysis of Categorical and Count Data'],
    ])
    expect(detectCourses(courses, labelItems(items, []))).toHaveLength(2)
    const calendar: AgendaItem[] = [
      { id: 'c', source: 'ics', kind: 'event', title: 'STAT 581 A', start: '2026-09-30T17:00:00Z', allDay: false, course: 'Tony Work Calendar' },
      { id: 'd', source: 'ics', kind: 'event', title: 'STAT 999 Seminar', start: '2026-09-30T17:00:00Z', allDay: false, course: 'Tony Work Calendar' },
    ]
    expect(labelItems(calendar, courses).map(item => [item.courseCode, item.course])).toEqual([
      ['STAT 581', 'STAT 581: Advanced Theory of Statistical Inference I'],
      [undefined, 'Tony Work Calendar'],
    ])
    expect(validateSettings({ ...base, courses: [{ ...courses[0]!, aliases: [' biost 583 ', ''] }] }).courses[0]!.aliases).toEqual(['BIOST 583'])
    expect(() => validateSettings({ ...base, courses: [courses[0]!, { code: 'BIOST 583', name: '', folders: [] }] })).toThrow('duplicate course code "BIOST 583"')
  })

  it('validates course settings', () => {
    const base = { connectors: [], pastDays: 7, horizonDays: 60, syncMinutes: 30 }
    expect(validateSettings({ ...base, courses: [{ code: ' stat  534 ', name: ' Computing ', knowledgeBase: 'academic', folders: ['~/UW/STAT 534', ' '] }] }).courses)
      .toEqual([{ code: 'STAT 534', name: 'Computing', knowledgeBase: 'academic', folders: [join(process.env.HOME ?? '', 'UW/STAT 534')] }])
    expect(() => validateSettings({ ...base, courses: [{ code: 'Stats', name: '', folders: [] }] })).toThrow('must look like STAT 534')
    expect(() => validateSettings({ ...base, courses: [{ code: 'STAT 534', name: '', folders: [] }, { code: 'STAT 534', name: '', folders: [] }] })).toThrow('duplicate course code "STAT 534"')
  })
})

describe('syllabus deadlines', () => {
  it('finds syllabus files and parses model replies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-syllabus-'))
    onTestFinished(() => { rmSync(dir, { recursive: true, force: true }) })
    mkdirSync(join(dir, 'Admin'), { recursive: true })
    writeFileSync(join(dir, 'Admin', 'STAT534_Syllabus.pdf'), 'x')
    writeFileSync(join(dir, 'course-schedule.md'), 'x')
    writeFileSync(join(dir, 'syllabus.docx'), 'x')
    writeFileSync(join(dir, 'hw1.pdf'), 'x')
    expect((await findSyllabi([dir, join(dir, 'missing')])).map(path => path.slice(dir.length))).toEqual(['/Admin/STAT534_Syllabus.pdf', '/course-schedule.md'])

    expect(parseDeadlines('```json\n{"deadlines":[{"title":"HW 1","date":"2026-10-09","time":"9:30","type":"homework"},{"title":"","date":"2026-10-01"},{"title":"x","date":"Oct 3"},"bad"]}\n```'))
      .toEqual([{ title: 'HW 1', date: '2026-10-09', time: '09:30', type: 'homework' }])
    expect(parseDeadlines('not json')).toEqual([])
    expect(parseDeadlines('{"deadlines":{}}')).toEqual([])
    expect(syllabusPrompt('2026-09-24', '2026-12-11')).toContain('The course runs from 2026-09-24 to 2026-12-11')
  })

  it('drops syllabus deadlines Canvas already reports on the same day', () => {
    const canvas: AgendaItem = { id: 'c', source: 'canvas', kind: 'assignment', title: 'Homework 1', start: '2026-10-10T06:59:00.000Z', allDay: false, courseCode: 'STAT 534' }
    const syllabus = (title: string, start: string, courseCode = 'STAT 534'): AgendaItem => ({ id: 's', source: 'syllabus', kind: 'assignment', title, start, allDay: false, courseCode })
    expect(isDuplicate(syllabus('HW 1', '2026-10-09T23:59:00.000Z'), [canvas])).toBe(true)
    expect(isDuplicate(syllabus('Midterm', '2026-10-09T23:59:00.000Z'), [canvas])).toBe(false)
    expect(isDuplicate(syllabus('HW 1', '2026-10-20T23:59:00.000Z'), [canvas])).toBe(false)
    expect(isDuplicate(syllabus('HW 1', '2026-10-09T23:59:00.000Z', 'MATH 491'), [canvas])).toBe(false)
  })

  it('extracts deadlines once per syllabus version and labels them with the course', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-syllabus-'))
    onTestFinished(() => { rmSync(dir, { recursive: true, force: true }) })
    const file = join(dir, 'syllabus.md')
    writeFileSync(file, '# STAT 534\nHW1 due Oct 9. Midterm Oct 21.')
    const complete = vi.fn(async (_system: string, user: string) => {
      expect(user).toContain('Course: STAT 534: Statistical Computing')
      return JSON.stringify({ deadlines: [{ title: 'HW 1', date: '2026-10-09', time: null, type: 'homework' }, { title: 'Midterm', date: '2026-10-21', time: '10:30', type: 'exam' }] })
    })
    const extractText = vi.fn(async () => 'HW1 due Oct 9. Midterm Oct 21.')
    const courses = [{ code: 'STAT 534', name: 'Statistical Computing', knowledgeBase: 'academic', folders: [dir] }, { code: 'MATH 491', name: '', folders: [] }]
    const canvas: AgendaItem[] = [{ id: 'c', source: 'canvas', kind: 'assignment', title: 'Homework 1', start: '2026-10-10T06:59:00.000Z', allDay: false, courseCode: 'STAT 534' }]
    const cache: Record<string, SyllabusCacheEntry> = {}
    const first = await scanSyllabi(courses, canvas, cache, { extractText, complete }, new AbortController().signal, '2026-09-29')
    expect(first.errors).toEqual([])
    expect(first.items.map(item => [item.title, item.course, item.source, item.status])).toEqual([['Midterm', 'STAT 534: Statistical Computing', 'syllabus', 'upcoming']])
    expect(new Date(first.items[0]!.start).getHours()).toBe(10)
    expect(complete.mock.calls[0]![0]).toContain('from 2026-10-10 to 2026-10-10')
    await scanSyllabi(courses, canvas, cache, { extractText, complete }, new AbortController().signal, '2026-09-29')
    expect(complete).toHaveBeenCalledOnce()
    utimesSync(file, new Date(), new Date(Date.now() + 5000))
    const failing = await scanSyllabi(courses, canvas, cache, { extractText: async () => { throw new Error('no extractor reads it') }, complete }, new AbortController().signal, '2026-09-29')
    expect(failing.errors).toEqual([`${file}: no extractor reads it`])
  })

  it('runs during sync through the memory service and reports a syllabus status', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-connectors-syllabus-'))
    onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
    const course = join(home, 'STAT 534')
    mkdirSync(course)
    writeFileSync(join(course, 'syllabus.md'), 'Final exam.')
    const due = new Date(Date.now() + 5 * 86_400_000)
    const date = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    ctx.provide('credentials', { resolve: async () => undefined, describe: async () => ({ configured: false, writable: true }), set: async () => {} } as never)
    ctx.provide('memory', {
      extractText: async () => 'Final exam.',
      complete: async () => JSON.stringify({ deadlines: [{ title: 'Final exam', date, time: '08:30', type: 'exam' }] }),
    } as never)
    const service = new Connectors(ctx, { home, timeZone: 'UTC' })
    await service.setSettings({ syncMinutes: 0, courses: [{ code: 'STAT 534', name: 'Statistical Computing', folders: [course] }] })
    const status = await service.sync({}, new AbortController().signal)
    expect(status.connectors).toEqual([expect.objectContaining({ id: 'syllabus', items: 1, configured: true })])
    expect((await service.agenda({ kinds: ['assignment'] })).items.map(item => [item.title, item.course])).toEqual([['Final exam', 'STAT 534: Statistical Computing']])
    await service.setSettings({ courses: [{ code: 'STAT 534', name: 'Computing', folders: [course] }] })
    expect((await service.agenda({})).items[0]!.course).toBe('STAT 534: Computing')
  })
})
