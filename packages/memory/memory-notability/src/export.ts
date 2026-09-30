/**
 * Notability → Obsidian export: one Markdown note per Notability note, filed
 * by school, course, and date under a vault folder. Content comes from the
 * note's typed text, Notability's handwriting recognition, and imported PDF
 * text, or from OCR of the rendered pages when the note has none of these.
 * Each exported file records a hash of what Tteoki wrote; a file the user has
 * edited since is never overwritten — the new version is written beside it.
 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extractNote } from './extract-note.ts'
import type { PageOcr } from './extract-note.ts'
import { readNote } from './note.ts'

/** A course code at the start of a note title, such as `STAT 538` or `Math 151B`. */
const COURSE = /^\s*([A-Za-z]{2,6})[\s_]*(\d{2,3}[A-Za-z]?)(?![A-Za-z0-9])[\s_:-]*/

/** Export options. */
export interface ExportOptions {
  /** Notability's iCloud `Documents` folder. */
  readonly notabilityDir: string
  /** Folder receiving `<school>/<course>/<date> <title>.md`, such as the vault's `Academic` folder. */
  readonly targetDir: string
  /** Only notes whose title matches; all when absent. */
  readonly filter?: RegExp
  /** Notes created on or after this date file under `schoolAfter`, earlier ones under `schoolBefore`. */
  readonly schoolCutoff: Date
  /** School folder for notes created on or after the cutoff, such as `UW`. */
  readonly schoolAfter: string
  /** School folder for earlier notes, such as `UCLA`. */
  readonly schoolBefore: string
  /** Page transcription for handwriting-only notes; those notes are skipped when absent. */
  readonly ocr?: PageOcr
  /** Whether OCR also replaces Notability's own handwriting recognition. */
  readonly transcribeAll?: boolean
  /** Pages transcribed at once; defaults to 1. */
  readonly concurrency?: number
}

/** What happened to one note. */
export type ExportOutcome = 'written' | 'unchanged' | 'conflict' | 'skipped' | 'failed'

/** One note's export result. */
export interface ExportEntry {
  readonly title: string
  readonly outcome: ExportOutcome
  /** Vault file written or kept; absent for skipped and failed notes. */
  readonly path?: string
  /** Why a note was skipped or failed. */
  readonly reason?: string
}

/**
 * Split a note title into its course and the rest.
 * @param title - a Notability title such as `STAT 538 Lec 8` or `Stat 513 Lec16`.
 * @returns the course code (upper case, one space) and the remaining title, or undefined.
 */
export function courseOfTitle(title: string): { code: string; rest: string } | undefined {
  const match = COURSE.exec(title)
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined
  const department = match[1].toUpperCase()
  // Words like "Note" or "Lecture" followed by a number are not course codes.
  if (!/^(STAT|BIOST|MATH|CSE|CS|PHYS|ECON|STATS|AMATH|EE|PSYCH|CHEM|BIO|LS|PIC)$/.test(department)) return undefined
  const rest = title.slice(match[0].length).trim()
  return { code: `${department} ${match[2].toUpperCase()}`, rest: rest === '' ? title.trim() : rest }
}

/**
 * Make a string safe as one file name.
 * @param name - raw name.
 * @returns the name without path separators or characters Obsidian rejects.
 */
function fileName(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled'
}

/**
 * Format a date as `YYYY-MM-DD` in local time.
 * @param date - the date.
 * @returns the day.
 */
function day(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Hash exported body text.
 * @param text - the body.
 * @returns a short hex hash.
 */
function bodyHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/**
 * Split a note file into its front matter fields and body.
 * @param text - file content.
 * @returns front matter entries and the body after it.
 */
export function splitFrontMatter(text: string): { fields: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (match === null) return { fields: {}, body: text }
  const fields: Record<string, string> = {}
  for (const line of (match[1] ?? '').split('\n')) {
    const separator = line.indexOf(':')
    if (separator > 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^"(.*)"$/, '$1')
  }
  return { fields, body: text.slice(match[0].length) }
}

/**
 * Write one file atomically.
 * @param path - destination.
 * @param text - content.
 */
async function writeAtomic(path: string, text: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, text, 'utf8')
  await rename(temporary, path)
}

/**
 * Export one Notability note into the vault.
 * @param path - absolute `.nbn` directory.
 * @param options - target folder, school split, filter, and OCR.
 * @param signal - caller cancellation.
 * @param courseOf - the note's course and remaining title; defaults to {@link courseOfTitle}.
 * @returns the note's result, or undefined when the filter excludes it.
 */
export async function exportNote(
  path: string,
  options: Omit<ExportOptions, 'notabilityDir'>,
  signal: AbortSignal,
  courseOf: (title: string) => { code: string; rest: string } | undefined = courseOfTitle,
): Promise<ExportEntry | undefined> {
  let title = path.split('/').pop()?.replace(/\.nbn$/, '') ?? path
  try {
    const note = await readNote(path)
    title = note.title === '' ? title : note.title
    if (options.filter !== undefined && !options.filter.test(title)) return undefined
    const handwritingOnly = note.typed === '' && note.handwriting.length === 0 && note.pdfs.length === 0
    if (handwritingOnly && options.ocr === undefined) return { title, outcome: 'skipped', reason: 'handwriting only; needs OCR' }
    const course = courseOf(title)
    const school = note.created.getTime() >= options.schoolCutoff.getTime() ? options.schoolAfter : options.schoolBefore
    const folder = course === undefined ? join(options.targetDir, 'Unsorted') : join(options.targetDir, school, course.code)
    const target = join(folder, `${fileName(`${day(note.created)} ${course?.rest ?? title}`)}.md`)
    const content = await extractNote(path, signal, options.ocr, options.transcribeAll === true, options.concurrency ?? 1)
    const body = `${content.trim()}\n`
    const hash = bodyHash(body)
    const frontMatter = [
      '---',
      ...course === undefined ? [] : [`course: "${course.code}"`],
      `created: ${day(note.created)}`,
      `modified: ${day(note.modified)}`,
      'source: notability',
      `notability_id: "${note.uuid}"`,
      `notability_title: "${title.replace(/"/g, "'")}"`,
      `tteoki_hash: ${hash}`,
      '---',
      '',
    ].join('\n')
    let existing: string | undefined
    try {
      existing = await readFile(target, 'utf8')
    } catch {
      // First export of this note.
      existing = undefined
    }
    await mkdir(folder, { recursive: true })
    if (existing === undefined) {
      await writeAtomic(target, frontMatter + body)
      return { title, outcome: 'written', path: target }
    }
    const current = splitFrontMatter(existing)
    if (current.fields.tteoki_hash === hash) return { title, outcome: 'unchanged', path: target }
    if (bodyHash(current.body) === current.fields.tteoki_hash) {
      await writeAtomic(target, frontMatter + body)
      return { title, outcome: 'written', path: target }
    }
    // The user edited the exported note: keep their file and put the new export beside it.
    const beside = target.replace(/\.md$/, ' (from Notability).md')
    await writeAtomic(beside, frontMatter + body)
    return { title, outcome: 'conflict', path: beside }
  } catch (error: unknown) {
    return { title, outcome: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Export matching Notability notes into the vault.
 * @param options - folders, filter, school split, and OCR.
 * @param signal - caller cancellation, checked between notes.
 * @param progress - called after each note.
 * @returns one entry per matching note.
 */
export async function exportNotes(options: ExportOptions, signal: AbortSignal, progress: (entry: ExportEntry) => void = () => {}): Promise<ExportEntry[]> {
  const bundles = (await readdir(options.notabilityDir)).filter(name => name.endsWith('.nbn')).sort()
  const results: ExportEntry[] = []
  for (const bundle of bundles) {
    signal.throwIfAborted()
    const entry = await exportNote(join(options.notabilityDir, bundle), options, signal)
    if (entry === undefined) continue
    results.push(entry)
    progress(entry)
  }
  return results
}
