/** Dashboard widget: a month, week, or day calendar over the connectors agenda. */

import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { AgendaItem } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, SegmentedControl,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { calendarWindow, clock, groupByDay, hourLabel, layoutDay, periodTitle, startOfDay, stepAnchor } from './model.ts'
import type { AgendaInjected, CalendarDay, CalendarView, DayItems } from './model.ts'
import type { AgendaWidgetProps } from './Widgets.tsx'
import { fill } from './Widgets.tsx'
import { OpenCourse } from './course-link.ts'
import css from './Calendar.module.css'

/** Stable id linking the Day/Week/Month tablist to the panel it switches. */
const VIEW_CONTROL_ID = 'agenda-calendar-view'

/** Hours of the day, in order. */
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

/** Pixel height of one hour row; matches `--cal-hour` in Calendar.module.css. */
const HOUR_HEIGHT = 32

/** Short weekday headers, Sunday first. */
const WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

/**
 * Load a calendar window and reload after every sync.
 * @param agenda - reads items overlapping the window.
 * @param revision - increments after every sync.
 * @param from - inclusive window start.
 * @param to - exclusive window end.
 * @returns the items (undefined while loading) and whether loading failed.
 */
function useWindow(
  agenda: AgendaInjected['agenda'],
  revision: AgendaInjected['revision'],
  from: number,
  to: number,
): { items: readonly AgendaItem[] | undefined; failed: boolean } {
  const version = useSyncExternalStore(
    listener => revision.subscribe(listener),
    () => revision.getSnapshot(),
  )
  const [items, setItems] = useState<readonly AgendaItem[] | undefined>()
  const [failed, setFailed] = useState(false)
  const latest = useRef(agenda)
  latest.current = agenda
  useEffect(() => {
    let active = true
    latest.current(new Date(from), new Date(to)).then(
      (value) => { if (active) { setItems(value); setFailed(false) } },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [version, from, to])
  return { items, failed }
}

/**
 * One calendar item as a compact pill, linking to its source when it has one.
 * @param props.item - the item.
 * @returns the pill.
 */
function Pill({ item }: { item: AgendaItem }) {
  const openCourse = useContext(OpenCourse)
  const code = item.courseCode
  if (openCourse !== undefined && code !== undefined && item.kind === 'event') {
    return <button type="button" className={css.pill} data-kind={item.kind} title={item.title} onClick={() => { openCourse(code) }}>{item.title}</button>
  }
  return item.url === undefined
    ? <span className={css.pill} data-kind={item.kind} title={item.title}>{item.title}</span>
    : <a className={css.pill} data-kind={item.kind} title={item.title} href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
}

/**
 * One timed item as a positioned block in an hour column.
 * @param props.startMinute - minutes from midnight.
 * @param props.endMinute - minutes from midnight.
 * @param props.lane - column index within the overlap cluster.
 * @param props.lanes - columns in the overlap cluster.
 * @param props.item - the item.
 * @returns the block.
 */
function EventBlock({ item, startMinute, endMinute, lane, lanes }: {
  item: AgendaItem
  startMinute: number
  endMinute: number
  lane: number
  lanes: number
}) {
  const style = {
    '--cal-start': String(startMinute),
    '--cal-end': String(endMinute),
    '--cal-lane': String(lane),
    '--cal-lanes': String(lanes),
  } as CSSProperties
  const body = (
    <>
      <span className={css.blockTime}>{clock(item.start)}</span>
      <span className={css.blockTitle}>{item.title}</span>
    </>
  )
  const openCourse = useContext(OpenCourse)
  const code = item.courseCode
  if (openCourse !== undefined && code !== undefined && item.kind === 'event') {
    return <button type="button" className={css.block} data-kind={item.kind} style={style} title={item.title} onClick={() => { openCourse(code) }}>{body}</button>
  }
  return item.url === undefined
    ? <span className={css.block} data-kind={item.kind} style={style} title={item.title}>{body}</span>
    : <a className={css.block} data-kind={item.kind} style={style} href={item.url} target="_blank" rel="noreferrer" title={item.title}>{body}</a>
}

/**
 * The month grid: one cell per day with its items.
 * @param props.t - locale binding.
 * @param props.days - the grid days.
 * @param props.grouped - items by day key.
 * @returns the month body.
 */
function MonthGrid({ t, days, grouped }: {
  t: AgendaWidgetProps['t']
  days: readonly CalendarDay[]
  grouped: Map<string, DayItems>
}) {
  return (
    <div className={css.month}>
      <div className={css.weekRow}>
        {days.slice(0, 7).map(day => <span key={day.key} className={css.weekday}>{WEEKDAY_FORMAT.format(new Date(day.time))}</span>)}
      </div>
      <div className={css.monthGrid}>
        {days.map((day) => {
          const entries = [...(grouped.get(day.key)?.allDay ?? []), ...(grouped.get(day.key)?.timed ?? [])]
          return (
            <div key={day.key} className={`${css.monthCell}${day.inMonth ? '' : ` ${css.outside}`}`} data-today={day.today || undefined}>
              <span className={css.monthDay} data-today={day.today || undefined}>{new Date(day.time).getDate()}</span>
              <ul className={css.pills}>
                {entries.slice(0, 3).map(item => <li key={item.id}><Pill item={item} /></li>)}
                {entries.length > 3 ? <li className={css.more}>{fill(t('moreEvents'), { count: String(entries.length - 3) })}</li> : null}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The day and week body: an all-day row over a scrollable hour grid.
 * @param props.t - locale binding.
 * @param props.days - the columns, one per day.
 * @param props.grouped - items by day key.
 * @param props.now - the current time.
 * @returns the time-grid body.
 */
function TimeGrid({ t, days, grouped, now }: {
  t: AgendaWidgetProps['t']
  days: readonly CalendarDay[]
  grouped: Map<string, DayItems>
  now: number
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const nowMinute = Math.round((now - startOfDay(now)) / 60_000)
  const hasAllDay = days.some(day => (grouped.get(day.key)?.allDay.length ?? 0) > 0)
  // Open on the first event rather than midnight; a dashboard card is too short
  // to scroll to the current hour and still show the day's events.
  const starts = days.flatMap(day => (grouped.get(day.key)?.timed ?? []).map(item => new Date(item.start).getTime()))
  const scrollHour = starts.length === 0 ? 8 : Math.max(0, new Date(Math.min(...starts)).getHours() - 1)
  useEffect(() => {
    const root = scroller.current
    /* v8 ignore next -- the ref is attached to the always-rendered scroller before the effect runs. */
    if (root === null) return
    root.scrollTop = scrollHour * HOUR_HEIGHT
  }, [scrollHour])
  return (
    <div className={css.time} style={{ '--cal-days': String(days.length) } as CSSProperties}>
      <div className={css.head}>
        <span />
        {days.map(day => (
          <div key={day.key} className={css.headDay}>
            <span className={css.headWeekday}>{WEEKDAY_FORMAT.format(new Date(day.time))}</span>
            <span className={css.headNumber} data-today={day.today || undefined}>{new Date(day.time).getDate()}</span>
          </div>
        ))}
      </div>
      {hasAllDay ? (
        <div className={css.allDayRow}>
          <span className={css.allDayLabel}>{t('allDay')}</span>
          {days.map(day => (
            <div key={day.key} className={css.allDayCell}>
              {(grouped.get(day.key)?.allDay ?? []).map(item => <Pill key={item.id} item={item} />)}
            </div>
          ))}
        </div>
      ) : null}
      <div className={css.hours} ref={scroller}>
        <div className={css.inner}>
          <div className={css.hourLabels}>
            {HOURS.map(hour => <span key={hour} className={css.hourLabel}>{hourLabel(hour)}</span>)}
          </div>
          {days.map(day => (
            <div key={day.key} className={css.column}>
              {HOURS.map(hour => <span key={hour} className={css.slot} aria-hidden="true" />)}
              {day.today ? <span className={css.nowLine} style={{ '--cal-now': String(nowMinute) } as CSSProperties} aria-hidden="true" /> : null}
              {layoutDay(grouped.get(day.key)?.timed ?? [], day.time).map(placement => (
                <EventBlock
                  key={placement.item.id}
                  item={placement.item}
                  startMinute={placement.startMinute}
                  endMinute={placement.endMinute}
                  lane={placement.lane}
                  lanes={placement.lanes}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The Calendar dashboard widget: a period heading, Day/Week/Month switch, and the grid.
 * @param props - clock, locale, and the agenda face.
 * @returns the widget body.
 */
export function CalendarWidget(props: AgendaWidgetProps) {
  const { t, now } = props
  const [view, setView] = useState<CalendarView>('month')
  const [anchor, setAnchor] = useState(() => startOfDay(now))
  const window = calendarWindow(view, anchor, now)
  const { items, failed } = useWindow(props.agenda, props.revision, window.from, window.to)
  const grouped = groupByDay(items ?? [], window.days)
  const message = failed ? t('loadFailed') : items !== undefined && items.length === 0 ? t('calendarEmpty') : undefined
  return (
    <OpenCourse.Provider value={props.openCourse}>
    <div className={css.calendar}>
      <div className={css.topbar}>
        <div className={css.nav}>
          <Button variant="ghost" size="sm" className={css.navButton} aria-label={t('previous')} icon={<IconChevronLeftOutlineRegular size={16} />} onClick={() => { setAnchor(stepAnchor(view, anchor, -1)) }} />
          <Button variant="ghost" size="sm" className={css.navButton} aria-label={t('next')} icon={<IconChevronRightOutlineRegular size={16} />} onClick={() => { setAnchor(stepAnchor(view, anchor, 1)) }} />
          <Button variant="ghost" size="sm" className={css.todayButton} onClick={() => { setAnchor(startOfDay(now)) }}>{t('todayButton')}</Button>
          <p className={css.period}>{periodTitle(view, anchor)}</p>
        </div>
        <SegmentedControl
          id={VIEW_CONTROL_ID}
          value={view}
          options={[
            { value: 'day' as const, label: t('viewDay') },
            { value: 'week' as const, label: t('viewWeek') },
            { value: 'month' as const, label: t('viewMonth') },
          ]}
          onChange={setView}
          label={t('viewLabel')}
          className={css.switch}
        />
      </div>
      <div id={`${VIEW_CONTROL_ID}-${view}-panel`} role="tabpanel" aria-labelledby={`${VIEW_CONTROL_ID}-${view}`} className={css.body}>
        {message === undefined ? null : <p className={css.muted}>{message}</p>}
        {view === 'month'
          ? <MonthGrid t={t} days={window.days} grouped={grouped} />
          : <TimeGrid t={t} days={window.days} grouped={grouped} now={now} />}
      </div>
    </div>
    </OpenCourse.Provider>
  )
}
