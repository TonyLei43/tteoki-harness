/** iCalendar (ICS) connector: fetch a private calendar address and expand its events into agenda items. */

import ICAL from 'ical.js'
import type { AgendaItem } from './types.ts'

/** Most occurrences one recurring event may contribute; guards unbounded rules. */
const MAX_OCCURRENCES = 2000

/** Longest description kept on an item. */
const MAX_DESCRIPTION = 2000

/** A time window, inclusive start and exclusive end. */
export interface SyncWindow {
  readonly from: Date
  readonly to: Date
}

/**
 * Fetch a calendar feed; `webcal:` addresses are fetched over HTTPS.
 * @param address - the private ICS address.
 * @param signal - caller cancellation.
 * @returns the feed text.
 * @throws Error naming the HTTP status when the fetch fails.
 */
export async function fetchIcs(address: string, signal: AbortSignal): Promise<string> {
  const url = address.trim().replace(/^webcal:\/\//i, 'https://')
  const response = await fetch(url, { signal, headers: { accept: 'text/calendar' } })
  if (!response.ok) throw new Error(`calendar feed returned HTTP ${response.status}`)
  return await response.text()
}

/**
 * Convert an iCalendar time to an ISO instant. A date-only value maps to UTC
 * midnight of that calendar date, so all-day items keep their date in every time zone.
 * @param time - the iCalendar time.
 * @returns ISO 8601 in UTC.
 */
function instant(time: ICAL.Time): string {
  if (time.isDate) return new Date(Date.UTC(time.year, time.month - 1, time.day)).toISOString()
  return time.toJSDate().toISOString()
}

/**
 * Read an optional text property.
 * @param component - the event component.
 * @param name - property name.
 * @returns the trimmed text, or undefined when absent or empty.
 */
function text(component: ICAL.Component, name: string): string | undefined {
  const value = component.getFirstPropertyValue(name)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Expand a calendar feed into agenda items inside a window. Recurring events
 * expand occurrence by occurrence, with moved and cancelled occurrences
 * applied; cancelled events are dropped. Canvas calendar feeds mark
 * assignments with `event-assignment-` uids, which become assignment items.
 * @param feed - ICS text.
 * @param connector - connector id and fallback calendar name.
 * @param window - occurrences overlapping this window are kept.
 * @returns items sorted by start.
 * @throws Error when the text is not an iCalendar feed.
 */
export function parseIcs(feed: string, connector: { readonly id: string; readonly name: string }, window: SyncWindow): AgendaItem[] {
  const root = new ICAL.Component(ICAL.parse(feed))
  if (root.name !== 'vcalendar') throw new Error('the feed is not an iCalendar calendar')
  for (const zone of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(zone)
  const calendar = text(root, 'x-wr-calname') ?? connector.name
  const masters = new Map<string, ICAL.Event>()
  const exceptions: ICAL.Event[] = []
  for (const component of root.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(component)
    if (event.isRecurrenceException()) exceptions.push(event)
    else masters.set(event.uid, event)
  }
  for (const exception of exceptions) {
    const master = masters.get(exception.uid)
    if (master === undefined) masters.set(`${exception.uid}:${exception.recurrenceId.toString()}`, exception)
    else master.relateException(exception)
  }

  const items: AgendaItem[] = []
  const push = (component: ICAL.Component, uid: string, start: ICAL.Time, end: ICAL.Time | undefined): void => {
    if (text(component, 'status')?.toUpperCase() === 'CANCELLED') return
    const startIso = instant(start)
    const endIso = end === undefined ? undefined : instant(end)
    if (new Date(endIso ?? startIso).getTime() < window.from.getTime() || new Date(startIso).getTime() >= window.to.getTime()) return
    const description = text(component, 'description')
    const location = text(component, 'location')
    const url = text(component, 'url')
    items.push({
      id: `${connector.id}:${uid}:${startIso}`,
      source: connector.id,
      kind: /event-assignment-/.test(uid) ? 'assignment' : 'event',
      title: text(component, 'summary') ?? '(untitled)',
      start: startIso,
      ...endIso === undefined || endIso === startIso ? {} : { end: endIso },
      allDay: start.isDate,
      course: calendar,
      ...location === undefined ? {} : { location },
      ...url === undefined ? {} : { url },
      ...description === undefined ? {} : { description: description.slice(0, MAX_DESCRIPTION) },
    })
  }

  for (const event of masters.values()) {
    if (!event.isRecurring()) {
      push(event.component, event.uid, event.startDate, event.endDate)
      continue
    }
    const iterator = event.iterator()
    for (let count = 0; count < MAX_OCCURRENCES; count += 1) {
      const next = iterator.next()
      if (next === undefined || next === null) break
      if (next.toJSDate().getTime() >= window.to.getTime()) break
      const details = event.getOccurrenceDetails(next)
      push(details.item.component, event.uid, details.startDate, details.endDate)
    }
  }
  return items.sort((left, right) => left.start.localeCompare(right.start))
}
