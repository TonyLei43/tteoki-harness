/** The generated Obsidian agenda note: overdue work and the coming days, inside a marked block. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgendaItem } from './types.ts'

/** Block markers; content between them is replaced on every sync, content outside is kept. */
export const BLOCK_START = '<!-- tteoki:agenda:start -->'
export const BLOCK_END = '<!-- tteoki:agenda:end -->'

/** Days of upcoming items the note lists. */
const NOTE_DAYS = 14

/** Statuses that mean the assignment needs no more work. */
const DONE = new Set(['submitted', 'graded', 'excused'])

/**
 * Format a date and time for the note in one time zone.
 * @param iso - ISO instant.
 * @param timeZone - IANA time zone.
 * @param options - `Intl.DateTimeFormat` fields.
 * @returns the formatted text.
 */
function format(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(new Date(iso))
}

/**
 * Render one item as a Markdown list line.
 * @param item - the item.
 * @param timeZone - display time zone.
 * @param withDate - whether to include the date (overdue list) or only the time (day sections).
 * @returns the list line.
 */
function line(item: AgendaItem, timeZone: string, withDate: boolean): string {
  const zone = item.allDay ? 'UTC' : timeZone
  const when = item.allDay
    ? (withDate ? format(item.start, zone, { month: 'short', day: 'numeric' }) : 'All day')
    : format(item.start, zone, withDate ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const end = item.end !== undefined && !item.allDay ? `–${format(item.end, zone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : ''
  const title = item.url === undefined ? item.title : `[${item.title.replace(/[[\]]/g, '')}](${item.url})`
  const details = [item.course, item.location, item.points === undefined ? undefined : `${item.points} pts`, item.status !== undefined && item.status !== 'upcoming' ? item.status : undefined]
    .filter((part): part is string => part !== undefined && part !== '')
  const suffix = details.length === 0 ? '' : ` — ${details.join(' · ')}`
  if (item.kind === 'assignment') return `- [${item.status !== undefined && DONE.has(item.status) ? 'x' : ' '}] ${when}${end} **${title}**${suffix}`
  return `- ${when}${end} ${title}${suffix}`
}

/**
 * Render the generated block.
 * @param items - every agenda item.
 * @param now - the sync time.
 * @param timeZone - IANA time zone for headings and times.
 * @returns the block, markers included.
 */
export function renderAgenda(items: readonly AgendaItem[], now: Date, timeZone: string): string {
  const dayKey = (iso: string, allDay: boolean): string => format(iso, allDay ? 'UTC' : timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' })
  const today = dayKey(now.toISOString(), false)
  const horizon = now.getTime() + NOTE_DAYS * 86_400_000
  const overdue = items.filter(item => item.kind === 'assignment' && new Date(item.start).getTime() < now.getTime() && !DONE.has(item.status ?? 'upcoming'))
  const upcoming = items.filter(item => dayKey(item.start, item.allDay) >= today && new Date(item.start).getTime() < horizon)
  const out = [BLOCK_START, `_Synced ${format(now.toISOString(), timeZone, { dateStyle: 'medium', timeStyle: 'short' })} by Tteoki. This block is replaced on every sync; write notes outside it._`, '']
  if (overdue.length > 0) out.push('## Overdue', '', ...overdue.map(item => line(item, timeZone, true)), '')
  out.push(`## Next ${NOTE_DAYS} days`, '')
  if (upcoming.length === 0) out.push('Nothing scheduled.', '')
  let current = ''
  for (const item of upcoming) {
    const key = dayKey(item.start, item.allDay)
    if (key !== current) {
      current = key
      out.push(`### ${format(item.start, item.allDay ? 'UTC' : timeZone, { weekday: 'short', month: 'short', day: 'numeric' })}`, '')
    }
    out.push(line(item, timeZone, false))
    const next = upcoming[upcoming.indexOf(item) + 1]
    if (next === undefined || dayKey(next.start, next.allDay) !== key) out.push('')
  }
  out.push(BLOCK_END)
  return out.join('\n')
}

/**
 * Write the agenda block into `<dir>/Agenda.md`, replacing an existing block
 * and keeping everything outside it; a file without a block gets one appended.
 * @param dir - the notes folder, created when absent.
 * @param block - the rendered block.
 * @returns the note path.
 */
export async function writeAgendaNote(dir: string, block: string): Promise<string> {
  const path = join(dir, 'Agenda.md')
  let current: string | undefined
  try {
    current = await readFile(path, 'utf8')
  } catch {
    // No note yet: create one around the block.
    current = undefined
  }
  let next: string
  if (current === undefined) next = `# Agenda\n\n${block}\n`
  else {
    const start = current.indexOf(BLOCK_START)
    const end = current.indexOf(BLOCK_END)
    next = start !== -1 && end > start
      ? `${current.slice(0, start)}${block}${current.slice(end + BLOCK_END.length)}`
      : `${current.replace(/\n*$/, '')}\n\n${block}\n`
  }
  if (next === current) return path
  await mkdir(dir, { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, next, 'utf8')
  await rename(temporary, path)
  return path
}
