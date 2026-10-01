/**
 * Model-facing agenda tools over the connectors service: `agenda` lists the
 * user's upcoming events and deadlines from their calendars, Canvas, and
 * syllabi; `course` answers about one class — its deadlines and, when the
 * class is linked to a knowledge base, passages from that class's folders.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgendaItem } from '@deepseek-ai/dsh-connectors'
// Type-only: the optional memory service (ctx.memory) course questions search.
import type {} from '@deepseek-ai/dsh-memory'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-agenda'

export const inject = ['tools', 'connectors']

/** Longest window the model may request, in days. */
const MAX_DAYS = 60

/**
 * Render one item as a line for the model.
 * @param item - the agenda item.
 * @param timeZone - display time zone.
 * @returns the line.
 */
export function describeItem(item: AgendaItem, timeZone: string): string {
  const format = new Intl.DateTimeFormat('en-US', item.allDay
    ? { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }
    : { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const when = `${format.format(new Date(item.start))}${item.allDay ? ' (all day)' : ''}`
  const details = [
    item.course,
    item.location,
    item.points === undefined ? undefined : `${item.points} pts`,
    item.status === undefined ? undefined : `status: ${item.status}`,
    item.url,
  ].filter((part): part is string => part !== undefined)
  return `- ${item.kind === 'assignment' ? 'Due' : 'Event'} ${when}: ${item.title}${details.length === 0 ? '' : ` (${details.join('; ')})`}`
}

/**
 * Whether a typed course code names a configured course, including any number of a cross-listed code.
 * @param configured - a configured code such as `STAT 536/427`.
 * @param typed - the requested code, upper case with single spaces.
 * @returns true when the department matches and the number is one of the configured numbers.
 */
export function matchesCourse(configured: string, typed: string): boolean {
  if (configured === typed) return true
  const [department, numbers] = configured.split(' ')
  const [typedDepartment, typedNumber] = typed.split(' ')
  return department === typedDepartment && typedNumber !== undefined && (numbers ?? '').split('/').includes(typedNumber)
}

/**
 * Register the agenda tools.
 * @param ctx - preset context with `tools` and `connectors` injected.
 */
export function apply(ctx: Context): void {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'agenda',
    description: `Read the user's calendar events and assignment deadlines (from their connected calendars and Canvas) for the coming days, plus overdue assignments. Use it before planning study time, answering "what's due", or scheduling anything. Times are in the user's time zone, ${timeZone}.`,
    parameters: {
      days: { type: 'integer', description: `Days ahead to include, 1 to ${MAX_DAYS}; defaults to 7.` },
      kind: { type: 'string', enum: ['event', 'assignment'], description: 'Only events or only assignments; omit for both.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          overdue: { type: 'array', required: true, items: { type: 'string' } },
          upcoming: { type: 'array', required: true, items: { type: 'string' } },
          syncedAt: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          value.syncedAt === undefined ? 'The agenda has never been synced; the user can connect calendars and Canvas in the Agenda panel.' : `Last synced ${value.syncedAt}.`,
          value.overdue.length === 0 ? '' : `Overdue:\n${value.overdue.join('\n')}`,
          value.upcoming.length === 0 ? 'Nothing scheduled in this window.' : `Upcoming:\n${value.upcoming.join('\n')}`,
        ].filter(part => part !== '').join('\n\n'),
      }],
    },
    execute: async (args) => {
      const days = Math.min(Math.max(args.days ?? 7, 1), MAX_DAYS)
      const now = Date.now()
      const kinds = args.kind === undefined ? undefined : [args.kind]
      const upcoming = await ctx.connectors.agenda({ from: new Date(now).toISOString(), to: new Date(now + days * 86_400_000).toISOString(), ...kinds === undefined ? {} : { kinds } })
      const recent = args.kind === 'event' ? { items: [] } : await ctx.connectors.agenda({ from: new Date(now - 30 * 86_400_000).toISOString(), to: new Date(now).toISOString(), kinds: ['assignment'] })
      const overdue = recent.items.filter(item => item.status === 'missing' || item.status === 'upcoming' || item.status === 'late')
        .filter(item => new Date(item.start).getTime() < now)
      const status = await ctx.connectors.status()
      return {
        overdue: overdue.map(item => describeItem(item, timeZone)),
        upcoming: upcoming.items.filter(item => new Date(item.end ?? item.start).getTime() >= now).map(item => describeItem(item, timeZone)),
        ...status.syncedAt === undefined ? {} : { syncedAt: new Date(status.syncedAt).toISOString() },
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Check agenda', kind: 'read', rawInput: `${args.days ?? 7} days` }),
  })), 'tool-agenda: agenda')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'course',
    description: 'Look up one of the user\'s classes by course code (such as "STAT 534"): its full name, its deadlines in the next three weeks, and — when a question is given and the class is linked to a knowledge base — the most relevant passages from that class\'s own notes and files. Use it for any question about a specific class.',
    parameters: {
      code: { type: 'string', required: true, description: 'Course code, such as "STAT 534" or "BIOST 583".' },
      question: { type: 'string', description: 'What to look up in the class\'s material; omit for deadlines only.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          course: { type: 'string', required: true },
          knowledgeBase: { type: 'string' },
          deadlines: { type: 'array', required: true, items: { type: 'string' } },
          passages: { type: 'array', required: true, items: { type: 'string' } },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `${value.course}${value.knowledgeBase === undefined ? '' : ` (knowledge base: ${value.knowledgeBase})`}`,
          value.deadlines.length === 0 ? 'No deadlines in the next three weeks.' : `Deadlines:\n${value.deadlines.join('\n')}`,
          value.passages.length === 0 ? '' : `From the class material:\n${value.passages.join('\n\n')}`,
          value.note ?? '',
        ].filter(part => part !== '').join('\n\n'),
      }],
    },
    execute: async (args, exec) => {
      const code = args.code.trim().toUpperCase().replace(/\s+/g, ' ')
      const settings = await ctx.connectors.getSettings()
      const course = settings.courses.find(entry => [entry.code, ...entry.aliases ?? []].some(known => matchesCourse(known, code)))
      if (course === undefined) {
        const known = settings.courses.map(entry => entry.code).join(', ')
        throw new Error(`unknown course "${args.code}"; known courses: ${known === '' ? 'none yet — sync Canvas first' : known}`)
      }
      const now = Date.now()
      const upcoming = await ctx.connectors.agenda({ from: new Date(now).toISOString(), to: new Date(now + 21 * 86_400_000).toISOString(), kinds: ['assignment'] })
      const deadlines = upcoming.items.filter(item => item.courseCode === course.code).map(item => describeItem(item, timeZone))
      const label = course.name === '' ? course.code : `${course.code}: ${course.name}`
      const question = args.question?.trim() ?? ''
      const memory = ctx.get('memory')
      let passages: string[] = []
      let note: string | undefined
      if (question !== '') {
        if (course.knowledgeBase === undefined || memory === undefined) note = `${label} is not linked to a knowledge base yet; link it in the Agenda panel's Courses section.`
        else {
          const found = await memory.search({ query: question, topK: 6, collections: [course.knowledgeBase], ...course.folders.length === 0 ? {} : { folders: course.folders } }, exec.signal)
          passages = found.hits.map(hit => `[${hit.score.toFixed(3)}] ${hit.source}${hit.heading === undefined ? '' : ` — ${hit.heading}`}\n${hit.text}`)
          if (passages.length === 0) note = 'No passages in the class material matched.'
        }
      }
      return { course: label, ...course.knowledgeBase === undefined ? {} : { knowledgeBase: course.knowledgeBase }, deadlines, passages, ...note === undefined ? {} : { note } }
    },
    presentCall: args => ({ card: 'generic', title: 'Look up class', kind: 'read', rawInput: args.code }),
  })), 'tool-agenda: course')
}
