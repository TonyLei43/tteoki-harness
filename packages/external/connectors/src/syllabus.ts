/**
 * Syllabus deadlines: find syllabus files in each linked course's folders,
 * have the local chat model list their dated deadlines, and turn them into
 * agenda items. Results are cached per file fingerprint, so the model runs
 * only when a syllabus changes.
 */

import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { courseLabel } from './courses.ts'
import type { AgendaItem, CourseConfig } from './types.ts'

/** File names that are syllabi or course schedules. */
const SYLLABUS_NAME = /syllab|course[ _-]?(info|outline|schedule)|^schedule/i

/** Suffixes the memory extractors read. */
const READABLE = /\.(pdf|md|markdown|txt|tex)$/i

/** Folder depth scanned below each course folder. */
const MAX_DEPTH = 3

/** Characters of syllabus text sent to the model. */
const MAX_TEXT = 40_000

/** One deadline as the model reports it. */
export interface SyllabusDeadline {
  readonly title: string
  /** `YYYY-MM-DD`. */
  readonly date: string
  /** `HH:MM` in local time, or null. */
  readonly time: string | null
  readonly type: string
}

/** Cached extraction for one file. */
export interface SyllabusCacheEntry {
  readonly fingerprint: string
  readonly deadlines: readonly SyllabusDeadline[]
}

/** The services a syllabus scan needs. */
export interface SyllabusDeps {
  /** Extract a document's text. */
  readonly extractText: (path: string, signal: AbortSignal) => Promise<string>
  /** Ask the local chat model. */
  readonly complete: (system: string, user: string, signal: AbortSignal) => Promise<string>
}

/**
 * Find syllabus files under a course's folders.
 * @param folders - the course's folders.
 * @returns absolute paths of syllabus-like, readable files.
 */
export async function findSyllabi(folders: readonly string[]): Promise<string[]> {
  const found: string[] = []
  const walk = async (directory: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      // A missing course folder contributes no syllabus.
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory() && depth < MAX_DEPTH) await walk(path, depth + 1)
      else if (entry.isFile() && SYLLABUS_NAME.test(entry.name) && READABLE.test(entry.name)) found.push(path)
    }
  }
  for (const folder of folders) await walk(folder, 0)
  return [...new Set(found)].sort()
}

/**
 * Parse the model's reply into deadlines, dropping malformed entries.
 * @param reply - model text, bare or fenced JSON.
 * @returns the deadlines.
 */
export function parseDeadlines(reply: string): SyllabusDeadline[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply)
  let parsed: unknown
  try {
    parsed = JSON.parse((fenced?.[1] ?? reply).trim())
  } catch {
    // A reply that is not JSON yields no deadlines; the next syllabus change retries.
    return []
  }
  const list = typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { deadlines?: unknown }).deadlines) ? (parsed as { deadlines: unknown[] }).deadlines : []
  const out: SyllabusDeadline[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const date = typeof record.date === 'string' ? record.date.trim() : ''
    const time = typeof record.time === 'string' && /^\d{1,2}:\d{2}$/.test(record.time.trim()) ? record.time.trim().padStart(5, '0') : null
    if (title === '' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00`).getTime())) continue
    out.push({ title, date, time, type: typeof record.type === 'string' ? record.type : 'other' })
  }
  return out
}

/**
 * Normalize a title for duplicate detection: lower case, `homework` as `hw`, letters and digits only.
 * @param title - an item title.
 * @returns the key.
 */
function titleKey(title: string): string {
  return title.toLowerCase().replace(/homework|assignment|problem set|pset/g, 'hw').replace(/[^a-z0-9]/g, '')
}

/**
 * Whether a syllabus deadline repeats an item the course's other sources already report on the same day.
 * @param candidate - the syllabus item.
 * @param others - items from other sources.
 * @returns true for a duplicate.
 */
export function isDuplicate(candidate: AgendaItem, others: readonly AgendaItem[]): boolean {
  const day = candidate.start.slice(0, 10)
  const key = titleKey(candidate.title)
  return others.some((item) => {
    if (item.courseCode !== candidate.courseCode) return false
    if (Math.abs(new Date(item.start).getTime() - new Date(candidate.start).getTime()) > 36 * 3_600_000 && item.start.slice(0, 10) !== day) return false
    const other = titleKey(item.title)
    return other !== '' && key !== '' && (other.includes(key) || key.includes(other))
  })
}

/**
 * The system prompt for one course.
 * @param termStart - earliest date the course is known to run.
 * @param termEnd - latest date the course is known to run.
 * @returns the prompt.
 */
export function syllabusPrompt(termStart: string, termEnd: string): string {
  return 'You extract dated deadlines from a course syllabus. Reply with JSON only, no prose: '
    + '{"deadlines":[{"title":string,"date":"YYYY-MM-DD","time":"HH:MM" or null,"type":"homework"|"quiz"|"exam"|"project"|"presentation"|"other"}]}. '
    + 'Include homework, quizzes, exams, projects, and presentations that have a specific calendar date; skip weekly readings and lecture topics. '
    + `The course runs from ${termStart} to ${termEnd}; use that to supply missing years. Never invent dates or items.`
}

/**
 * Scan every linked course's syllabi and return their deadlines as agenda items.
 * @param courses - configured courses.
 * @param others - items from the other connectors, for term dates and duplicate removal.
 * @param cache - previous extractions by path; updated in place for changed files.
 * @param deps - text extraction and the local chat model.
 * @param signal - caller cancellation.
 * @param today - the current day, `YYYY-MM-DD`.
 * @returns syllabus items and per-file errors.
 */
export async function scanSyllabi(
  courses: readonly CourseConfig[],
  others: readonly AgendaItem[],
  cache: Record<string, SyllabusCacheEntry>,
  deps: SyllabusDeps,
  signal: AbortSignal,
  today: string,
): Promise<{ items: AgendaItem[]; errors: string[] }> {
  const items: AgendaItem[] = []
  const errors: string[] = []
  for (const course of courses) {
    if (course.folders.length === 0) continue
    const dates = others.filter(item => item.courseCode === course.code).map(item => item.start.slice(0, 10)).sort()
    const termStart = dates[0] ?? today
    const termEnd = dates[dates.length - 1] ?? today
    for (const path of await findSyllabi(course.folders)) {
      try {
        const info = await stat(path)
        const fingerprint = `${info.size}:${info.mtimeMs}`
        let entry = cache[path]
        if (entry?.fingerprint !== fingerprint) {
          const text = (await deps.extractText(path, signal)).slice(0, MAX_TEXT)
          const reply = await deps.complete(syllabusPrompt(termStart, termEnd), `Course: ${courseLabel(course)}\nToday: ${today}\n\nSyllabus:\n${text}`, signal)
          entry = { fingerprint, deadlines: parseDeadlines(reply) }
          cache[path] = entry
        }
        for (const deadline of entry.deadlines) {
          const start = new Date(`${deadline.date}T${deadline.time ?? '23:59'}:00`).toISOString()
          const item: AgendaItem = {
            id: `syllabus:${course.code}:${createHash('sha256').update(`${deadline.title}|${deadline.date}`).digest('hex').slice(0, 16)}`,
            source: 'syllabus',
            kind: 'assignment',
            title: deadline.title,
            start,
            allDay: false,
            course: courseLabel(course),
            courseCode: course.code,
            description: `From ${path.split('/').pop() ?? path} (${deadline.type})`,
            status: 'upcoming',
          }
          if (!isDuplicate(item, others)) items.push(item)
        }
      } catch (error: unknown) {
        errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  return { items, errors }
}
