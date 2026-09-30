/** The Home panel: a greeting with today's date and one card per registered widget. */

import { useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { DashboardWidgetMetadata } from './contract.ts'
import type { DashboardLocaleKey } from './locales.ts'
import css from './Dashboard.module.css'

/** Registration-side face: the widget roster and the clock. */
export interface DashboardInjected {
  /** Registered widgets in ascending order. */
  readonly widgets: ObservableSnapshot<readonly DashboardWidgetMetadata[]>
  /** @returns the current time in epoch milliseconds. */
  readonly now: () => number
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Home dashboard copy. */
    dashboard: DashboardLocaleKey
  }
}

/** Props the renderer binds for the Home panel. */
export type DashboardProps =
  PropsRuntime<'main'>
  & PropsRenderSlots<'dashboard.widget' | 'dashboard.hero'>
  & PropsLocale<'dashboard'>
  & InjectFace<DashboardInjected>

/**
 * Pick the greeting for an hour of the day.
 * @param hour - local hour, 0–23.
 * @returns the greeting key.
 */
export function greetingFor(hour: number): DashboardLocaleKey {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  return 'evening'
}

/**
 * Render the Home panel.
 * @param props - widget roster, clock, locale, and the widget renderer.
 * @returns the panel element.
 */
export function Dashboard({ t, widgets, now, renderSlot }: DashboardProps) {
  const roster = useSyncExternalStore(widgets.subscribe, widgets.getSnapshot)
  const current = now()
  const date = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(current))
  return (
    <div className={css.panel}>
      <header className={css.header}>
        <h1 className={css.greeting}>{t(greetingFor(new Date(current).getHours()))}</h1>
        <p className={css.date}>{date}</p>
      </header>
      {renderSlot('dashboard.hero', { now: current })}
      {roster.length === 0 ? <p className={css.date}>{t('empty')}</p> : null}
      <div className={css.grid}>
        {roster.map(widget => (
          <article key={widget.id} className={css.card} aria-label={widget.label}>
            <h2 className={css.cardTitle}>{widget.label}</h2>
            <div className={css.cardBody}>{renderSlot('dashboard.widget', { now: current }, { only: widget.id })}</div>
          </article>
        ))}
      </div>
    </div>
  )
}
