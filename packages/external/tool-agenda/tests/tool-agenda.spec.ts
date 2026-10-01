/** The agenda tool: formatting, overdue detection, windows, and registration. */

import { Context } from '@deepseek-ai/cordis'
import type { AgendaItem, AgendaRequest } from '@deepseek-ai/dsh-connectors'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { apply, describeItem, matchesCourse } from '../src/index.ts'

interface RegisteredTool {
  name: string
  description: string
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<{ overdue: string[]; upcoming: string[]; syncedAt?: string }>
  output: { render: (args: unknown, value: never) => { text: string }[] }
  presentCall: (args: Record<string, unknown>) => unknown
}

const NOW = Date.now()
const iso = (days: number) => new Date(NOW + days * 86_400_000).toISOString()

describe('describeItem', () => {
  it('describes events and deadlines with their details', () => {
    expect(describeItem({ id: 'a', source: 'c', kind: 'assignment', title: 'HW4', start: '2026-10-02T06:59:00.000Z', allDay: false, course: 'STAT 534', points: 10, status: 'upcoming', url: 'https://canvas.uw.edu/a/4' }, 'America/Los_Angeles'))
      .toBe('- Due Thu, Oct 1, 11:59 PM: HW4 (STAT 534; 10 pts; status: upcoming; https://canvas.uw.edu/a/4)')
    expect(describeItem({ id: 'h', source: 'g', kind: 'event', title: 'Holiday', start: '2026-10-12T00:00:00.000Z', allDay: true }, 'Asia/Tokyo'))
      .toBe('- Event Mon, Oct 12 (all day): Holiday')
  })
})

describe('agenda tool', () => {
  function mount(items: AgendaItem[], syncedAt?: number) {
    const tools: RegisteredTool[] = []
    const agenda = vi.fn(async (request: AgendaRequest) => ({
      items: items.filter(item => (request.kinds === undefined || request.kinds.includes(item.kind))
        && item.start >= (request.from ?? '') && (request.to === undefined || item.start < request.to))
        .sort((left, right) => left.start.localeCompare(right.start)),
    }))
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    ctx.provide('tools', { register: (tool: RegisteredTool) => { tools.push(tool); return () => {} } } as never)
    ctx.provide('connectors', { agenda, status: async () => ({ connectors: [], ...syncedAt === undefined ? {} : { syncedAt } }) } as never)
    apply(ctx)
    return { tool: tools[0]!, agenda }
  }

  it('lists overdue work and the coming days', async () => {
    const { tool, agenda } = mount([
      { id: 'm', source: 'c', kind: 'assignment', title: 'HW3', start: iso(-2), allDay: false, status: 'missing' },
      { id: 's', source: 'c', kind: 'assignment', title: 'Quiz', start: iso(-1), allDay: false, status: 'submitted' },
      { id: 'u', source: 'c', kind: 'assignment', title: 'HW4', start: iso(2), allDay: false, status: 'upcoming' },
      { id: 'e', source: 'g', kind: 'event', title: 'Lecture', start: iso(1), allDay: false },
      { id: 'far', source: 'g', kind: 'event', title: 'Far', start: iso(20), allDay: false },
    ], NOW)
    expect(tool.name).toBe('agenda')
    const value = await tool.execute({}, {})
    expect(value.overdue.map(line => line.includes('HW3'))).toEqual([true])
    expect(value.upcoming.map(line => /Lecture|HW4/.exec(line)?.[0])).toEqual(['Lecture', 'HW4'])
    expect(value.syncedAt).toBe(new Date(NOW).toISOString())
    expect(tool.output.render({}, value as never)[0]!.text).toMatch(/^Last synced .*\n\nOverdue:\n- Due .*HW3.*\n\nUpcoming:\n- Event .*Lecture/)

    await tool.execute({ days: 500, kind: 'event' }, {})
    const request = agenda.mock.calls.at(-1)![0]
    expect(Math.round((new Date(request.to!).getTime() - new Date(request.from!).getTime()) / 86_400_000)).toBe(60)
    expect(request.kinds).toEqual(['event'])
    expect(tool.presentCall({ days: 3 })).toMatchObject({ title: 'Check agenda', rawInput: '3 days' })
  })

  it('tells the model when nothing has been synced', async () => {
    const { tool } = mount([])
    const value = await tool.execute({ days: 0 }, {})
    expect(tool.output.render({}, value as never)[0]!.text).toBe('The agenda has never been synced; the user can connect calendars and Canvas in the Agenda panel.\n\nNothing scheduled in this window.')
  })
})

interface CourseTool {
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<Record<string, unknown>>
  output: { render: (args: unknown, value: never) => { text: string }[] }
  presentCall: (args: Record<string, unknown>) => unknown
}

describe('course tool', () => {
  function mountCourse(withMemory: boolean) {
    const tools: (RegisteredTool | CourseTool & { name: string })[] = []
    const search = vi.fn(async () => ({ hits: [{ source: '/uw/STAT 536/notes.pdf', collection: 'academic', heading: 'Page 2', text: 'Poisson regression', score: 0.8 }], entities: [] }))
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    ctx.provide('tools', { register: (tool: RegisteredTool) => { tools.push(tool); return () => {} } } as never)
    ctx.provide('connectors', {
      getSettings: async () => ({ courses: [{ code: 'STAT 536/427', name: 'Analysis of Categorical and Count Data', knowledgeBase: 'academic', folders: ['/uw/STAT 536'] }, { code: 'MATH 491', name: '', folders: [] }] }),
      agenda: async () => ({ items: [
        { id: 'h', source: 'canvas', kind: 'assignment', title: 'HW1', start: iso(3), allDay: false, courseCode: 'STAT 536/427', course: 'STAT 536/427: Analysis of Categorical and Count Data' },
        { id: 'o', source: 'canvas', kind: 'assignment', title: 'Other', start: iso(3), allDay: false, courseCode: 'MATH 491' },
      ] }),
      status: async () => ({ connectors: [] }),
    } as never)
    if (withMemory) ctx.provide('memory', { search } as never)
    apply(ctx)
    return { tool: tools.find(tool => tool.name === 'course') as CourseTool | undefined as CourseTool, search }
  }

  it('matches exact and cross-listed codes', () => {
    expect(matchesCourse('STAT 536/427', 'STAT 427')).toBe(true)
    expect(matchesCourse('STAT 536/427', 'STAT 536')).toBe(true)
    expect(matchesCourse('STAT 536/427', 'MATH 427')).toBe(false)
    expect(matchesCourse('STAT 534', 'STAT 534')).toBe(true)
    expect(matchesCourse('STAT 534', 'STAT')).toBe(false)
  })

  it('returns the class label, its deadlines, and passages from its own folders', async () => {
    const { tool, search } = mountCourse(true)
    const value = await tool.execute({ code: ' stat 427 ', question: 'What is the deviance?' }, { signal: new AbortController().signal })
    expect(value).toMatchObject({ course: 'STAT 536/427: Analysis of Categorical and Count Data', knowledgeBase: 'academic' })
    expect((value.deadlines as string[]).map(line => line.includes('HW1'))).toEqual([true])
    expect(search).toHaveBeenCalledWith({ query: 'What is the deviance?', topK: 6, collections: ['academic'], folders: ['/uw/STAT 536'] }, expect.any(AbortSignal))
    expect(tool.output.render({}, value as never)[0]!.text).toContain('From the class material:\n[0.800] /uw/STAT 536/notes.pdf — Page 2\nPoisson regression')
  })

  it('explains unknown and unlinked classes', async () => {
    const { tool } = mountCourse(false)
    await expect(tool.execute({ code: 'CSE 542' }, { signal: new AbortController().signal })).rejects.toThrow('unknown course "CSE 542"; known courses: STAT 536/427, MATH 491')
    const unlinked = await tool.execute({ code: 'MATH 491', question: 'martingales' }, { signal: new AbortController().signal })
    expect(unlinked).toMatchObject({ course: 'MATH 491', note: 'MATH 491 is not linked to a knowledge base yet; link it in the Agenda panel\'s Courses section.' })
    expect(tool.output.render({}, unlinked as never)[0]!.text).toContain('Deadlines:\n- Due')
    expect(tool.presentCall({ code: 'MATH 491' })).toMatchObject({ title: 'Look up class' })
  })
})
