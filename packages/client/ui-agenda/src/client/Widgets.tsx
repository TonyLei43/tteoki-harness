/** Dashboard widgets: upcoming events and assignments due. */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AgendaItem } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-dashboard/client'
import type { AgendaLocaleKey } from './locales.ts'
import { byDay, clock, DAY, dayHeading, DONE_STATUSES, relative } from './model.ts'
import type { AgendaInjected } from './model.ts'
import css from './Widgets.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agenda widgets and panel copy. */
    agenda: AgendaLocaleKey
  }
}

/** Props the renderer binds for either widget. */
export type AgendaWidgetProps =
  PropsRuntime<'dashboard.widget'>
  & PropsLocale<'agenda'>
  & InjectFace<AgendaInjected>

/**
 * Fill `{name}` placeholders in a translated string.
 * @param template - translated text.
 * @param values - placeholder values.
 * @returns the filled text.
 */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match)
}

/**
 * Load a window of items and reload after every sync.
 * @param face - the agenda face.
 * @param load - reads the items.
 * @returns the items (undefined while loading) and whether loading failed.
 */
function useItems(face: AgendaInjected, load: () => Promise<readonly AgendaItem[]>): { items: readonly AgendaItem[] | undefined; failed: boolean } {
  const revision = useSyncExternalStore(face.revision.subscribe, face.revision.getSnapshot)
  const [items, setItems] = useState<readonly AgendaItem[] | undefined>()
  const [failed, setFailed] = useState(false)
  const latest = useRef(load)
  latest.current = load
  useEffect(() => {
    let active = true
    latest.current().then(
      (value) => { if (active) { setItems(value); setFailed(false) } },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [revision])
  return { items, failed }
}

/**
 * The widget footer: last sync and a sync button, or the setup action when nothing is connected.
 * @param props - locale, face, clock, and whether the widget has anything to show.
 * @returns the footer.
 */
function Footer({ t, face, now, empty }: { t: AgendaWidgetProps['t']; face: AgendaInjected; now: number; empty: boolean }) {
  const [syncedAt, setSyncedAt] = useState<number | undefined>()
  const [connected, setConnected] = useState(true)
  const [busy, setBusy] = useState(false)
  const revision = useSyncExternalStore(face.revision.subscribe, face.revision.getSnapshot)
  useEffect(() => {
    face.status().then((status) => { setSyncedAt(status.syncedAt); setConnected(status.connectors.length > 0) }, () => {})
  }, [face, revision])
  if (!connected && empty) {
    return <button type="button" className={css.link} onClick={face.openPanel}>{t('setUp')}</button>
  }
  return (
    <div className={css.footer}>
      <span>{syncedAt === undefined ? t('neverSynced') : fill(t('syncedAt'), { time: relative(syncedAt, now) })}</span>
      <button type="button" className={css.link} disabled={busy} onClick={() => {
        setBusy(true)
        face.sync().catch(() => {}).finally(() => { setBusy(false) })
      }}>{busy ? t('syncing') : t('syncNow')}</button>
    </div>
  )
}

/**
 * Upcoming events for the next seven days, grouped by day.
 * @param props - clock, locale, and the agenda face.
 * @returns the widget body.
 */
export function UpcomingWidget(props: AgendaWidgetProps) {
  const { t, now } = props
  const { items, failed } = useItems(props, () => props.agenda(new Date(now), new Date(now + 7 * DAY), ['event']))
  const labels = { today: t('today'), tomorrow: t('tomorrow') }
  return (
    <div className={css.widget}>
      {failed ? <p className={css.muted}>{t('loadFailed')}</p> : null}
      {items !== undefined && items.length === 0 ? <p className={css.muted}>{t('noEvents')}</p> : null}
      {byDay((items ?? []).slice(0, 12)).map(group => (
        <div key={group.key} className={css.day}>
          <p className={css.dayHeading}>{dayHeading(group.key, now, labels)}</p>
          <ul className={css.list}>
            {group.items.map(item => (
              <li key={item.id} className={css.row}>
                <span className={css.time}>{item.allDay ? t('allDay') : clock(item.start)}</span>
                <span className={css.main}>
                  {item.courseCode === undefined
                    ? <span className={css.title}>{item.title}</span>
                    : <button type="button" className={`${css.title} ${css.classLink}`} title={fill(t('openClass'), { course: item.courseCode })} onClick={() => { props.openCourse(item.courseCode ?? '') }}>{item.title}</button>}
                  {item.location === undefined ? null : <span className={css.muted}>{item.location}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Footer t={t} face={props} now={now} empty={items?.length === 0} />
    </div>
  )
}

/**
 * Assignments: overdue work first, then upcoming deadlines; finished work is counted.
 * @param props - clock, locale, and the agenda face.
 * @returns the widget body.
 */
export function AssignmentsWidget(props: AgendaWidgetProps) {
  const { t, now } = props
  const { items, failed } = useItems(props, () => props.agenda(new Date(now - 14 * DAY), new Date(now + 21 * DAY), ['assignment']))
  const all = items ?? []
  const open = all.filter(item => !DONE_STATUSES.has(item.status ?? 'upcoming'))
  const overdue = open.filter(item => new Date(item.start).getTime() < now)
  const upcoming = open.filter(item => new Date(item.start).getTime() >= now)
  const done = all.filter(item => DONE_STATUSES.has(item.status ?? 'upcoming') && new Date(item.start).getTime() >= now)
  const row = (item: AgendaItem, late: boolean) => (
    <li key={item.id} className={css.row}>
      <span className={late ? `${css.time} ${css.danger}` : css.time}>{relative(item.start, now)}</span>
      <span className={css.main}>
        {item.url === undefined
          ? <span className={css.title}>{item.title}</span>
          : <a className={css.title} href={item.url} target="_blank" rel="noreferrer">{item.title}</a>}
        <span className={css.muted}>
          {item.courseCode === undefined ? null : <button type="button" className={css.courseLink} onClick={() => { props.openCourse(item.courseCode ?? '') }}>{item.course}</button>}
          {item.courseCode === undefined || item.points === undefined ? null : ' · '}
          {[item.courseCode === undefined ? item.course : undefined, item.points === undefined ? undefined : fill(t('points'), { points: String(item.points) })].filter(part => part !== undefined).join(' · ')}
        </span>
      </span>
      {item.status === undefined || item.status === 'upcoming' ? null : <span className={css.chip} data-status={item.status}>{t(`status.${item.status}`)}</span>}
    </li>
  )
  return (
    <div className={css.widget}>
      {failed ? <p className={css.muted}>{t('loadFailed')}</p> : null}
      {items !== undefined && open.length === 0 ? <p className={css.muted}>{t('noAssignments')}</p> : null}
      {overdue.length > 0 ? (
        <div className={css.day}>
          <p className={`${css.dayHeading} ${css.danger}`}>{t('overdue')}</p>
          <ul className={css.list}>{overdue.map(item => row(item, true))}</ul>
        </div>
      ) : null}
      {upcoming.length > 0 ? <ul className={css.list}>{upcoming.slice(0, 10).map(item => row(item, false))}</ul> : null}
      {done.length > 0 ? <p className={css.muted}>{fill(t('done'), { count: String(done.length) })}</p> : null}
      <Footer t={t} face={props} now={now} empty={items?.length === 0} />
    </div>
  )
}
