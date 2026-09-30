/** Canvas LMS connector: the planner API's assignments, quizzes, discussions, and events with submission status. */

import { z } from 'zod'
import type { SyncWindow } from './ics.ts'
import type { AgendaItem, AgendaKind, AssignmentStatus } from './types.ts'

/** Most planner pages read in one sync; guards a looping `next` link. */
const MAX_PAGES = 20

/** Planner item types that are not work items or events. */
const SKIPPED_TYPES = new Set(['announcement', 'planner_note', 'wiki_page'])

/** Submission facts on a planner item; `false` when the item takes no submission. */
const SubmissionSchema = z.union([z.literal(false), z.object({
  submitted: z.boolean().optional(),
  excused: z.boolean().optional(),
  graded: z.boolean().optional(),
  late: z.boolean().optional(),
  missing: z.boolean().optional(),
}).passthrough()])

/** One planner item, as far as the connector reads it. */
const PlannerItemSchema = z.object({
  plannable_id: z.union([z.number(), z.string()]),
  plannable_type: z.string(),
  plannable_date: z.string().nullable().optional(),
  context_name: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
  submissions: SubmissionSchema.optional(),
  plannable: z.object({
    title: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    due_at: z.string().nullable().optional(),
    end_at: z.string().nullable().optional(),
    location_name: z.string().nullable().optional(),
    points_possible: z.number().nullable().optional(),
  }).passthrough(),
}).passthrough()

/** One planner item. */
type PlannerItem = z.infer<typeof PlannerItemSchema>

/**
 * Derive an assignment's status from its submission facts.
 * @param submissions - the planner item's submission facts.
 * @returns the status, `upcoming` when nothing is submitted yet.
 */
export function assignmentStatus(submissions: PlannerItem['submissions']): AssignmentStatus {
  if (submissions === undefined || submissions === false) return 'upcoming'
  if (submissions.excused === true) return 'excused'
  if (submissions.graded === true) return 'graded'
  if (submissions.missing === true) return 'missing'
  if (submissions.late === true) return 'late'
  if (submissions.submitted === true) return 'submitted'
  return 'upcoming'
}

/**
 * Read the next page address from a `Link` header, only when it stays on the Canvas origin.
 * @param header - the `Link` header value.
 * @param origin - the Canvas origin the token belongs to.
 * @returns the next page URL, or undefined.
 */
export function nextPage(header: string | null, origin: string): string | undefined {
  if (header === null) return undefined
  for (const part of header.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part)
    if (match?.[1] === undefined) continue
    const url = new URL(match[1])
    // The access token rides every request; never send it off the Canvas origin.
    return url.origin === origin ? url.href : undefined
  }
  return undefined
}

/**
 * Map one planner item to an agenda item.
 * @param item - the planner item.
 * @param connector - connector id.
 * @param baseUrl - Canvas base URL for relative links.
 * @returns the agenda item, or undefined for skipped types and undated items.
 */
export function plannerItem(item: PlannerItem, connector: string, baseUrl: string): AgendaItem | undefined {
  if (SKIPPED_TYPES.has(item.plannable_type)) return undefined
  const date = item.plannable_date ?? item.plannable.due_at
  if (date === null || date === undefined) return undefined
  const kind: AgendaKind = item.plannable_type === 'calendar_event' ? 'event' : 'assignment'
  const start = new Date(date).toISOString()
  const end = kind === 'event' && typeof item.plannable.end_at === 'string' ? new Date(item.plannable.end_at).toISOString() : undefined
  const course = item.context_name ?? undefined
  const location = item.plannable.location_name ?? undefined
  const points = item.plannable.points_possible ?? undefined
  return {
    id: `${connector}:${item.plannable_type}:${String(item.plannable_id)}`,
    source: connector,
    kind,
    title: item.plannable.title ?? item.plannable.name ?? '(untitled)',
    start,
    ...end === undefined || end === start ? {} : { end },
    allDay: false,
    ...course === undefined ? {} : { course },
    ...location === undefined || location === '' ? {} : { location },
    ...item.html_url === null || item.html_url === undefined ? {} : { url: new URL(item.html_url, baseUrl).href },
    ...kind === 'assignment' ? { status: assignmentStatus(item.submissions) } : {},
    ...points === undefined ? {} : { points },
  }
}

/**
 * Read the Canvas planner for a window, following pagination.
 * @param baseUrl - Canvas instance, such as `https://canvas.uw.edu`.
 * @param token - Canvas access token.
 * @param connector - connector id.
 * @param window - the sync window.
 * @param signal - caller cancellation.
 * @returns agenda items sorted by start.
 * @throws Error naming the HTTP status, or the invalid field when the response does not match the planner format.
 */
export async function fetchCanvas(baseUrl: string, token: string, connector: string, window: SyncWindow, signal: AbortSignal): Promise<AgendaItem[]> {
  const base = new URL(baseUrl)
  const query = new URLSearchParams({ start_date: window.from.toISOString(), end_date: window.to.toISOString(), per_page: '100' })
  let url: string | undefined = new URL(`/api/v1/planner/items?${query.toString()}`, base).href
  const items: AgendaItem[] = []
  for (let page = 0; url !== undefined && page < MAX_PAGES; page += 1) {
    const response: Response = await fetch(url, { signal, headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
    if (response.status === 401) throw new Error('Canvas rejected the access token (HTTP 401)')
    if (!response.ok) throw new Error(`Canvas returned HTTP ${response.status}`)
    const parsed = z.array(PlannerItemSchema).safeParse(await response.json())
    if (!parsed.success) throw new Error(`unexpected Canvas planner response: ${parsed.error.issues[0]?.path.join('.') ?? 'body'}`)
    for (const entry of parsed.data) {
      const item = plannerItem(entry, connector, base.origin)
      if (item !== undefined) items.push(item)
    }
    url = nextPage(response.headers.get('link'), base.origin)
  }
  return items.sort((left, right) => left.start.localeCompare(right.start))
}
