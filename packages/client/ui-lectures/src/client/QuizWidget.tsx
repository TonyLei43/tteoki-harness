/** Home dashboard widget: lectures in the pipeline and the latest end-of-lecture quiz. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Lecture, LecturesStatus, Quiz } from '@deepseek-ai/dsh-api-remotes/client'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-dashboard/client'
import type { LecturesLocaleKey } from './locales.ts'
import css from './QuizWidget.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Lecture quiz widget copy. */
    lectures: LecturesLocaleKey
  }
}

/** What the widget reads and does through the `lectures` namespace. */
export interface LecturesInjected {
  /** @returns the pipeline status. */
  readonly status: () => Promise<LecturesStatus>
  /** @returns recent quizzes, most recent lecture first. */
  readonly quizzes: () => Promise<readonly Quiz[]>
  /**
   * Transcribe a lecture and write its quiz now.
   * @param id - lecture id.
   * @returns the quiz.
   */
  readonly process: (id: string) => Promise<Quiz>
  /**
   * Start a chat session that asks the quiz's questions one at a time.
   * @param quiz - the quiz.
   */
  readonly quizMe: (quiz: Quiz) => Promise<void>
}

/** Props the renderer binds for the widget. */
export type QuizWidgetProps =
  PropsRuntime<'dashboard.widget'>
  & PropsLocale<'lectures'>
  & InjectFace<LecturesInjected>

/** Stages still moving through the pipeline. */
const ACTIVE = new Set<Lecture['stage']>(['waiting', 'transcribing', 'ready', 'quizzing', 'failed'])

/**
 * The quiz prompt a Quiz me session starts with.
 * @param quiz - the quiz.
 * @returns the first user message.
 */
export function quizPrompt(quiz: Quiz): string {
  return [
    `Quiz me on ${quiz.courseLabel}, lecture "${quiz.title}" (${quiz.date}).`,
    'Ask one question at a time and wait for my answer. Grade it against the reference answer and my lecture notes, point out what I missed, then ask the next question. Do not show a reference answer before I answer. After the last question, summarize what I should review.',
    `My notes for this lecture: ${quiz.notePath}`,
    '',
    ...quiz.questions.flatMap((question, index) => [`${index + 1}. [${question.kind}] ${question.prompt}`, `   Reference answer: ${question.answer.replace(/\n/g, '\n   ')}`]),
  ].join('\n')
}

/**
 * Lectures in progress, then the selected quiz with folded answers.
 * @param props - locale and the lectures face.
 * @returns the widget body.
 */
export function QuizWidget(props: QuizWidgetProps) {
  const { t } = props
  const [status, setStatus] = useState<LecturesStatus | undefined>()
  const [quizzes, setQuizzes] = useState<readonly Quiz[] | undefined>()
  const [failed, setFailed] = useState(false)
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  const [busy, setBusy] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const labels = useMemo(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: { codeLabel: t('codeBlock'), wrapLabel: t('wrap'), unwrapLabel: t('unwrap') } },
    footnotes: t('footnotes'),
  }), [t])
  const load = useCallback(() => {
    Promise.all([props.status(), props.quizzes()]).then(([nextStatus, nextQuizzes]) => {
      setStatus(nextStatus)
      setQuizzes(nextQuizzes)
      setFailed(false)
    }, () => { setFailed(true) })
  }, [props])
  useEffect(() => {
    load()
    const timer = setInterval(load, 30_000)
    return () => { clearInterval(timer) }
  }, [load])
  const run = (key: string, action: () => Promise<unknown>): void => {
    setBusy(key)
    setError(undefined)
    action().then(() => { load() }, (reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setBusy(undefined) })
  }
  const quiz = quizzes?.[index]
  const active = (status?.lectures ?? []).filter(lecture => ACTIVE.has(lecture.stage)).slice(0, 4)
  return (
    <div className={css.widget}>
      {failed ? <p className={css.muted}>{t('loadFailed')}</p> : null}
      {status !== undefined && !status.enabled ? <p className={css.muted}>{t('off')}</p> : null}
      {status?.error === undefined ? null : <p className={css.danger}>{status.error}</p>}
      {active.length > 0 ? (
        <ul className={css.pipeline}>
          {active.map(lecture => (
            <li key={lecture.id} className={css.lecture}>
              <span className={css.lectureTitle}>{lecture.course} · {lecture.title}</span>
              <span className={css.stage} data-stage={lecture.stage} title={lecture.error}>{t(`stage.${lecture.stage}`)}</span>
              {lecture.stage === 'waiting' || lecture.stage === 'ready' || lecture.stage === 'failed' ? (
                <button type="button" className={css.link} disabled={busy !== undefined} onClick={() => { run(lecture.id, () => props.process(lecture.id)) }}>
                  {busy === lecture.id ? t('working') : t('quizNow')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {(status?.courses ?? []).length > 0 ? (
        <div className={css.notes}>
          <p className={css.heading}>{t('masterNotes')}</p>
          <ul className={css.pipeline}>
            {(status?.courses ?? []).map(course => (
              <li key={course.course} className={css.lecture} title={course.pdf ?? course.master}>
                <span className={css.lectureTitle}>{course.name === '' ? course.course : `${course.course}: ${course.name}`}</span>
                {course.error === undefined
                  ? <span className={css.stage}>{t('lectureCount').replace('{count}', String(course.lectures))}</span>
                  : <span className={css.stage} data-stage="failed" title={course.error}>{t('stage.failed')}</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error === undefined ? null : <p className={css.danger}>{error}</p>}
      {quizzes !== undefined && quizzes.length === 0 && status?.enabled === true ? <p className={css.muted}>{t('noQuiz')}</p> : null}
      {quiz === undefined ? null : (
        <section className={css.quiz} aria-label={`${quiz.courseLabel} — ${quiz.title}`}>
          <header className={css.head}>
            <div className={css.headText}>
              <p className={css.course}>{quiz.courseLabel}</p>
              <p className={css.muted}>{quiz.title} · {quiz.date}</p>
            </div>
            <button type="button" className={css.primary} disabled={busy !== undefined} onClick={() => { run('quiz-me', () => props.quizMe(quiz)) }}>
              {busy === 'quiz-me' ? t('starting') : t('quizMe')}
            </button>
          </header>
          <ol className={css.questions}>
            {quiz.questions.map((question, position) => (
              <li key={position} className={css.question}>
                <span className={css.kind} data-kind={question.kind}>{t(`kind.${question.kind}`)}</span>
                <MarkdownText text={question.prompt} labels={labels} variant="compact" />
                <button type="button" className={css.link} onClick={() => {
                  setOpen((current) => {
                    const next = new Set(current)
                    if (next.has(position)) next.delete(position)
                    else next.add(position)
                    return next
                  })
                }}>{open.has(position) ? t('hideAnswer') : t('showAnswer')}</button>
                {open.has(position) ? <div className={css.answer}><MarkdownText text={question.answer} labels={labels} variant="compact" /></div> : null}
              </li>
            ))}
          </ol>
          <footer className={css.footer}>
            <button type="button" className={css.link} disabled={index + 1 >= (quizzes?.length ?? 0)} onClick={() => { setIndex(index + 1); setOpen(new Set()) }}>{t('older')}</button>
            <button type="button" className={css.link} disabled={index === 0} onClick={() => { setIndex(index - 1); setOpen(new Set()) }}>{t('newer')}</button>
          </footer>
        </section>
      )}
    </div>
  )
}
