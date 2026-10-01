/** The Agenda panel's Courses section: class names and their knowledge-base and folder links. */

import { useEffect, useState } from 'react'
import type { CourseConfig } from '@deepseek-ai/dsh-api-remotes/client'
import type { AgendaPanelProps } from './AgendaPanel.tsx'
import css from './AgendaPanel.module.css'

/** Props for {@link CoursesSection}. */
export interface CoursesSectionProps {
  readonly t: AgendaPanelProps['t']
  /** Stored courses. */
  readonly courses: readonly CourseConfig[]
  /** Knowledge bases a course can link to. */
  readonly knowledgeBases: readonly { readonly id: string; readonly name: string }[]
  /** Whether another action is running. */
  readonly busy: boolean
  /**
   * Save the edited course list.
   * @param courses - every course.
   */
  readonly onSave: (courses: readonly CourseConfig[]) => Promise<void>
}

/**
 * Edit course names, aliases, knowledge bases, and folders, saved together.
 * @param props - stored courses, link targets, and the save action.
 * @returns the section.
 */
export function CoursesSection({ t, courses, knowledgeBases, busy, onSave }: CoursesSectionProps) {
  const [draft, setDraft] = useState<readonly CourseConfig[]>(courses)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setDraft(courses) }, [courses])
  const edit = (code: string, patch: Partial<CourseConfig>): void => {
    setDraft(draft.map(course => course.code === code ? { ...course, ...patch } : course))
    setSaved(false)
  }
  const changed = JSON.stringify(draft) !== JSON.stringify(courses)
  return (
    <section className={css.section}>
      <h2 className={css.subtitle}>{t('coursesTitle')}</h2>
      <p className={css.caption}>{t('coursesHint')}</p>
      {draft.length === 0 ? <p className={css.caption}>{t('noCourses')}</p> : null}
      <ul className={css.connectors}>
        {draft.map(course => (
          <li key={course.code} className={css.connector}>
            <div className={css.row}>
              <span className={css.badge}>{course.code}</span>
              <input
                className={css.input}
                aria-label={`${t('courseName')}: ${course.code}`}
                placeholder={t('courseName')}
                value={course.name}
                onChange={(event) => { edit(course.code, { name: event.target.value }) }}
              />
              <select
                className={css.input}
                aria-label={`${t('courseKb')}: ${course.code}`}
                value={course.knowledgeBase ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  setDraft(draft.map((entry) => {
                    if (entry.code !== course.code) return entry
                    const { knowledgeBase: _dropped, ...rest } = entry
                    return value === '' ? rest : { ...rest, knowledgeBase: value }
                  }))
                  setSaved(false)
                }}
              >
                <option value="">{t('courseNoKb')}</option>
                {knowledgeBases.map(base => <option key={base.id} value={base.id}>{base.name}</option>)}
              </select>
            </div>
            <input
              className={css.input}
              aria-label={`${t('courseAliases')}: ${course.code}`}
              placeholder={t('courseAliasesHint')}
              value={(course.aliases ?? []).join(', ')}
              onChange={(event) => { edit(course.code, { aliases: event.target.value.split(',') }) }}
            />
            <textarea
              className={css.input}
              rows={2}
              aria-label={`${t('courseFolders')}: ${course.code}`}
              placeholder={t('courseFoldersHint')}
              value={course.folders.join('\n')}
              onChange={(event) => { edit(course.code, { folders: event.target.value.split('\n') }) }}
            />
          </li>
        ))}
      </ul>
      {draft.length === 0 ? null : (
        <div className={css.row}>
          <button type="button" className={css.primary} disabled={busy || !changed} onClick={() => {
            void onSave(draft.map((course) => {
              const { aliases, ...rest } = course
              const kept = (aliases ?? []).map(alias => alias.trim()).filter(alias => alias !== '')
              return { ...rest, ...kept.length === 0 ? {} : { aliases: kept }, folders: course.folders.map(folder => folder.trim()).filter(folder => folder !== '') }
            })).then(() => { setSaved(true) })
          }}>{t('saveCourses')}</button>
          {saved && !changed ? <span className={css.caption}>{t('coursesSaved')}</span> : null}
        </div>
      )}
    </section>
  )
}
