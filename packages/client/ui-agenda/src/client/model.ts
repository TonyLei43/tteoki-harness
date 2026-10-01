/** The agenda's business face shared by the widgets and the panel, and pure date helpers. */

import type {
  AgendaItem, AgendaKind, ConnectorSettings, ConnectorSettingsUpdate, ConnectorsStatus,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** Registration-side business face for every agenda view. */
export interface AgendaInjected {
  /**
   * Read agenda items overlapping a window.
   * @param from - inclusive start.
   * @param to - exclusive end.
   * @param kinds - only these kinds; all when absent.
   * @returns items sorted by start.
   */
  readonly agenda: (from: Date, to: Date, kinds?: readonly AgendaKind[]) => Promise<readonly AgendaItem[]>
  /** @returns per-connector sync status. */
  readonly status: () => Promise<ConnectorsStatus>
  /** @returns status after syncing every enabled connector; bumps {@link AgendaInjected.revision}. */
  readonly sync: () => Promise<ConnectorsStatus>
  /** @returns connector settings. */
  readonly getSettings: () => Promise<ConnectorSettings>
  /**
   * Update connector settings.
   * @param update - partial settings.
   * @returns the stored settings.
   */
  readonly setSettings: (update: ConnectorSettingsUpdate) => Promise<ConnectorSettings>
  /**
   * Store a connector's secret.
   * @param connector - connector id.
   * @param value - the secret.
   */
  readonly setSecret: (connector: string, value: string) => Promise<void>
  /** @returns knowledge bases a course can link to. */
  readonly knowledgeBases: () => Promise<readonly { readonly id: string; readonly name: string }[]>
  /** Open the Agenda panel. */
  readonly openPanel: () => void
  /**
   * Open a class page.
   * @param code - the course code, such as `STAT 581`.
   */
  readonly openCourse: (code: string) => void
  /** Course code of the class page. */
  readonly selectedCourse: ObservableSnapshot<string | undefined>
  /** Open Home. */
  readonly openHome: () => void
  /** Increments after every sync so open views reload. */
  readonly revision: ObservableSnapshot<number>
}

/** Milliseconds in one day. */
export const DAY = 86_400_000

/**
 * Local `YYYY-MM-DD` key of an epoch-milliseconds instant.
 * @param time - epoch milliseconds.
 * @returns the local day key.
 */
export function dateKey(time: number): string {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Local calendar-day key of an item, keeping all-day items on their UTC date.
 * @param iso - ISO instant.
 * @param allDay - whether the item is all-day.
 * @returns `YYYY-MM-DD`.
 */
export function dayKey(iso: string, allDay: boolean): string {
  const date = new Date(iso)
  if (allDay) return date.toISOString().slice(0, 10)
  return dateKey(date.getTime())
}

/**
 * Day heading: today, tomorrow, or a weekday with its date.
 * @param key - `YYYY-MM-DD` day key.
 * @param now - the current time.
 * @param labels - localized today and tomorrow labels.
 * @returns the heading.
 */
export function dayHeading(key: string, now: number, labels: { readonly today: string; readonly tomorrow: string }): string {
  if (key === dayKey(new Date(now).toISOString(), false)) return labels.today
  if (key === dayKey(new Date(now + DAY).toISOString(), false)) return labels.tomorrow
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(year, month - 1, day))
}

/**
 * Local clock time of an instant.
 * @param iso - ISO instant.
 * @returns the time, such as `10:30`.
 */
export function clock(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

/**
 * Relative description of an instant, such as "in 2 days" or "3 hours ago".
 * @param iso - ISO instant or epoch milliseconds.
 * @param now - the current time.
 * @returns the relative text.
 */
export function relative(iso: string | number, now: number): string {
  const delta = new Date(iso).getTime() - now
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const abs = Math.abs(delta)
  if (abs < 3_600_000) return format.format(Math.round(delta / 60_000), 'minute')
  if (abs < DAY) return format.format(Math.round(delta / 3_600_000), 'hour')
  return format.format(Math.round(delta / DAY), 'day')
}

/**
 * Group items by local day, in order.
 * @param items - items sorted by start.
 * @returns day keys with their items.
 */
export function byDay(items: readonly AgendaItem[]): { key: string; items: AgendaItem[] }[] {
  const groups: { key: string; items: AgendaItem[] }[] = []
  for (const item of items) {
    const key = dayKey(item.start, item.allDay)
    const last = groups[groups.length - 1]
    if (last?.key === key) last.items.push(item)
    else groups.push({ key, items: [item] })
  }
  return groups
}

/** Assignment statuses that need no more work. */
export const DONE_STATUSES: ReadonlySet<string> = new Set(['submitted', 'graded', 'excused'])

/** Granularity the calendar widget shows. */
export type CalendarView = 'day' | 'week' | 'month'

/** One day cell in a calendar grid. */
export interface CalendarDay {
  /** Local midnight of the day, epoch milliseconds. */
  readonly time: number
  /** `YYYY-MM-DD` local day key. */
  readonly key: string
  /** Whether the day belongs to the anchor's month; always true outside month view. */
  readonly inMonth: boolean
  /** Whether the day is today. */
  readonly today: boolean
}

/** A calendar grid and the half-open window its items cover. */
export interface CalendarWindow {
  /** Grid days in display order, Sunday first. */
  readonly days: readonly CalendarDay[]
  /** Inclusive window start, epoch milliseconds. */
  readonly from: number
  /** Exclusive window end, epoch milliseconds. */
  readonly to: number
}

/** Local midnight of the day containing an instant. */
export function startOfDay(time: number): number {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Shift an instant by whole local calendar days. */
export function addDays(time: number, days: number): number {
  const date = new Date(time)
  date.setDate(date.getDate() + days)
  return date.getTime()
}

/** Local midnight of the Sunday on or before the day containing an instant. */
function startOfWeek(time: number): number {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - date.getDay())
  return date.getTime()
}

/** Local midnight of the first day of the month containing an instant. */
function firstOfMonth(time: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

/**
 * The day grid for a calendar view and the window its items cover.
 * @param view - day, week, or month.
 * @param anchor - an instant inside the period shown.
 * @param now - the current time, used to mark today.
 * @returns the grid days and the half-open fetch window.
 */
export function calendarWindow(view: CalendarView, anchor: number, now: number): CalendarWindow {
  const firstDay = view === 'day' ? startOfDay(anchor) : view === 'week' ? startOfWeek(anchor) : startOfWeek(firstOfMonth(anchor))
  const count = view === 'day' ? 1 : view === 'week' ? 7 : 42
  const today = startOfDay(now)
  const anchorMonth = new Date(anchor).getMonth()
  const days = Array.from({ length: count }, (_, offset): CalendarDay => {
    const time = addDays(firstDay, offset)
    return {
      time,
      key: dateKey(time),
      inMonth: view !== 'month' || new Date(time).getMonth() === anchorMonth,
      today: time === today,
    }
  })
  return { days, from: firstDay, to: addDays(firstDay, count) }
}

/**
 * The heading of a calendar period: the day, the week range, or the month and year.
 * @param view - day, week, or month.
 * @param anchor - an instant inside the period.
 * @returns the localized heading.
 */
export function periodTitle(view: CalendarView, anchor: number): string {
  if (view === 'day') return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(anchor))
  if (view === 'week') {
    const format = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    return format.formatRange(new Date(startOfWeek(anchor)), new Date(addDays(startOfWeek(anchor), 6)))
  }
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(anchor))
}

/**
 * Move the anchor by a number of periods.
 * @param view - day, week, or month.
 * @param anchor - the current anchor instant.
 * @param delta - periods to move; negative goes back.
 * @returns the new anchor instant.
 */
export function stepAnchor(view: CalendarView, anchor: number, delta: number): number {
  if (view === 'month') {
    const date = new Date(anchor)
    return new Date(date.getFullYear(), date.getMonth() + delta, 1).getTime()
  }
  return addDays(anchor, delta * (view === 'week' ? 7 : 1))
}

/**
 * Local hour label, such as `10 AM`.
 * @param hour - local hour, 0–23.
 * @returns the hour label.
 */
export function hourLabel(hour: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour))
}

/** The items a single grid day shows. */
export interface DayItems {
  /** Items spanning the whole day. */
  readonly allDay: readonly AgendaItem[]
  /** Items with a start time. */
  readonly timed: readonly AgendaItem[]
}

/**
 * Place items on their grid day: all-day items by calendar date, timed items by local start day.
 * @param items - fetched items.
 * @param days - the grid days.
 * @returns each visible day key's items; days without items are absent, items outside the grid are dropped.
 */
export function groupByDay(items: readonly AgendaItem[], days: readonly CalendarDay[]): Map<string, DayItems> {
  const visible = new Set(days.map(day => day.key))
  const grouped = new Map<string, { allDay: AgendaItem[]; timed: AgendaItem[] }>()
  for (const item of items) {
    const key = dayKey(item.start, item.allDay)
    if (!visible.has(key)) continue
    const bucket = grouped.get(key) ?? { allDay: [], timed: [] }
    grouped.set(key, bucket)
    if (item.allDay) bucket.allDay.push(item)
    else bucket.timed.push(item)
  }
  return grouped
}

/** A timed item placed in a day's hour grid. */
export interface TimedPlacement {
  readonly item: AgendaItem
  /** Minutes from local midnight, clamped to the day. */
  readonly startMinute: number
  readonly endMinute: number
  /** Column index within the item's overlap cluster. */
  readonly lane: number
  /** Columns in the item's overlap cluster. */
  readonly lanes: number
}

/** Minutes in one day. */
const MINUTES_PER_DAY = 1440

/**
 * Bound a number to an inclusive range.
 * @param value - the number.
 * @param min - lower bound.
 * @param max - upper bound.
 * @returns the bounded value.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** A timed item before lane assignment. */
interface TimedEntry {
  readonly item: AgendaItem
  readonly startMinute: number
  readonly endMinute: number
}

/**
 * Place timed items in a day's hour grid, side by side where they overlap.
 * @param items - the day's timed items.
 * @param dayTime - local midnight of the day.
 * @returns placements sorted by start, each with its lane and the cluster's lane count.
 */
export function layoutDay(items: readonly AgendaItem[], dayTime: number): TimedPlacement[] {
  const entries: TimedEntry[] = items.map((item) => {
    const startMinute = clamp(Math.round((new Date(item.start).getTime() - dayTime) / 60_000), 0, MINUTES_PER_DAY)
    const rawEnd = item.end === undefined ? startMinute + 30 : Math.round((new Date(item.end).getTime() - dayTime) / 60_000)
    return { item, startMinute, endMinute: clamp(Math.max(rawEnd, startMinute + 15), startMinute, MINUTES_PER_DAY) }
  }).sort((left, right) => left.startMinute - right.startMinute || left.item.id.localeCompare(right.item.id))

  const placements: TimedPlacement[] = []
  let laneEnds: number[] = []
  let clusterEnd = -1
  let cluster: (TimedEntry & { lane: number })[] = []
  const flush = (): void => {
    const lanes = laneEnds.length
    for (const member of cluster) placements.push({ ...member, lanes })
    laneEnds = []
    clusterEnd = -1
    cluster = []
  }
  for (const entry of entries) {
    if (entry.startMinute >= clusterEnd) flush()
    let lane = laneEnds.findIndex(end => end <= entry.startMinute)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = Math.max(laneEnds[lane] ?? 0, entry.endMinute)
    clusterEnd = Math.max(clusterEnd, entry.endMinute)
    cluster.push({ ...entry, lane })
  }
  flush()
  return placements
}

/** One weekly class meeting: the weekdays it repeats on, its time, and its room. */
export interface Meeting {
  /** Short weekday names, Monday first, such as `['Mon', 'Wed']`. */
  readonly days: readonly string[]
  /** Local time range, such as `10:00 AM – 11:20 AM`. */
  readonly time: string
  readonly location?: string
  /** What the meeting is, such as `Office hour (Chen)`; absent for the class itself. */
  readonly title?: string
}

/** A class meeting's title starts with its course code, such as `STAT 581 A`. */
const CLASS_TITLE = /^[A-Z][A-Z&/]{1,8}\s*\d{3}/

/**
 * Split a course's events into class meetings and everything else (office hours, sections, reviews).
 * @param events - a course's events.
 * @returns class meetings and other events; every event counts as a class when none is titled by its code.
 */
export function splitMeetings(events: readonly AgendaItem[]): { classes: AgendaItem[]; other: AgendaItem[] } {
  const classes = events.filter(item => CLASS_TITLE.test(item.title))
  if (classes.length === 0) return { classes: [...events], other: [] }
  return { classes, other: events.filter(item => !CLASS_TITLE.test(item.title)) }
}

/**
 * The next class meeting: the one in progress, else the next to start.
 * @param events - a course's events sorted by start.
 * @param now - the current time.
 * @returns the meeting, or undefined.
 */
export function nextMeeting(events: readonly AgendaItem[], now: number): AgendaItem | undefined {
  return events.find(item => item.kind === 'event' && !item.allDay && new Date(item.end ?? item.start).getTime() > now)
}

/**
 * Summarize a course's timed events as weekly meetings.
 * @param events - a course's events.
 * @returns meetings sharing a time and room, earliest weekday first.
 */
export function weeklyMeetings(events: readonly AgendaItem[]): Meeting[] {
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
  const groups = new Map<string, { days: Map<number, string>; time: string; location?: string; title?: string; first: number }>()
  for (const item of events) {
    if (item.kind !== 'event' || item.allDay) continue
    const start = new Date(item.start)
    const time = item.end === undefined ? clock(item.start) : `${clock(item.start)} – ${clock(item.end)}`
    const title = CLASS_TITLE.test(item.title) ? undefined : item.title
    const key = `${time}|${item.location ?? ''}|${title ?? ''}`
    const group = groups.get(key) ?? {
      days: new Map<number, string>(), time, first: start.getTime(),
      ...item.location === undefined ? {} : { location: item.location },
      ...title === undefined ? {} : { title },
    }
    // Monday first: Sunday (0) sorts last.
    group.days.set((start.getDay() + 6) % 7, weekday.format(start))
    groups.set(key, group)
  }
  return [...groups.values()]
    .sort((a, b) => Math.min(...a.days.keys()) - Math.min(...b.days.keys()) || a.first - b.first)
    .map(group => ({
      days: [...group.days.entries()].sort(([a], [b]) => a - b).map(([, name]) => name),
      time: group.time,
      ...group.location === undefined ? {} : { location: group.location },
      ...group.title === undefined ? {} : { title: group.title },
    }))
}

/** Titles that name an exam. */
const EXAM = /\b(exam|midterm|final|quiz)\b/i

/**
 * Whether an item is an exam or quiz.
 * @param item - an agenda item.
 * @returns true when its title names one.
 */
export function isExam(item: AgendaItem): boolean {
  return EXAM.test(item.title)
}
