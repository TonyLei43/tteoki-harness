/**
 * Personal data connectors. Each connector reads one source — a calendar's
 * private ICS address or a Canvas account — into one normalized agenda of
 * events and assignments. Syncs run on an interval and on request; the agenda
 * is kept under the harness home, can be written into an Obsidian agenda note,
 * and is served through the `connectors` Remote namespace. Connector secrets
 * live in the credential store under each connector's reference name and never
 * appear in settings.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
// Type-only: the optional memory service (ctx.memory) that reads syllabi and runs the local model.
import type {} from '@deepseek-ai/dsh-memory'
import { expandHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { fetchCanvas } from './canvas.ts'
import { detectCourses, labelItems } from './courses.ts'
import { scanSyllabi } from './syllabus.ts'
import type { SyllabusCacheEntry } from './syllabus.ts'
import { fetchIcs, parseIcs } from './ics.ts'
import type { SyncWindow } from './ics.ts'
import { renderAgenda, writeAgendaNote } from './notes.ts'
import type {
  AgendaItem,
  AgendaRequest,
  ConnectorConfig,
  ConnectorSettings,
  ConnectorSettingsUpdate,
  ConnectorStatus,
  ConnectorsStatus,
  CourseConfig,
  SecretRequest,
} from './types.ts'

export type * from './types.ts'
export { assignmentStatus, nextPage, plannerItem } from './canvas.ts'
export { courseLabel, detectCourses, findCourse, labelItems, parseCourse, titleCase } from './courses.ts'
export { findSyllabi, isDuplicate, parseDeadlines, scanSyllabi, syllabusPrompt } from './syllabus.ts'
export type { SyllabusCacheEntry, SyllabusDeadline, SyllabusDeps } from './syllabus.ts'
export { parseIcs } from './ics.ts'
export { BLOCK_END, BLOCK_START, renderAgenda, writeAgendaNote } from './notes.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    connectors: Connectors
  }
}

/** Connector ids: one safe token. */
const CONNECTOR_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** Credential reference names: POSIX environment-variable names. */
const SECRET_REF = /^[A-Z_][A-Z0-9_]*$/

/** Default policy for a fresh settings file. */
const DEFAULT_SETTINGS: ConnectorSettings = { connectors: [], courses: [], pastDays: 7, horizonDays: 60, syncMinutes: 30 }

/** Deployment policy for the connectors service. */
export interface Config {
  /** Harness home override; defaults to the resolved DSH home. */
  readonly home?: string
  /** Time zone of the agenda note; defaults to the host's zone. */
  readonly timeZone?: string
}

/** Persisted agenda and per-connector results. */
interface Snapshot {
  readonly items: readonly AgendaItem[]
  readonly connectors: readonly Omit<ConnectorStatus, 'configured'>[]
  readonly syncedAt?: number
}

/**
 * Validate and normalize connector settings.
 * @param settings - candidate settings.
 * @returns normalized settings.
 * @throws RemoteError naming the first invalid value.
 */
export function validateSettings(settings: ConnectorSettings): ConnectorSettings {
  const bad = (message: string): never => { throw new RemoteError('gateway/bad-request', message, {}) }
  for (const [field, min, max] of [['pastDays', 0, 365], ['horizonDays', 1, 366], ['syncMinutes', 0, 1440]] as const) {
    const value = settings[field]
    if (!Number.isInteger(value) || value < min || value > max) bad(`${field} must be an integer from ${min} to ${max}`)
  }
  const ids = new Set<string>()
  const connectors = settings.connectors.map((connector): ConnectorConfig => {
    const id = connector.id.trim()
    if (!CONNECTOR_ID.test(id)) bad(`connector id "${connector.id}" may use only letters, digits, "-", and "_"`)
    if (ids.has(id)) bad(`duplicate connector id "${id}"`)
    ids.add(id)
    if (connector.name.trim() === '') bad(`connector "${id}" needs a name`)
    if (!SECRET_REF.test(connector.secret)) bad(`connector "${id}" secret must be an upper-case environment-variable name such as CANVAS_TOKEN`)
    if (connector.kind === 'canvas') {
      let base: URL | undefined
      try {
        base = new URL(connector.baseUrl ?? '')
      } catch {
        // Reported below as a missing or invalid base URL.
        base = undefined
      }
      if (base?.protocol !== 'https:') bad(`connector "${id}" needs an https Canvas base URL such as https://canvas.uw.edu`)
      return { id, kind: 'canvas', name: connector.name.trim(), enabled: connector.enabled, secret: connector.secret, baseUrl: base?.origin ?? '' }
    }
    if (connector.kind !== 'ics') bad(`connector "${id}" has unknown kind "${String(connector.kind)}"`)
    return { id, kind: 'ics', name: connector.name.trim(), enabled: connector.enabled, secret: connector.secret }
  })
  const codes = new Set<string>()
  const normalize = (raw: string): string => {
    const code = raw.trim().replace(/\s+/g, ' ').toUpperCase()
    if (!/^[A-Z][A-Z&]{1,7} \d{3}[A-Z]?(?:\/\d{3}[A-Z]?)*$/.test(code)) bad(`course code "${raw}" must look like STAT 534 or STAT 536/427`)
    if (codes.has(code)) bad(`duplicate course code "${code}"`)
    codes.add(code)
    return code
  }
  const courses = settings.courses.map((course): CourseConfig => {
    const code = normalize(course.code)
    const aliases = (course.aliases ?? []).filter(alias => alias.trim() !== '').map(normalize)
    const knowledgeBase = course.knowledgeBase?.trim()
    return {
      code,
      name: course.name.trim(),
      ...aliases.length === 0 ? {} : { aliases },
      ...knowledgeBase === undefined || knowledgeBase === '' ? {} : { knowledgeBase },
      folders: course.folders.map(folder => folder.trim()).filter(folder => folder !== '').map(folder => expandHomePath(folder)),
    }
  })
  const notesDir = settings.notesDir?.trim()
  return {
    connectors,
    courses,
    pastDays: settings.pastDays,
    horizonDays: settings.horizonDays,
    syncMinutes: settings.syncMinutes,
    ...notesDir === undefined || notesDir === '' ? {} : { notesDir: expandHomePath(notesDir) },
  }
}

/**
 * Write JSON atomically with owner-only permissions.
 * @param path - destination.
 * @param value - JSON value.
 */
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
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

/** Remote service owning connector settings, syncing, and the agenda. */
export class Connectors extends TypertRemoteService {
  static Config: z<Config> = z.object({ home: z.string(), timeZone: z.string() })

  static inject = ['typert', 'credentials']

  private readonly dir: string
  private readonly timeZone: string
  private settings: ConnectorSettings | undefined
  private snapshot: Snapshot | undefined
  private running: Promise<ConnectorsStatus> | undefined
  private timer: ReturnType<typeof setInterval> | undefined

  /** @param ctx - Host context. @param config - home and time-zone overrides. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'connectors')
    this.dir = join(config.home ?? resolveDshHome(), 'connectors')
    this.timeZone = config.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    ctx.effect(() => {
      void this.loadSettings().then(settings => { this.schedule(settings) })
      return () => { this.schedule(undefined) }
    }, 'connectors: sync timer')
  }

  /**
   * Read the connector settings.
   * @returns effective settings.
   */
  @Remote('getSettings')
  async getSettings(): Promise<ConnectorSettings> {
    return await this.loadSettings()
  }

  /**
   * Update connector settings and reschedule automatic sync.
   * @param update - partial settings.
   * @returns the stored settings.
   * @throws RemoteError when a value is invalid.
   */
  @Remote('setSettings')
  async setSettings(update: ConnectorSettingsUpdate): Promise<ConnectorSettings> {
    const current = await this.loadSettings()
    const { notesDir, ...rest } = update
    const { notesDir: currentNotes, ...base } = current
    const nextNotes = notesDir === undefined ? currentNotes : notesDir ?? undefined
    const next = validateSettings({ ...base, ...rest, ...nextNotes === undefined ? {} : { notesDir: nextNotes } })
    await writeJson(join(this.dir, 'config.json'), next)
    this.settings = next
    this.schedule(next)
    return next
  }

  /**
   * Store one connector's secret in the credential store under its reference name.
   * @param request - connector id and secret value.
   * @returns an empty receipt.
   * @throws RemoteError when the connector is unknown or the value is empty.
   */
  @Remote('setSecret')
  async setSecret(request: SecretRequest): Promise<Record<string, never>> {
    const connector = (await this.loadSettings()).connectors.find(entry => entry.id === request.connector)
    if (connector === undefined) throw new RemoteError('gateway/bad-request', `unknown connector "${request.connector}"`, {})
    if (request.value.trim() === '') throw new RemoteError('gateway/bad-request', 'the secret must not be empty', {})
    await this.ctx.credentials.set(brandString<CredentialRef>(connector.secret), request.value.trim())
    return {}
  }

  /**
   * Report each connector's last sync and whether its secret is configured.
   * @returns per-connector status.
   */
  @Remote('status')
  async status(): Promise<ConnectorsStatus> {
    const settings = await this.loadSettings()
    const snapshot = await this.loadSnapshot()
    const connectors: ConnectorStatus[] = []
    for (const connector of settings.connectors) {
      const info = await this.ctx.credentials.describe(brandString<CredentialRef>(connector.secret))
      const last = snapshot.connectors.find(entry => entry.id === connector.id)
      connectors.push({ id: connector.id, syncedAt: last?.syncedAt ?? 0, items: last?.items ?? 0, ...last?.error === undefined ? {} : { error: last.error }, configured: info.configured })
    }
    const syllabus = snapshot.connectors.find(entry => entry.id === 'syllabus')
    if (syllabus !== undefined) connectors.push({ ...syllabus, configured: true })
    return { connectors, ...snapshot.syncedAt === undefined ? {} : { syncedAt: snapshot.syncedAt } }
  }

  /**
   * Sync every enabled connector, keep the previous items of a connector that
   * fails, and rewrite the agenda note. Concurrent calls share one sync.
   * @param _request - no fields.
   * @param signal - caller cancellation.
   * @returns status after the sync.
   */
  @Remote('sync')
  async sync(_request: Record<string, never>, signal: AbortSignal): Promise<ConnectorsStatus> {
    this.running ??= this.runSync(signal).finally(() => { this.running = undefined })
    return await this.running
  }

  /**
   * Read agenda items overlapping a window.
   * @param request - window and kinds.
   * @returns items sorted by start.
   */
  @Remote('agenda')
  async agenda(request: AgendaRequest): Promise<{ items: AgendaItem[] }> {
    const from = request.from === undefined ? startOfToday() : new Date(request.from)
    const to = request.to === undefined ? new Date(from.getTime() + 14 * 86_400_000) : new Date(request.to)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new RemoteError('gateway/bad-request', 'from and to must be ISO 8601 times', {})
    const kinds = request.kinds === undefined ? undefined : new Set(request.kinds)
    const courses = (await this.loadSettings()).courses
    const items = labelItems((await this.loadSnapshot()).items, courses).filter((item) => {
      if (kinds !== undefined && !kinds.has(item.kind)) return false
      const start = new Date(item.start).getTime()
      const end = new Date(item.end ?? item.start).getTime()
      return end >= from.getTime() && start < to.getTime()
    })
    return { items: [...items] }
  }

  private async runSync(signal: AbortSignal): Promise<ConnectorsStatus> {
    const settings = await this.loadSettings()
    const previous = await this.loadSnapshot()
    const now = new Date()
    const window: SyncWindow = {
      from: new Date(startOfToday().getTime() - settings.pastDays * 86_400_000),
      to: new Date(now.getTime() + settings.horizonDays * 86_400_000),
    }
    const items: AgendaItem[] = []
    const statuses: Omit<ConnectorStatus, 'configured'>[] = []
    for (const connector of settings.connectors.filter(entry => entry.enabled)) {
      try {
        const secret = await this.ctx.credentials.resolve(brandString<CredentialRef>(connector.secret))
        if (secret === undefined) throw new Error(`${connector.secret} is not set; add the secret in the connector settings`)
        const found = connector.kind === 'canvas'
          ? await fetchCanvas(connector.baseUrl ?? '', secret.value, connector.id, window, signal)
          : parseIcs(await fetchIcs(secret.value, signal), connector, window)
        items.push(...found)
        statuses.push({ id: connector.id, syncedAt: now.getTime(), items: found.length })
      } catch (error: unknown) {
        const kept = previous.items.filter(item => item.source === connector.id)
        items.push(...kept)
        statuses.push({ id: connector.id, syncedAt: now.getTime(), items: kept.length, error: error instanceof Error ? error.message : String(error) })
      }
    }
    const connectorItems = labelItems(items, settings.courses)
    const syllabus = await this.syncSyllabi(settings, connectorItems, now, signal)
    if (syllabus !== undefined) statuses.push(syllabus.status)
    const labeled = [...connectorItems, ...syllabus?.items ?? []].sort((left, right) => left.start.localeCompare(right.start))
    const courses = detectCourses(settings.courses, labeled)
    if (courses.length !== settings.courses.length) await this.setSettings({ courses })
    const snapshot: Snapshot = { items: labeled, connectors: statuses, syncedAt: now.getTime() }
    await writeJson(join(this.dir, 'agenda.json'), snapshot)
    this.snapshot = snapshot
    if (settings.notesDir !== undefined) await writeAgendaNote(settings.notesDir, renderAgenda(labeled, now, this.timeZone))
    return await this.status()
  }

  /**
   * Scan linked courses' syllabi through the memory service, when it is mounted and a course has folders.
   * @param settings - current settings.
   * @param others - items from the connectors.
   * @param now - the sync time.
   * @param signal - caller cancellation.
   * @returns syllabus items inside the sync window and a status entry, or undefined when there is nothing to scan.
   */
  private async syncSyllabi(settings: ConnectorSettings, others: readonly AgendaItem[], now: Date, signal: AbortSignal): Promise<{ items: AgendaItem[]; status: Omit<ConnectorStatus, 'configured'> } | undefined> {
    const memory = this.ctx.get('memory')
    if (memory === undefined || !settings.courses.some(course => course.folders.length > 0)) return undefined
    const cachePath = join(this.dir, 'syllabus.json')
    const stored = await readJson(cachePath)
    const cache: Record<string, SyllabusCacheEntry> = stored !== null && typeof stored === 'object' ? { ...stored as Record<string, SyllabusCacheEntry> } : {}
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const result = await scanSyllabi(settings.courses, others, cache, {
      extractText: (path, scanSignal) => memory.extractText(path, scanSignal),
      complete: (system, user, scanSignal) => memory.complete([{ role: 'system', content: system }, { role: 'user', content: user }], scanSignal),
    }, signal, today)
    await writeJson(cachePath, cache)
    const from = now.getTime() - settings.pastDays * 86_400_000
    const to = now.getTime() + settings.horizonDays * 86_400_000
    const items = result.items.filter(item => new Date(item.start).getTime() >= from && new Date(item.start).getTime() < to)
    return { items, status: { id: 'syllabus', syncedAt: now.getTime(), items: items.length, ...result.errors.length === 0 ? {} : { error: result.errors.join('; ') } } }
  }

  private schedule(settings: ConnectorSettings | undefined): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    if (settings === undefined || settings.syncMinutes === 0 || settings.connectors.length === 0) return
    this.timer = setInterval(() => {
      this.sync({}, AbortSignal.timeout(120_000)).catch(() => {
        // Per-connector failures are recorded in the snapshot; a failed note write retries next interval.
      })
    }, settings.syncMinutes * 60_000)
    this.timer.unref()
  }

  private async loadSettings(): Promise<ConnectorSettings> {
    if (this.settings !== undefined) return this.settings
    const stored = await readJson(join(this.dir, 'config.json'))
    try {
      this.settings = validateSettings({ ...DEFAULT_SETTINGS, ...stored !== null && typeof stored === 'object' ? stored : {} })
    } catch {
      // A corrupt settings file falls back to defaults rather than blocking the service.
      this.settings = DEFAULT_SETTINGS
    }
    return this.settings
  }

  private async loadSnapshot(): Promise<Snapshot> {
    if (this.snapshot !== undefined) return this.snapshot
    const stored = await readJson(join(this.dir, 'agenda.json'))
    const record = stored !== null && typeof stored === 'object' ? stored as Partial<Snapshot> : {}
    this.snapshot = { items: Array.isArray(record.items) ? record.items : [], connectors: Array.isArray(record.connectors) ? record.connectors : [], ...typeof record.syncedAt === 'number' ? { syncedAt: record.syncedAt } : {} }
    return this.snapshot
  }
}

/**
 * Midnight at the start of today in the host's time zone.
 * @returns the instant.
 */
function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export default Connectors
