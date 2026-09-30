/**
 * Lecture pipeline. The service scans Notability's iCloud folder and follows
 * notes of the current quarter's courses. A course comes from the note's
 * title, its Notability subject, or a class on the calendar at creation time.
 * After a note has gone `settleMinutes` without edits, its handwriting is
 * transcribed with the memory service's vision model and exported into the
 * vault. The transcript is rewritten as a LaTeX section, the course's master
 * document `\input`s every lecture and is compiled, and the knowledge base is
 * re-indexed. After `quizAfterMinutes` without edits, a quiz on the lecture's
 * important parts is written to the vault and served through the `lectures`
 * Remote namespace.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
// Type-only: the optional connectors service (ctx.connectors) that supplies course names and the calendar.
import type {} from '@deepseek-ai/dsh-connectors'
import { expandHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { chatComplete } from '@deepseek-ai/dsh-memory'
import type { ChatMessage } from '@deepseek-ai/dsh-memory'
import { courseOfTitle, exportNote, fingerprintNote, readNoteMeta, splitFrontMatter } from '@deepseek-ai/dsh-memory-notability'
import type { NoteMeta } from '@deepseek-ai/dsh-memory-notability'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { cleanLatexReply, DEFAULT_TEMPLATE, fillFields, latexErrors, latexPrompt, lectureFile, preambleOf, renderMaster, slug, updateMaster } from './latex.ts'
import type { MasterFields } from './latex.ts'
import { parseQuiz, QUIZ_PROMPT, quizMarkdown } from './quiz.ts'
import type { CourseNotes, Lecture, LectureRef, LectureSettings, LectureSettingsUpdate, LecturesStatus, Quiz, QuizListRequest } from './types.ts'

export type * from './types.ts'
export { cleanLatexReply, DEFAULT_TEMPLATE, escapeLatex, fillFields, LECTURES_END, LECTURES_MARKER, latexErrors, latexPrompt, lectureFile, preambleOf, renderMaster, slug, updateMaster } from './latex.ts'
export type { MasterFields } from './latex.ts'
export { parseQuiz, QUIZ_PROMPT, quizMarkdown } from './quiz.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    lectures: Lectures
  }
}

/** Policy of a fresh settings file: off until the folders and quarter are set. */
const DEFAULT_SETTINGS: LectureSettings = {
  enabled: false,
  notabilityDir: '',
  vaultDir: '',
  school: 'UW',
  quarter: '',
  since: '',
  courses: [],
  pollSeconds: 60,
  settleMinutes: 3,
  quizAfterMinutes: 15,
  calendarSlackMinutes: 15,
  texDir: '',
  masterName: '{{course}} - {{name}}',
  author: '',
  instructors: {},
  latexmk: 'latexmk',
}

/** Deployment policy for the lectures service. */
export interface Config {
  /** Harness home override; defaults to the resolved DSH home. */
  readonly home?: string
}

/** A followed course. */
interface FollowedCourse {
  /** Configured code, such as `STAT 536/427`. */
  readonly code: string
  /** Each listed code, such as `STAT 536` and `STAT 427`. */
  readonly codes: readonly string[]
  readonly name: string
  /** Whether the course is configured rather than only seen on the calendar; configured courses get master notes up front. */
  readonly configured: boolean
}

/** A lecture with the fingerprints the pipeline compares. */
interface LectureState extends Lecture {
  /** Last observed package fingerprint. */
  readonly fingerprint: string
  /** Fingerprint the last successful transcription read. */
  readonly transcribed?: string
  /** Hash of the transcript the lecture LaTeX was written from. */
  readonly transcriptHash?: string
}

/**
 * Split a course code into its listed codes.
 * @param code - such as `STAT 536/427`.
 * @returns such as `['STAT 536', 'STAT 427']`.
 */
export function courseCodes(code: string): string[] {
  const [department, numbers] = code.split(' ')
  if (department === undefined || numbers === undefined) return [code]
  return numbers.split('/').map(number => `${department} ${number}`)
}

/** A calendar event, as the connectors agenda reports it. */
interface CalendarEvent {
  readonly title: string
  readonly courseCode?: string
  readonly start: string
  readonly end?: string
}

/**
 * The course code of a calendar event: its connector label, else a code at the start of its title (`STAT 581 A`).
 * @param event - the event.
 * @returns the code, or undefined.
 */
function eventCourse(event: CalendarEvent): string | undefined {
  return event.courseCode ?? courseOfTitle(event.title)?.code
}

/**
 * Find the followed course of a note.
 * @param note - title, subject, and creation time.
 * @param courses - followed courses.
 * @param events - calendar events with course codes, for untitled notes.
 * @param slackMs - how far outside an event a note still belongs to it.
 * @returns the course and the lecture title, or undefined.
 */
export function matchCourse(
  note: Pick<NoteMeta, 'title' | 'subject' | 'created'>,
  courses: readonly FollowedCourse[],
  events: readonly CalendarEvent[],
  slackMs: number,
): { course: FollowedCourse; title: string } | undefined {
  const byCode = (code: string | undefined): FollowedCourse | undefined =>
    code === undefined ? undefined : courses.find(course => course.code === code || course.codes.includes(code))
  const fromTitle = courseOfTitle(note.title)
  const titled = byCode(fromTitle?.code)
  if (titled !== undefined && fromTitle !== undefined) return { course: titled, title: fromTitle.rest }
  // Notability names an untitled note by its creation day, which the lecture date already carries.
  const title = /^Note [A-Z][a-z]{2} \d{1,2}, \d{4}(?: \(\d+\))?$/.test(note.title) ? 'Lecture' : note.title
  const subject = byCode(courseOfTitle(note.subject)?.code)
  if (subject !== undefined) return { course: subject, title }
  const created = note.created.getTime()
  for (const event of events) {
    const course = byCode(eventCourse(event))
    const start = new Date(event.start).getTime()
    const end = new Date(event.end ?? event.start).getTime()
    if (course !== undefined && created >= start - slackMs && created <= end + slackMs) return { course, title }
  }
  return undefined
}

/**
 * The newest modification time in a package fingerprint.
 * @param fingerprint - from `fingerprintNote`.
 * @returns epoch milliseconds, or 0.
 */
function latestChange(fingerprint: string): number {
  return Math.max(0, ...fingerprint.split('|').map(part => Number(part.split(':')[2] ?? 0)).filter(Number.isFinite))
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
 * Validate and normalize lecture settings.
 * @param settings - candidate settings.
 * @returns normalized settings.
 * @throws RemoteError naming the first invalid value.
 */
export function validateSettings(settings: LectureSettings): LectureSettings {
  const bad = (message: string): never => { throw new RemoteError('gateway/bad-request', message, {}) }
  for (const [field, min, max] of [['pollSeconds', 10, 3600], ['settleMinutes', 0, 240], ['quizAfterMinutes', 0, 1440], ['calendarSlackMinutes', 0, 120]] as const) {
    const value = settings[field]
    if (!Number.isInteger(value) || value < min || value > max) bad(`${field} must be an integer from ${min} to ${max}`)
  }
  if (settings.since !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(settings.since) || Number.isNaN(new Date(`${settings.since}T00:00:00`).getTime()))) bad('since must be a date like 2026-09-24')
  if (settings.enabled) {
    for (const field of ['notabilityDir', 'vaultDir', 'quarter', 'since'] as const) if (settings[field].trim() === '') bad(`${field} is required to turn the lecture pipeline on`)
  }
  if (settings.masterName.trim() === '' || /[/\\]/.test(settings.masterName)) bad('masterName must be one file name')
  const instructors: Record<string, string> = {}
  for (const [code, name] of Object.entries(settings.instructors)) instructors[code.trim().replace(/\s+/g, ' ').toUpperCase()] = name.trim()
  if (settings.school.trim() === '' || /[/\\]/.test(settings.school)) bad('school must be one folder name')
  const courses = settings.courses.map(code => code.trim().replace(/\s+/g, ' ').toUpperCase())
  for (const code of courses) if (!/^[A-Z][A-Z&]{1,7} \d{3}[A-Z]?(?:\/\d{3}[A-Z]?)*$/.test(code)) bad(`course code "${code}" must look like STAT 534 or STAT 536/427`)
  const writer = settings.writer
  if (writer !== undefined) {
    if (!/^https?:\/\//.test(writer.baseUrl)) bad('writer.baseUrl must be an http(s) URL')
    if (writer.model.trim() === '') bad('writer.model is required')
    if (!/^[A-Z_][A-Z0-9_]*$/.test(writer.apiKeyEnv)) bad('writer.apiKeyEnv must be an environment-variable name such as OPENAI_API_KEY')
  }
  const path = (value: string): string => value.trim() === '' ? '' : expandHomePath(value.trim())
  const { writer: _writer, template: rawTemplate, knowledgeBase: rawKnowledgeBase, ...base } = settings
  const template = rawTemplate === undefined ? '' : path(rawTemplate)
  const knowledgeBase = rawKnowledgeBase?.trim() ?? ''
  return {
    ...base,
    notabilityDir: path(settings.notabilityDir),
    vaultDir: path(settings.vaultDir),
    school: settings.school.trim(),
    quarter: settings.quarter.trim(),
    courses,
    texDir: path(settings.texDir),
    masterName: settings.masterName.trim(),
    author: settings.author.trim(),
    instructors,
    latexmk: settings.latexmk.trim(),
    ...writer === undefined ? {} : { writer: { baseUrl: writer.baseUrl.replace(/\/+$/, ''), model: writer.model.trim(), apiKeyEnv: writer.apiKeyEnv } },
    ...template === '' ? {} : { template },
    ...knowledgeBase === '' ? {} : { knowledgeBase },
  }
}

/**
 * Write a file atomically.
 * @param path - destination.
 * @param text - content.
 */
async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, text, 'utf8')
  await rename(temporary, path)
}

/**
 * Read a JSON file.
 * @param path - source.
 * @returns the parsed value, or undefined when absent or unreadable.
 */
async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    // Absent or corrupt files read as absent; the caller falls back to defaults.
    return undefined
  }
}

/**
 * Run a program and collect its output.
 * @param file - executable.
 * @param args - arguments.
 * @param cwd - working directory.
 * @param signal - caller cancellation.
 * @returns whether it exited with 0, and its combined output.
 */
async function run(file: string, args: readonly string[], cwd: string, signal: AbortSignal): Promise<{ ok: boolean; output: string }> {
  // TeX engines live beside latexmk; a GUI launch may not have them on PATH.
  const env = { ...process.env, PATH: `${dirname(file)}:${process.env.PATH ?? ''}` }
  return await new Promise((resolve) => {
    execFile(file, [...args], { cwd, env, signal, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: error === null, output: `${stdout}\n${stderr}${error === null ? '' : `\n${error.message}`}` })
    })
  })
}

/** Remote service owning the lecture pipeline and its quizzes. */
export class Lectures extends TypertRemoteService {
  static Config: z<Config> = z.object({ home: z.string() })

  static inject = ['typert', 'memory']

  private readonly dir: string
  private settings: LectureSettings | undefined
  private lectures = new Map<string, LectureState>()
  private loaded: Promise<void> | undefined
  /** Packages that are not followed lectures, by the fingerprint they were read at. */
  private readonly ignored = new Map<string, string>()
  private scannedAt: number | undefined
  private scanError: string | undefined
  /** Last master-notes failure per course code. */
  private readonly masterErrors = new Map<string, string>()
  private queue: Promise<unknown> = Promise.resolve()
  private scanning = false
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly abort = new AbortController()

  /** @param ctx - Host context. @param config - home override. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'lectures')
    this.dir = join(config.home ?? resolveDshHome(), 'lectures')
    ctx.effect(() => {
      void this.loadSettings().then(settings => { this.schedule(settings) })
      return () => {
        this.schedule(undefined)
        this.abort.abort()
      }
    }, 'lectures: watcher')
  }

  /**
   * Read the pipeline settings.
   * @returns effective settings.
   */
  @Remote('getSettings')
  async getSettings(): Promise<LectureSettings> {
    return await this.loadSettings()
  }

  /**
   * Update settings and restart the watcher.
   * @param update - partial settings; `null` clears `writer`, `template`, or `knowledgeBase`.
   * @returns the stored settings.
   * @throws RemoteError when a value is invalid.
   */
  @Remote('setSettings')
  async setSettings(update: LectureSettingsUpdate): Promise<LectureSettings> {
    const current = await this.loadSettings()
    // The JSON round trip drops the fields an update clears with null.
    const merged: LectureSettings = JSON.parse(JSON.stringify({ ...current, ...update }, (_key, value: unknown) => value === null ? undefined : value))
    const next = validateSettings(merged)
    await writeAtomic(join(this.dir, 'config.json'), `${JSON.stringify(next, null, 2)}\n`)
    this.settings = next
    this.ignored.clear()
    this.schedule(next)
    return next
  }

  /**
   * Report the followed lectures.
   * @returns pipeline status, newest lecture first.
   */
  @Remote('status')
  async status(): Promise<LecturesStatus> {
    const settings = await this.loadSettings()
    await this.loadState()
    const lectures = [...this.lectures.values()]
      .map(({ fingerprint: _fingerprint, transcribed: _transcribed, transcriptHash: _hash, ...lecture }) => lecture)
      .sort((a, b) => b.created.localeCompare(a.created))
    const courses: CourseNotes[] = []
    if (settings.enabled) {
      for (const course of (await this.followedCourses(settings, await this.calendar(settings))).filter(entry => entry.configured)) {
        const { dir, name } = this.masterPaths(settings, course)
        const pdf = join(dir, `${name}.pdf`)
        const error = this.masterErrors.get(course.code)
        courses.push({
          course: course.code,
          name: course.name,
          master: join(dir, `${name}.tex`),
          ...existsSync(pdf) ? { pdf } : {},
          lectures: lectures.filter(lecture => lecture.course === course.code && lecture.texPath !== undefined).length,
          ...error === undefined ? {} : { error },
        })
      }
    }
    return {
      enabled: settings.enabled,
      ...this.scannedAt === undefined ? {} : { scannedAt: this.scannedAt },
      ...this.scanError === undefined ? {} : { error: this.scanError },
      lectures,
      courses,
    }
  }

  /**
   * Scan Notability now and advance every lecture that is due.
   * @param _request - no fields.
   * @param signal - caller cancellation.
   * @returns status after the scan.
   */
  @Remote('scan')
  async scan(_request: Record<string, never>, signal: AbortSignal): Promise<LecturesStatus> {
    await this.serial(() => this.tick(signal))
    return await this.status()
  }

  /**
   * Transcribe one lecture and write its quiz now, without waiting for the note to settle.
   * @param request - the lecture id.
   * @param signal - caller cancellation.
   * @returns the lecture's quiz.
   * @throws RemoteError when the lecture is unknown or a step fails.
   */
  @Remote('process')
  async process(request: LectureRef, signal: AbortSignal): Promise<Quiz> {
    return await this.serial(async () => {
      const settings = await this.loadSettings()
      await this.loadState()
      const found = [...this.lectures.values()].find(lecture => lecture.id === request.id)
      if (found === undefined) throw new RemoteError('gateway/bad-request', `unknown lecture "${request.id}"`, {})
      const courses = await this.followedCourses(settings, await this.calendar(settings))
      const course = courses.find(entry => entry.code === found.course) ?? { code: found.course, codes: courseCodes(found.course), name: '', configured: false }
      let lecture = found
      if (lecture.transcribed !== lecture.fingerprint || lecture.notePath === undefined) lecture = await this.transcribe(settings, lecture, course, signal)
      if (lecture.stage === 'failed') throw new RemoteError('gateway/bad-request', lecture.error ?? 'transcription failed', {})
      const quizzed = await this.quiz(settings, lecture, course, signal)
      const quiz = quizzed.quizId === undefined ? undefined : await this.readQuiz(quizzed.quizId)
      if (quiz === undefined) throw new RemoteError('gateway/bad-request', quizzed.error ?? 'quiz generation failed', {})
      return quiz
    })
  }

  /**
   * List recent quizzes.
   * @param request - how many.
   * @returns quizzes, most recent lecture first.
   */
  @Remote('quizzes')
  async quizzes(request: QuizListRequest): Promise<{ quizzes: Quiz[] }> {
    const limit = Math.min(Math.max(request.limit ?? 10, 1), 100)
    let names: string[] = []
    try {
      names = (await readdir(join(this.dir, 'quizzes'))).filter(name => name.endsWith('.json'))
    } catch {
      // No quiz written yet.
      names = []
    }
    const quizzes: Quiz[] = []
    for (const name of names) {
      const quiz = await this.readQuiz(name.replace(/\.json$/, ''))
      if (quiz !== undefined) quizzes.push(quiz)
    }
    quizzes.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    return { quizzes: quizzes.slice(0, limit) }
  }

  private async readQuiz(id: string): Promise<Quiz | undefined> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return undefined
    const value = await readJson(join(this.dir, 'quizzes', `${id}.json`))
    return typeof value === 'object' && value !== null && Array.isArray((value as Partial<Quiz>).questions) ? value as Quiz : undefined
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => undefined)
    return next
  }

  private schedule(settings: LectureSettings | undefined): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    if (settings === undefined || !settings.enabled) return
    const fire = (): void => {
      if (this.scanning) return
      this.scanning = true
      void this.serial(() => this.tick(this.abort.signal)).finally(() => { this.scanning = false })
    }
    this.timer = setInterval(fire, settings.pollSeconds * 1000)
    fire()
  }

  private async loadSettings(): Promise<LectureSettings> {
    if (this.settings !== undefined) return this.settings
    const stored = await readJson(join(this.dir, 'config.json'))
    const merged = { ...DEFAULT_SETTINGS, ...typeof stored === 'object' && stored !== null ? stored : {} }
    try {
      this.settings = validateSettings(merged)
    } catch (error: unknown) {
      this.scanError = `settings: ${error instanceof Error ? error.message : String(error)}`
      this.settings = DEFAULT_SETTINGS
    }
    return this.settings
  }

  private async loadState(): Promise<void> {
    this.loaded ??= (async () => {
      const value = await readJson(join(this.dir, 'state.json'))
      const entries = typeof value === 'object' && value !== null && Array.isArray((value as { lectures?: unknown }).lectures)
        ? (value as { lectures: LectureState[] }).lectures
        : []
      this.lectures = new Map(entries.map(lecture => [lecture.bundle, lecture]))
    })()
    await this.loaded
  }

  private async saveState(): Promise<void> {
    await writeAtomic(join(this.dir, 'state.json'), `${JSON.stringify({ lectures: [...this.lectures.values()] }, null, 2)}\n`)
  }

  /**
   * Store a lecture change.
   * @param lecture - the lecture.
   * @param patch - changed fields; an `undefined` value clears an optional field.
   * @returns the stored lecture.
   */
  private async update(lecture: LectureState, patch: { readonly [K in keyof LectureState]?: LectureState[K] | undefined }): Promise<LectureState> {
    // The JSON round trip drops cleared fields; the state file stores the same JSON.
    const next: LectureState = JSON.parse(JSON.stringify({ ...lecture, ...patch }))
    this.lectures.set(next.bundle, next)
    await this.saveState()
    return next
  }

  /**
   * The followed courses: the configured list, else every connectors course plus every course on the calendar this quarter.
   * @param settings - pipeline settings.
   * @param events - calendar events since the quarter start.
   * @returns followed courses with their names from the connectors settings.
   */
  private async followedCourses(settings: LectureSettings, events: readonly CalendarEvent[]): Promise<FollowedCourse[]> {
    const configured = (await this.ctx.get('connectors')?.getSettings())?.courses ?? []
    const codes = settings.courses.length > 0 ? [...settings.courses] : configured.map(course => course.code)
    if (settings.courses.length === 0) {
      for (const event of events) {
        const code = eventCourse(event)
        const known = (candidate: string): boolean => candidate === code || courseCodes(candidate).includes(code ?? '')
        if (code !== undefined && !codes.some(known) && !configured.some(course => course.aliases?.some(known) === true)) codes.push(code)
      }
    }
    return codes.map((code) => {
      const course = configured.find(entry => entry.code === code)
      return {
        code,
        codes: [...courseCodes(code), ...(course?.aliases ?? []).flatMap(courseCodes)],
        name: course?.name ?? '',
        configured: settings.courses.includes(code) || course !== undefined,
      }
    })
  }

  /**
   * Calendar events from the quarter start to tomorrow.
   * @param settings - pipeline settings.
   * @returns events; none without the connectors service.
   */
  private async calendar(settings: LectureSettings): Promise<CalendarEvent[]> {
    const connectors = this.ctx.get('connectors')
    if (connectors === undefined || settings.since === '') return []
    const from = new Date(`${settings.since}T00:00:00`)
    return (await connectors.agenda({ from: from.toISOString(), to: new Date(Date.now() + 86_400_000).toISOString(), kinds: ['event'] })).items
  }

  /**
   * One scan: find new and edited lecture notes, then transcribe and quiz the ones that are due.
   * @param signal - cancellation.
   */
  private async tick(signal: AbortSignal): Promise<void> {
    const settings = await this.loadSettings()
    if (!settings.enabled) return
    await this.loadState()
    const since = new Date(`${settings.since}T00:00:00`).getTime()
    try {
      const events = await this.calendar(settings)
      const courses = await this.followedCourses(settings, events)
      await this.ensureMasters(settings, courses, signal)
      const now = Date.now()
      for (const name of (await readdir(settings.notabilityDir)).filter(entry => entry.endsWith('.nbn'))) {
        signal.throwIfAborted()
        const bundle = join(settings.notabilityDir, name)
        const fingerprint = await fingerprintNote(bundle)
        const known = this.lectures.get(bundle)
        if (known !== undefined) {
          if (known.fingerprint !== fingerprint) await this.update(known, { fingerprint, changedAt: now, stage: 'waiting' })
          continue
        }
        if (this.ignored.get(bundle) === fingerprint || latestChange(fingerprint) < since) continue
        const meta = await readNoteMeta(bundle)
        const match = meta.created.getTime() < since ? undefined : matchCourse(meta, courses, events, settings.calendarSlackMinutes * 60_000)
        if (match === undefined) {
          this.ignored.set(bundle, fingerprint)
          continue
        }
        await this.update({
          id: meta.uuid === '' ? createHash('sha256').update(bundle).digest('hex').slice(0, 16) : meta.uuid,
          bundle,
          title: match.title,
          course: match.course.code,
          created: meta.created.toISOString(),
          stage: 'waiting',
          // A note first seen long after its last edit is due at once.
          changedAt: Math.min(now, latestChange(fingerprint)),
          fingerprint,
        }, {})
      }
      this.scanError = undefined
      this.scannedAt = Date.now()
      for (const lecture of [...this.lectures.values()]) {
        signal.throwIfAborted()
        const course = courses.find(entry => entry.code === lecture.course) ?? { code: lecture.course, codes: courseCodes(lecture.course), name: '', configured: false }
        const quiet = Date.now() - lecture.changedAt
        let current = lecture
        if (current.transcribed !== current.fingerprint && quiet >= settings.settleMinutes * 60_000) current = await this.transcribe(settings, current, course, signal)
        if (current.quizId === undefined && current.transcribed === current.fingerprint && quiet >= settings.quizAfterMinutes * 60_000) await this.quiz(settings, current, course, signal)
      }
    } catch (error: unknown) {
      if (signal.aborted) return
      this.scanError = error instanceof Error ? error.message : String(error)
    }
  }

  private async complete(settings: LectureSettings, messages: readonly ChatMessage[], signal: AbortSignal): Promise<string> {
    const writer = settings.writer
    if (writer === undefined) return await this.ctx.memory.complete(messages, signal)
    const resolved = await this.ctx.get('credentials')?.resolve(brandString<CredentialRef>(writer.apiKeyEnv))
    const apiKey = resolved?.value ?? process.env[writer.apiKeyEnv] ?? ''
    if (apiKey === '') throw new Error(`${writer.apiKeyEnv} is not set; add it to .env or the environment`)
    return await chatComplete({ baseUrl: writer.baseUrl, model: writer.model, apiKey }, messages, signal)
  }

  private courseDir(settings: LectureSettings, course: FollowedCourse): string {
    return join(settings.vaultDir, settings.school, course.codes[0] ?? course.code)
  }

  /**
   * Where a course's master notes live and the values its template receives.
   * @param settings - pipeline settings.
   * @param course - the course.
   * @returns the folder, the file name without `.tex`, and the template fields.
   */
  private masterPaths(settings: LectureSettings, course: FollowedCourse): { dir: string; name: string; fields: MasterFields } {
    const fields: MasterFields = {
      course: course.code,
      name: course.name === '' ? course.code : course.name,
      quarter: settings.quarter,
      author: settings.author,
      instructor: settings.instructors[course.code] ?? '',
    }
    // Paths use the first listed code, since a cross-listed code's `/` would nest folders.
    const pathFields = { ...fields, course: course.codes[0] ?? course.code, name: course.name.replace(/[\\/:*?"<>|]+/g, ' ') }
    const dir = settings.texDir === '' ? join(this.courseDir(settings, course), 'LaTeX') : fillFields(settings.texDir, pathFields, false)
    const name = fillFields(settings.masterName, pathFields, false).replace(/[\s\-–—:]+$/, '').trim()
    return { dir, name, fields }
  }

  private async template(settings: LectureSettings): Promise<string> {
    return settings.template === undefined ? DEFAULT_TEMPLATE : await readFile(settings.template, 'utf8')
  }

  /**
   * Create master notes for every configured course that has none yet.
   * @param settings - pipeline settings.
   * @param courses - followed courses.
   * @param signal - cancellation.
   */
  private async ensureMasters(settings: LectureSettings, courses: readonly FollowedCourse[], signal: AbortSignal): Promise<void> {
    for (const course of courses.filter(entry => entry.configured)) {
      const { dir, name } = this.masterPaths(settings, course)
      if (existsSync(join(dir, `${name}.tex`))) continue
      try {
        const result = await this.writeMaster(settings, course, await this.template(settings), undefined, signal)
        if (result.error === undefined) this.masterErrors.delete(course.code)
        else this.masterErrors.set(course.code, result.error)
      } catch (error: unknown) {
        if (signal.aborted) throw error
        this.masterErrors.set(course.code, error instanceof Error ? error.message : String(error))
      }
    }
  }

  /**
   * Export, write LaTeX, compile, and re-index one lecture.
   * @param settings - pipeline settings.
   * @param lecture - the lecture.
   * @param course - its course.
   * @param signal - cancellation.
   * @returns the updated lecture; failures are recorded on it, not thrown.
   */
  private async transcribe(settings: LectureSettings, lecture: LectureState, course: FollowedCourse, signal: AbortSignal): Promise<LectureState> {
    const fingerprint = lecture.fingerprint
    let current = await this.update(lecture, { stage: 'transcribing' })
    try {
      if (!this.ctx.memory.ocrEnabled()) throw new Error('OCR is off: set a vision model in Settings → Memory')
      const primary = course.codes[0] ?? course.code
      const entry = await exportNote(lecture.bundle, {
        targetDir: settings.vaultDir,
        schoolCutoff: new Date(0),
        schoolAfter: settings.school,
        schoolBefore: settings.school,
        ocr: (png, hint, pageSignal) => this.ctx.memory.ocrImage(png, hint, pageSignal),
        transcribeAll: true,
        concurrency: this.ctx.memory.ocrConcurrency(),
      }, signal, () => ({ code: primary, rest: lecture.title }))
      if (entry === undefined || entry.path === undefined) throw new Error(entry?.reason ?? 'the note was not exported')
      const transcript = splitFrontMatter(await readFile(entry.path, 'utf8')).body.trim()
      const transcriptHash = createHash('sha256').update(transcript).digest('hex').slice(0, 16)
      current = await this.update(current, { notePath: entry.path })
      const template = await this.template(settings)
      const texDir = this.masterPaths(settings, course).dir
      const date = day(new Date(lecture.created))
      const texPath = join(texDir, 'lectures', `${date}-${slug(lecture.title)}.tex`)
      if (current.transcriptHash !== transcriptHash || current.texPath !== texPath) {
        const body = cleanLatexReply(await this.complete(settings, [
          { role: 'system', content: latexPrompt(preambleOf(template)) },
          { role: 'user', content: `Lecture "${lecture.title}" of ${course.code}${course.name === '' ? '' : ` (${course.name})`}, ${date}:\n\n${transcript}` },
        ], signal))
        await writeAtomic(texPath, lectureFile(lecture.title, date, body))
        // A renamed note moves its LaTeX file; the old one would otherwise stay in the master.
        if (current.texPath !== undefined && current.texPath !== texPath) await rm(current.texPath, { force: true })
        current = await this.update(current, { texPath, transcriptHash })
      }
      const compiled = await this.writeMaster(settings, course, template, texPath, signal)
      current = await this.update(current, {
        stage: current.quizId === undefined ? 'ready' : 'quizzed',
        transcribed: fingerprint,
        ...compiled.pdfPath === undefined ? {} : { pdfPath: compiled.pdfPath },
        error: compiled.error,
      })
      if (settings.knowledgeBase !== undefined) {
        const indexed = await this.ctx.memory.index({ collections: [settings.knowledgeBase] }, signal)
        const failure = indexed.failures.find(item => item.path === entry.path)
        if (failure !== undefined) current = await this.update(current, { error: `indexing: ${failure.message}` })
      }
      return current
    } catch (error: unknown) {
      if (signal.aborted) throw error
      // Retried once the note has again gone settleMinutes without edits.
      return await this.update(current, { stage: 'failed', changedAt: Date.now(), error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Create or update a course's master notes and compile them. An existing file
   * keeps everything outside its lecture block. A compile error in the lecture
   * file just written gets one repair attempt by the writer model.
   * @param settings - pipeline settings.
   * @param course - the course.
   * @param template - master template text, used when the file does not exist yet.
   * @param changed - the lecture file just written, if any.
   * @param signal - cancellation.
   * @returns the PDF path, or the compile error.
   * @throws Error when the template or the existing master lacks the lecture markers.
   */
  private async writeMaster(settings: LectureSettings, course: FollowedCourse, template: string, changed: string | undefined, signal: AbortSignal): Promise<{ pdfPath?: string; error?: string }> {
    const { dir, name, fields } = this.masterPaths(settings, course)
    const inputs = [...this.lectures.values()]
      .filter(lecture => lecture.course === course.code && lecture.texPath !== undefined)
      .sort((a, b) => a.created.localeCompare(b.created))
      .map(lecture => relative(dir, lecture.texPath ?? ''))
    if (changed !== undefined && !inputs.includes(relative(dir, changed))) inputs.push(relative(dir, changed))
    const path = join(dir, `${name}.tex`)
    let existing: string | undefined
    try {
      existing = await readFile(path, 'utf8')
    } catch {
      // No master notes yet; they are created from the template.
      existing = undefined
    }
    const text = existing === undefined ? renderMaster(template, fields, inputs) : updateMaster(existing, inputs)
    if (text !== existing) await writeAtomic(path, text)
    if (settings.latexmk === '') return {}
    const compile = (): Promise<{ ok: boolean; output: string }> =>
      run(settings.latexmk, ['-pdf', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-outdir=.build', `${name}.tex`], dir, signal)
    let result = await compile()
    if (!result.ok && changed !== undefined && result.output.includes(basename(changed))) {
      const errors = latexErrors(result.output)
      const fixed = cleanLatexReply(await this.complete(settings, [
        { role: 'system', content: `${latexPrompt(preambleOf(template))}\nYou are fixing a lecture file that fails to compile. Reply with the corrected complete file, keeping its first two lines.` },
        { role: 'user', content: `Errors:\n${errors}\n\nFile:\n${await readFile(changed, 'utf8')}` },
      ], signal))
      await writeAtomic(changed, `${fixed}\n`)
      result = await compile()
    }
    if (!result.ok) return { error: `LaTeX: ${latexErrors(result.output)}` }
    const pdfPath = join(dir, `${name}.pdf`)
    await copyFile(join(dir, '.build', `${name}.pdf`), pdfPath)
    return { pdfPath }
  }

  /**
   * Write one lecture's quiz.
   * @param settings - pipeline settings.
   * @param lecture - a transcribed lecture.
   * @param course - its course.
   * @param signal - cancellation.
   * @returns the updated lecture; failures are recorded on it, not thrown.
   */
  private async quiz(settings: LectureSettings, lecture: LectureState, course: FollowedCourse, signal: AbortSignal): Promise<LectureState> {
    const notePath = lecture.notePath
    if (notePath === undefined) return lecture
    let current = await this.update(lecture, { stage: 'quizzing' })
    try {
      const transcript = splitFrontMatter(await readFile(notePath, 'utf8')).body.trim()
      const courseLabel = course.name === '' ? course.code : `${course.code}: ${course.name}`
      const questions = parseQuiz(await this.complete(settings, [
        { role: 'system', content: QUIZ_PROMPT },
        { role: 'user', content: `${courseLabel}, lecture "${lecture.title}":\n\n${transcript}` },
      ], signal))
      const date = day(new Date(lecture.created))
      const quizPath = join(this.courseDir(settings, course), 'Quizzes', `${date} ${lecture.title.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').trim()} Quiz.md`)
      const quiz: Quiz = { id: lecture.id, course: course.code, courseLabel, title: lecture.title, date, createdAt: Date.now(), notePath, quizPath, questions }
      await writeAtomic(quizPath, quizMarkdown(quiz, relative(settings.vaultDir, notePath).replace(/\.md$/, '')))
      await writeAtomic(join(this.dir, 'quizzes', `${quiz.id}.json`), `${JSON.stringify(quiz, null, 2)}\n`)
      current = await this.update(current, { stage: 'quizzed', quizId: quiz.id, error: undefined })
      return current
    } catch (error: unknown) {
      if (signal.aborted) throw error
      // Retried after the next edit or by `process`; the quiz step does not loop on a failing model.
      return await this.update(current, { stage: 'failed', transcribed: undefined, changedAt: Date.now(), error: `quiz: ${error instanceof Error ? error.message : String(error)}` })
    }
  }
}

export default Lectures
