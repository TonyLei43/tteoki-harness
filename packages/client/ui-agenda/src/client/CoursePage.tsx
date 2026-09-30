/**
 * Class page: one class's next meeting and room, weekly schedule, exams,
 * assignments, and folders, followed by the `course.section` cards other
 * plugins add (lectures and study aids). Calendar items and assignments that
 * belong to a class open this page.
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AgendaItem, CourseConfig } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from './contract.ts'
import { clock, DAY, DONE_STATUSES, isExam, nextMeeting, relative, splitMeetings, weeklyMeetings } from './model.ts'
import type { AgendaInjected } from './model.ts'
import { fill } from './Widgets.tsx'
import css from './CoursePage.module.css'

/** Props the renderer binds for the page. */
export type CoursePageProps =
  PropsRuntime<'main'>
  & PropsRenderSlots<'course.section'>
  & PropsLocale<'agenda'>
  & InjectFace<AgendaInjected>

/** Days of agenda the page reads: two weeks back for overdue work, five weeks ahead. */
const PAST_DAYS = 14
const AHEAD_DAYS = 35

/**
 * Format a meeting day and time, such as `Wed, Sep 30, 10:00 AM`.
 * @param iso - ISO instant.
 * @returns the text.
 */
function when(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

/**
 * The class page.
 * @param props - locale, the agenda face, and the section renderer.
 * @returns the page.
 */
export function CoursePage(props: CoursePageProps) {
  const { t, renderSlot } = props
  const selected = useSyncExternalStore(props.selectedCourse.subscribe, props.selectedCourse.getSnapshot)
  const revision = useSyncExternalStore(props.revision.subscribe, props.revision.getSnapshot)
  const [courses, setCourses] = useState<readonly CourseConfig[] | undefined>()
  const [items, setItems] = useState<readonly AgendaItem[] | undefined>()
  const [failed, setFailed] = useState(false)
  const [now] = useState(() => Date.now())
  useEffect(() => {
    let active = true
    Promise.all([props.getSettings(), props.agenda(new Date(now - PAST_DAYS * DAY), new Date(now + AHEAD_DAYS * DAY))]).then(
      ([settings, agenda]) => { if (active) { setCourses(settings.courses); setItems(agenda); setFailed(false) } },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [props, now, revision])
  const course = courses?.find(entry => entry.code === selected) ?? courses?.[0]
  const mine = (items ?? []).filter(item => course !== undefined && item.courseCode === course.code)
  const events = mine.filter(item => item.kind === 'event')
  const { classes, other } = splitMeetings(events.filter(item => !isExam(item)))
  const next = nextMeeting(classes, now)
  const soon = (item: AgendaItem): boolean => new Date(item.start).getTime() >= now && new Date(item.start).getTime() < now + 14 * DAY
  const meetings = [...weeklyMeetings(classes.filter(soon)), ...weeklyMeetings(other.filter(soon))]
  const exams = mine.filter(item => isExam(item) && new Date(item.start).getTime() >= now)
  const open = mine.filter(item => item.kind === 'assignment' && !isExam(item) && !DONE_STATUSES.has(item.status ?? 'upcoming'))
  const overdue = open.filter(item => new Date(item.start).getTime() < now)
  const upcoming = open.filter(item => new Date(item.start).getTime() >= now)

  return (
    <div className={css.page}>
      <nav className={css.nav}>
        <button type="button" className={css.link} onClick={props.openHome}>{t('backHome')}</button>
        <div className={css.chips} role="tablist" aria-label={t('classes')}>
          {(courses ?? []).map(entry => (
            <button
              key={entry.code}
              type="button"
              role="tab"
              aria-selected={entry.code === course?.code}
              className={css.chip}
              onClick={() => { props.openCourse(entry.code) }}
            >{entry.code}</button>
          ))}
        </div>
      </nav>
      {failed ? <p className={css.muted}>{t('loadFailed')}</p> : null}
      {courses !== undefined && course === undefined ? <p className={css.muted}>{t('noCourses')}</p> : null}
      {course === undefined ? null : (
        <>
          <header className={css.header}>
            <h1 className={css.title}>{course.code}</h1>
            {course.name === '' ? null : <p className={css.subtitle}>{course.name}</p>}
            {(course.aliases ?? []).length === 0 ? null : <p className={css.muted}>{fill(t('alsoListed'), { codes: (course.aliases ?? []).join(', ') })}</p>}
          </header>
          <div className={css.grid}>
            <article className={css.card} aria-label={t('nextClass')}>
              <h2 className={css.cardTitle}>{t('nextClass')}</h2>
              {next === undefined
                ? <p className={css.muted}>{items === undefined ? t('loading') : t('noNextClass')}</p>
                : (
                  <div className={css.next}>
                    <p className={css.big}>{when(next.start)}</p>
                    <p className={css.muted}>{new Date(next.start).getTime() <= now ? t('inProgress') : relative(next.start, now)}</p>
                    {next.location === undefined ? null : <p className={css.where}>{next.location}</p>}
                  </div>
                )}
              {meetings.length === 0 ? null : (
                <div className={css.block}>
                  <h3 className={css.blockTitle}>{t('weekly')}</h3>
                  <ul className={css.list}>
                    {meetings.map(meeting => (
                      <li key={`${meeting.days.join()}${meeting.time}${meeting.location ?? ''}`} className={css.row}>
                        <span className={css.days}>{meeting.days.join(', ')}</span>
                        <span>{meeting.time}</span>
                        {meeting.title === undefined ? null : <span className={css.itemTitle}>{meeting.title}</span>}
                        {meeting.location === undefined ? null : <span className={css.muted}>{meeting.location}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
            <article className={css.card} aria-label={t('assignmentsWidget')}>
              <h2 className={css.cardTitle}>{t('assignmentsWidget')}</h2>
              {exams.length === 0 ? null : (
                <ul className={css.list}>
                  {exams.map(item => (
                    <li key={item.id} className={css.row}>
                      <span className={css.exam}>{t('exam')}</span>
                      <span className={css.itemTitle}>{item.title}</span>
                      <span className={css.muted}>{when(item.start)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {items !== undefined && open.length === 0 && exams.length === 0 ? <p className={css.muted}>{t('noAssignments')}</p> : null}
              <ul className={css.list}>
                {[...overdue, ...upcoming].map(item => (
                  <li key={item.id} className={css.row}>
                    <span className={new Date(item.start).getTime() < now ? `${css.due} ${css.danger}` : css.due}>{relative(item.start, now)}</span>
                    {item.url === undefined
                      ? <span className={css.itemTitle}>{item.title}</span>
                      : <a className={css.itemTitle} href={item.url} target="_blank" rel="noreferrer">{item.title}</a>}
                    <span className={css.muted}>{`${clock(item.start)}${item.points === undefined ? '' : ` · ${fill(t('points'), { points: String(item.points) })}`}`}</span>
                  </li>
                ))}
              </ul>
            </article>
            {renderSlot('course.section', { course, now })}
            {course.folders.length === 0 && course.knowledgeBase === undefined ? null : (
              <article className={css.card} aria-label={t('materials')}>
                <h2 className={css.cardTitle}>{t('materials')}</h2>
                <ul className={css.list}>
                  {course.folders.map(folder => <li key={folder} className={css.path} title={folder}>{folder}</li>)}
                </ul>
                {course.knowledgeBase === undefined ? null : <p className={css.muted}>{fill(t('linkedKb'), { kb: course.knowledgeBase })}</p>}
              </article>
            )}
          </div>
        </>
      )}
    </div>
  )
}
