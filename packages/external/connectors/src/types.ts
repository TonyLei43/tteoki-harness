/** Wire vocabulary for the `connectors` Remote namespace: connector settings, sync status, and the agenda. */

/** Whether an agenda item is a timed event or a deliverable with a due date. */
export type AgendaKind = 'event' | 'assignment'

/** Where an assignment stands, as the source reports it. */
export type AssignmentStatus = 'upcoming' | 'submitted' | 'graded' | 'missing' | 'late' | 'excused'

/** One calendar event occurrence or one assignment. */
export interface AgendaItem {
  /** Stable id: connector id, source uid, and occurrence start. */
  readonly id: string
  /** Connector that produced the item. */
  readonly source: string
  readonly kind: AgendaKind
  readonly title: string
  /** Start (events) or due time (assignments), ISO 8601 in UTC. */
  readonly start: string
  /** End of an event, ISO 8601 in UTC. */
  readonly end?: string
  /** Whether the item spans whole days rather than a time range. */
  readonly allDay: boolean
  /** Course display label (`STAT 534: Statistical Computing`) or calendar name. */
  readonly course?: string
  /** Course code, such as `STAT 534`, when the item belongs to a course. */
  readonly courseCode?: string
  readonly location?: string
  /** Link to the item at its source. */
  readonly url?: string
  /** Plain-text description, cut to 2000 characters. */
  readonly description?: string
  /** Assignment status; absent for events. */
  readonly status?: AssignmentStatus
  /** Points possible, when the source reports them. */
  readonly points?: number
}

/** Which provider a connector uses. */
export type ConnectorKind = 'ics' | 'canvas'

/** One configured connector. */
export interface ConnectorConfig {
  /** Stable id: letters, digits, `-`, `_`. */
  readonly id: string
  readonly kind: ConnectorKind
  /** Display name; also the course or calendar label of items without one. */
  readonly name: string
  readonly enabled: boolean
  /**
   * Credential reference (an environment-variable-style name) holding the
   * connector's secret: the private ICS address for `ics`, the access token
   * for `canvas`. Set its value with `setSecret`; it never appears in settings.
   */
  readonly secret: string
  /** Canvas instance base URL, such as `https://canvas.uw.edu`; `canvas` only. */
  readonly baseUrl?: string
}

/** One class: how it is labeled and which knowledge it links to. */
export interface CourseConfig {
  /** Course code, such as `STAT 534` or `STAT 536/427`; the course's identity. */
  readonly code: string
  /** Course title shown after the code, such as `Statistical Computing`. */
  readonly name: string
  /**
   * Other codes this course appears under, such as a cross-listing (`BIOST 583`)
   * or Canvas's combined code (`STAT 536/427`); items under an alias are labeled with `code`.
   */
  readonly aliases?: readonly string[]
  /** Knowledge base holding this course's material. */
  readonly knowledgeBase?: string
  /** Folders with this course's material inside that knowledge base; scope course search and syllabus scans. */
  readonly folders: readonly string[]
}

/** Mutable connector settings, stored under the harness home. */
export interface ConnectorSettings {
  readonly connectors: readonly ConnectorConfig[]
  /** Classes, detected from Canvas or added by hand, with their labels and links. */
  readonly courses: readonly CourseConfig[]
  /** Days before today kept in the agenda. */
  readonly pastDays: number
  /** Days after today synced into the agenda. */
  readonly horizonDays: number
  /** Minutes between automatic syncs; 0 disables automatic sync. */
  readonly syncMinutes: number
  /** Folder receiving the generated `Agenda.md` note; absent disables the note. */
  readonly notesDir?: string
}

/** Partial settings update; `notesDir: null` removes the note folder. */
export interface ConnectorSettingsUpdate {
  readonly connectors?: readonly ConnectorConfig[]
  readonly courses?: readonly CourseConfig[]
  readonly pastDays?: number
  readonly horizonDays?: number
  readonly syncMinutes?: number
  readonly notesDir?: string | null
}

/** Result of one connector's last sync. */
export interface ConnectorStatus {
  readonly id: string
  /** Last attempt, epoch milliseconds. */
  readonly syncedAt: number
  /** Items the connector contributed. */
  readonly items: number
  /** Why the last attempt failed; absent on success. */
  readonly error?: string
  /** Whether the connector's credential currently resolves to a value. */
  readonly configured: boolean
}

/** Overall sync status. */
export interface ConnectorsStatus {
  readonly connectors: readonly ConnectorStatus[]
  /** Last completed sync, epoch milliseconds; absent before the first. */
  readonly syncedAt?: number
}

/** Agenda query. */
export interface AgendaRequest {
  /** Inclusive lower bound, ISO 8601; defaults to the start of today. */
  readonly from?: string
  /** Exclusive upper bound, ISO 8601; defaults to `from` plus 14 days. */
  readonly to?: string
  /** Only these kinds. */
  readonly kinds?: readonly AgendaKind[]
}

/** Stores one connector secret. */
export interface SecretRequest {
  /** Connector whose credential reference receives the value. */
  readonly connector: string
  /** The secret value. */
  readonly value: string
}
