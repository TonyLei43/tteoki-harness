/** Class page section: the class's transcribed lectures, master notes, latest quiz, and a study-plan chat. */

import { useEffect, useState } from 'react'
import type { LecturesStatus, Quiz } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-agenda/client'
import type { LecturesInjected } from './QuizWidget.tsx'
import css from './QuizWidget.module.css'

/** What the section adds to the quiz widget's face. */
export interface StudyInjected extends LecturesInjected {
  /**
   * Start a chat that plans what to study for a class.
   * @param course - the class code and title.
   * @param lectures - recent lecture titles with their days, newest first.
   */
  readonly studyPlan: (course: { readonly code: string; readonly name: string }, lectures: readonly string[]) => Promise<void>
}

/** Props the renderer binds for the section. */
export type StudySectionProps =
  PropsRuntime<'course.section'>
  & PropsLocale<'lectures'>
  & InjectFace<StudyInjected>

/** Lectures listed on the class page. */
const RECENT = 5

/**
 * The prompt a study-plan chat starts with.
 * @param course - the class code and title.
 * @param lectures - recent lecture titles with their days, newest first.
 * @returns the first user message.
 */
export function studyPrompt(course: { readonly code: string; readonly name: string }, lectures: readonly string[]): string {
  const label = course.name === '' ? course.code : `${course.code}: ${course.name}`
  return [
    `Help me decide what to study for ${label}.`,
    `Use the course tool for "${course.code}" to check upcoming deadlines and exams, and search my notes for this class.`,
    'Then give me a short, prioritized plan for this week: the lecture topics, definitions, theorems, and proofs to review for each upcoming deadline, and where each one is in my notes.',
    ...lectures.length === 0 ? [] : ['', 'My most recent lectures:', ...lectures.map(lecture => `- ${lecture}`)],
  ].join('\n')
}

/**
 * The Study card on a class page.
 * @param props - the class, locale, and the lectures face.
 * @returns the card.
 */
export function StudySection(props: StudySectionProps) {
  const { t, course } = props
  const [status, setStatus] = useState<LecturesStatus | undefined>()
  const [quizzes, setQuizzes] = useState<readonly Quiz[]>([])
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  useEffect(() => {
    let active = true
    Promise.all([props.status(), props.quizzes()]).then(
      ([nextStatus, nextQuizzes]) => { if (active) { setStatus(nextStatus); setQuizzes(nextQuizzes); setFailed(false) } },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [props.status, props.quizzes, course.code])
  const lectures = (status?.lectures ?? []).filter(lecture => lecture.course === course.code).slice(0, RECENT)
  const notes = status?.courses.find(entry => entry.course === course.code)
  const quiz = quizzes.find(entry => entry.course === course.code)
  const run = (key: string, action: () => Promise<void>): void => {
    setBusy(key)
    setError(undefined)
    action().catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setBusy(undefined) })
  }
  return (
    <article className={css.card} aria-label={t('study')}>
      <h2 className={css.cardTitle}>{t('study')}</h2>
      {failed ? <p className={css.muted}>{t('loadFailed')}</p> : null}
      {status !== undefined && lectures.length === 0 ? <p className={css.muted}>{t('noLectures')}</p> : null}
      {lectures.length === 0 ? null : (
        <ul className={css.pipeline}>
          {lectures.map(lecture => (
            <li key={lecture.id} className={css.lecture} title={lecture.notePath}>
              <span className={css.lectureTitle}>{lecture.title} · {lecture.created.slice(0, 10)}</span>
              <span className={css.stage} data-stage={lecture.stage} title={lecture.error}>{t(`stage.${lecture.stage}`)}</span>
            </li>
          ))}
        </ul>
      )}
      {notes === undefined ? null : (
        <p className={css.muted} title={notes.pdf ?? notes.master}>{t('masterNotes')}: {t('lectureCount').replace('{count}', String(notes.lectures))}</p>
      )}
      {quiz === undefined ? null : (
        <div className={css.head}>
          <div className={css.headText}>
            <p className={css.course}>{t('latestQuiz')}</p>
            <p className={css.muted}>{quiz.title} · {quiz.date} · {t('questionCount').replace('{count}', String(quiz.questions.length))}</p>
          </div>
          <button type="button" className={css.primary} disabled={busy !== undefined} onClick={() => { run('quiz', () => props.quizMe(quiz)) }}>
            {busy === 'quiz' ? t('starting') : t('quizMe')}
          </button>
        </div>
      )}
      <button
        type="button"
        className={css.link}
        disabled={busy !== undefined}
        onClick={() => { run('plan', () => props.studyPlan({ code: course.code, name: course.name }, lectures.map(lecture => `${lecture.title} (${lecture.created.slice(0, 10)})`))) }}
      >{busy === 'plan' ? t('starting') : t('studyPlan')}</button>
      {error === undefined ? null : <p className={css.danger}>{error}</p>}
    </article>
  )
}
