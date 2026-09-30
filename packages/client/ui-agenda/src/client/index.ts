/**
 * Agenda, browser half: three home-dashboard widgets (upcoming events, a
 * day/week/month calendar, and assignments due), and the Agenda main panel with
 * its sidebar entry for connectors, secrets, the Obsidian note folder, and the
 * full agenda, and a class page (next class, room, schedule, assignments, and
 * the `course.section` cards other plugins add) that class items open, all
 * over the `connectors` Remote namespace.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the slot registry merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the layout SlotMap merge (the 'main' keyed slot), its ids, and ctx.layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the sidebar's SlotMap merge (the 'sidebar.panellist' list).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: the dashboard's SlotMap merge (the 'dashboard.widget' list).
import type {} from '@deepseek-ai/dsh-client-ui-dashboard/client'
// Type-only: the ctx.remote merge and the connectors wire vocabulary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { AgendaPanel } from './AgendaPanel.tsx'
import { CoursePage } from './CoursePage.tsx'
import { AgendaPanelIcon } from './AgendaPanelIcon.tsx'
import { CalendarWidget } from './CalendarWidget.tsx'
import { en } from './locales.ts'
import type { AgendaInjected } from './model.ts'
import { AssignmentsWidget, UpcomingWidget } from './Widgets.tsx'

export { connectorIdentity } from './AgendaPanel.tsx'
export type { AgendaPanelProps } from './AgendaPanel.tsx'
export type { CoursePageProps } from './CoursePage.tsx'
export type { CourseSectionOwnerProps } from './contract.ts'
export { OpenCourse } from './course-link.ts'
export { byDay, clock, dayHeading, dayKey, isExam, nextMeeting, relative, splitMeetings, weeklyMeetings } from './model.ts'
export type { Meeting } from './model.ts'
export type { AgendaInjected } from './model.ts'
export type { AgendaWidgetProps } from './Widgets.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'agenda'

/** The id shared by the sidebar entry and the main panel it opens. */
const PANEL_ID = 'agenda' as MainPanelId

/** The class page's main panel id; it has no sidebar entry and opens from class items. */
const COURSE_PANEL_ID = 'course' as MainPanelId

/** Home's main panel id, the class page's way back. */
const HOME_PANEL_ID = 'home' as MainPanelId

/** Required services. */
export const inject = ['slots', 'locale', 'layout', 'remote', 'remote.connectors', 'remote.memory']

/**
 * Unwrap a Remote result.
 * @param method - method name for the failure message.
 * @param result - the Remote call result.
 * @returns the success value.
 * @throws Error carrying the Remote error's message on failure.
 */
function unwrap<T>(method: string, result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`connectors/${method}: ${result.error.message}`)
  return result.value
}

/**
 * Mount the agenda widgets, panel, and sidebar entry.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, 'en', en), 'ui-agenda: dictionary')
  const revision = createSnapshotStore(0)
  const selectedCourse = createSnapshotStore<string | undefined>(undefined)
  const face: AgendaInjected = {
    agenda: async (from, to, kinds) => unwrap('agenda', await ctx.remote.connectors.agenda({ from: from.toISOString(), to: to.toISOString(), ...kinds === undefined ? {} : { kinds } })).items,
    status: async () => unwrap('status', await ctx.remote.connectors.status()),
    sync: async () => {
      const status = unwrap('sync', await ctx.remote.connectors.sync({}))
      revision.set(revision.getSnapshot() + 1)
      return status
    },
    getSettings: async () => unwrap('getSettings', await ctx.remote.connectors.getSettings()),
    setSettings: async update => unwrap('setSettings', await ctx.remote.connectors.setSettings(update)),
    setSecret: async (connector, value) => { unwrap('setSecret', await ctx.remote.connectors.setSecret({ connector, value })) },
    knowledgeBases: async () => {
      const result = await ctx.remote.memory.getSettings()
      // Knowledge bases are optional for the agenda: an unavailable memory service lists none.
      return result.ok ? result.value.collections.map(collection => ({ id: collection.id, name: collection.name })) : []
    },
    openPanel: () => { ctx.layout.selectPanel(PANEL_ID) },
    openCourse: (code) => {
      selectedCourse.set(code)
      ctx.layout.selectPanel(COURSE_PANEL_ID)
    },
    selectedCourse,
    openHome: () => { ctx.layout.selectPanel(HOME_PANEL_ID) },
    revision,
  }
  ctx.slots.inject('dashboard.widget', function* () {
    yield ctx.slots.register({ name: 'dashboard.widget', id: 'agenda.calendar', order: 5, locale: NS, label: () => t('calendarWidget'), inject: () => face }, CalendarWidget)
    yield ctx.slots.register({ name: 'dashboard.widget', id: 'agenda.upcoming', order: 10, locale: NS, label: () => t('upcomingWidget'), inject: () => face }, UpcomingWidget)
    yield ctx.slots.register({ name: 'dashboard.widget', id: 'agenda.assignments', order: 20, locale: NS, label: () => t('assignmentsWidget'), inject: () => face }, AssignmentsWidget)
  })
  ctx.slots.inject('main', function* () {
    yield ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => face }, AgendaPanel)
    yield ctx.slots.register({
      name: 'main',
      key: COURSE_PANEL_ID,
      locale: NS,
      children: { 'course.section': { kind: 'list', scope: 'root' } },
      inject: () => face,
    }, CoursePage)
  })
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 12,
    locale: NS,
    label: () => t('nav'),
  }, AgendaPanelIcon))
}
