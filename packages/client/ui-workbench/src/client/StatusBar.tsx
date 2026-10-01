/** The status bar: running Sessions, the next deadline, the knowledge index, and the last sync. */

import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { relative } from './model.ts'
import type { StatusFacts, WorkbenchInjected } from './model.ts'
import css from './Workbench.module.css'

/** Props the renderer binds for the status bar. */
export type StatusBarProps =
  PropsRuntime<'shell.status'>
  & PropsLocale<'workbench'>
  & InjectFace<WorkbenchInjected>

/** Refresh interval for the status facts. */
const REFRESH_MS = 60_000

/**
 * Fill `{name}` placeholders.
 * @param template - translated text.
 * @param values - placeholder values.
 * @returns the filled text.
 */
function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match)
}

/**
 * Render the status bar.
 * @param props - session hooks, locale, and the workbench face.
 * @returns the bar.
 */
export function StatusBar({ t, useSessions, statusFacts }: StatusBarProps) {
  const running = useSessions(state => state.ids.filter(id => state.byId[id]?.running === true && state.byId[id]?.origin !== 'subagent').length)
  const [facts, setFacts] = useState<StatusFacts>({})
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let active = true
    const load = (): void => {
      setNow(Date.now())
      statusFacts().then((next) => { if (active) setFacts(next) }, () => {})
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => { active = false; clearInterval(timer) }
  }, [statusFacts])
  return (
    <div className={css.status} role="status" aria-label={t('statusBar')}>
      <span className={css.statusItem}>
        <span className={css.dot} data-status={running > 0 ? 'running' : 'idle'} />
        {fill(t('running'), { count: String(running) })}
      </span>
      <span className={css.statusItem}>
        {facts.nextDue === undefined
          ? t('nothingDue')
          : fill(t('nextDue'), { title: facts.nextDue.course === undefined ? facts.nextDue.title : `${facts.nextDue.title} (${facts.nextDue.course.split(':')[0] ?? ''})`, when: relative(facts.nextDue.start, now) })}
      </span>
      <span className={css.spacer} />
      {facts.documents === undefined ? null : <span className={css.statusItem}>{fill(t('knowledge'), { count: String(facts.documents) })}</span>}
      {facts.syncedAt === undefined ? null : <span className={css.statusItem}>{fill(t('synced'), { when: relative(facts.syncedAt, now) })}</span>}
    </div>
  )
}
