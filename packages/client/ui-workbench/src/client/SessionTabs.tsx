/** The tab strip: Home, then open Sessions with their status dots. */

import { useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { WorkbenchLocaleKey } from './locales.ts'
import { tabStatus } from './model.ts'
import type { WorkbenchInjected } from './model.ts'
import css from './Workbench.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workbench chrome copy. */
    workbench: WorkbenchLocaleKey
  }
}

/** Props the renderer binds for the tab strip. */
export type SessionTabsProps =
  PropsRuntime<'shell.tabs'>
  & PropsLocale<'workbench'>
  & InjectFace<WorkbenchInjected>

/** The main-panel id Home registers under. */
const HOME = 'home'

/**
 * Render the tab strip. Home is always first; a Session tab is active while
 * the conversation shows that Session.
 * @param props - session hooks, panel info, locale, and the workbench face.
 * @returns the strip.
 */
export function SessionTabs({ t, useSessions, useSessionStatus, usePanelInfo, openTabs, currentSession, openSession, closeTab, openHome, newSession }: SessionTabsProps) {
  const tabs = useSyncExternalStore(openTabs.subscribe, openTabs.getSnapshot)
  const current = useSyncExternalStore(currentSession.subscribe, currentSession.getSnapshot)
  const panel = usePanelInfo(info => info.activePanelId)
  const sessions = useSessions(state => state)
  const statuses = useSessionStatus(map => map)
  return (
    <div className={css.tabs} role="tablist" aria-label={t('tabs')}>
      <button type="button" role="tab" aria-selected={panel === HOME} className={panel === HOME ? css.tabActive : css.tab} onClick={openHome}>
        <span className={css.tabTitle}>{t('home')}</span>
      </button>
      {tabs.filter(id => sessions.byId[id] !== undefined).map((id) => {
        const summary = sessions.byId[id]
        const facts = statuses.get(id)
        const status = tabStatus({
          running: facts?.running ?? summary?.running ?? false,
          pendingInteraction: facts?.pendingInteraction !== undefined,
          completionUnread: facts?.completionUnread ?? false,
        })
        const active = panel === null && current === id
        const title = summary?.displayTitle === undefined || summary.displayTitle === '' ? t('untitled') : summary.displayTitle
        return (
          <div key={id} className={active ? css.tabActive : css.tab}>
            <button type="button" role="tab" aria-selected={active} className={css.tabButton} title={title} onClick={() => { openSession(id) }}>
              <span className={css.dot} data-status={status} aria-label={t(`status.${status}`)} role="img" />
              <span className={css.tabTitle}>{title}</span>
            </button>
            <button type="button" className={css.close} aria-label={`${t('closeTab')}: ${title}`} onClick={() => { closeTab(id) }}>×</button>
          </div>
        )
      })}
      <button type="button" className={css.add} aria-label={t('newSession')} title={t('newSession')} onClick={newSession}>+</button>
    </div>
  )
}
