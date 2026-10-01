/**
 * Home dashboard, browser half: the Home main panel, the first sidebar entry,
 * which the app opens on. Home shows a greeting, an optional `dashboard.hero`
 * banner, and a grid of widget cards, and declares the `dashboard.widget` list
 * and the `dashboard.hero` seat other plugins fill.
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
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { DashboardWidgetMetadata } from './contract.ts'
import { Dashboard } from './Dashboard.tsx'
import type { DashboardInjected } from './Dashboard.tsx'
import { HomeIcon } from './HomeIcon.tsx'
import { en } from './locales.ts'

export type { DashboardWidgetMetadata, DashboardWidgetOwnerProps } from './contract.ts'
export type { DashboardInjected, DashboardProps } from './Dashboard.tsx'
export { greetingFor } from './Dashboard.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'dashboard'

/** The id shared by the Home sidebar entry and its main panel. */
export const HOME_PANEL_ID = 'home' as MainPanelId

/** Required services. */
export const inject = ['slots', 'locale', 'layout']

/**
 * Mount Home, track the widget roster, and open Home once at startup.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, 'en', en), 'ui-dashboard: dictionary')
  const widgets = createSnapshotStore<readonly DashboardWidgetMetadata[]>([])
  const sync = (): void => {
    const next = ctx.slots.entriesOfSlot('dashboard.widget').map(({ options }) => {
      const id = String(options.id)
      return { id, order: options.order ?? 0, label: resolveSlotLabel(options.label) ?? id }
    }).sort((left, right) => left.order - right.order)
    const previous = widgets.getSnapshot()
    if (previous.length === next.length && previous.every((widget, index) => {
      const candidate = next[index] as DashboardWidgetMetadata
      return widget.id === candidate.id && widget.order === candidate.order && widget.label === candidate.label
    })) return
    widgets.set(next)
  }
  ctx.effect(() => ctx.slots.subscribe('dashboard.widget', sync), 'ui-dashboard: widget entries')
  ctx.effect(() => ctx.locale.subscribe(sync), 'ui-dashboard: widget labels')
  const injected: DashboardInjected = { widgets, now: () => Date.now() }
  let opened = false
  ctx.slots.inject('main', () => {
    const dispose = ctx.slots.register({
      name: 'main',
      key: HOME_PANEL_ID,
      locale: NS,
      children: { 'dashboard.widget': { kind: 'list', scope: 'root' }, 'dashboard.hero': { kind: 'single', scope: 'root' } },
      inject: () => injected,
    }, Dashboard)
    // Home is where the app opens; later re-registrations (hot reload) keep the current view.
    if (!opened) {
      opened = true
      queueMicrotask(() => { ctx.layout.selectPanel(HOME_PANEL_ID) })
    }
    return dispose
  })
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: HOME_PANEL_ID,
    order: -10,
    locale: NS,
    label: () => t('nav'),
  }, HomeIcon))
  sync()
}
