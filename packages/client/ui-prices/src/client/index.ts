/**
 * Prices page, browser half: one settings section that summarizes the
 * DeepSeek off-peak state, plus a sidebar panel under the `main` keyed slot
 * that renders the off-peak clock, the DeepSeek token table, and the
 * searchable OpenRouter catalog. Both read the generated `prices` Remote
 * namespace.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the slot registry merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the layout SlotMap merge (the 'main' keyed slot) and its service.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the sidebar's SlotMap merge (the 'sidebar.panellist' list).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: the ctx.remote merge and the prices wire vocabulary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { PricesBoard } from './PricesBoard.tsx'
import type { PricesBoardInjected } from './PricesBoard.tsx'
import { PricesPanelIcon } from './PricesPanelIcon.tsx'
import { PricesSection } from './PricesSection.tsx'
import type { PricesSectionInjected } from './PricesSection.tsx'
import type { PricesLocaleKey } from './locales.ts'
import { en, zh } from './locales.ts'

export type { PricesBoardInjected, PricesBoardProps } from './PricesBoard.tsx'
export type { PricesSectionInjected, PricesSectionProps } from './PricesSection.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'prices'

/** The id shared by the sidebar entry, the main panel, and the settings section. */
const PANEL_ID = 'prices' as MainPanelId

/** Required services: slots, locale, the layout panel selector, and the mounted prices namespace. */
export const inject = ['slots', 'locale', 'remote', 'remote.prices', 'layout']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Prices page copy. */
    prices: PricesLocaleKey
  }
}

/**
 * Mount the Prices settings section and the sidebar panel.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-prices: dictionaries')

  const board: PricesBoardInjected = {
    deepseek: async () => {
      const result = await ctx.remote.prices.deepseek()
      if (!result.ok) throw new Error(`prices/deepseek failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    status: async () => {
      const result = await ctx.remote.prices.status()
      if (!result.ok) throw new Error(`prices/status failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    openRouterModels: async () => {
      const result = await ctx.remote.prices.openRouterModels()
      if (!result.ok) throw new Error(`prices/openRouterModels failed: ${result.error.code}: ${result.error.message}`)
      return result.value.models
    },
  }

  const section: PricesSectionInjected = {
    load: async () => {
      const status = await board.status()
      try {
        return { status, modelCount: (await board.openRouterModels()).length }
      } catch {
        // A failed catalog read still lets the section report the live clock.
        return { status }
      }
    },
    openBoard: () => { ctx.layout.selectPanel(PANEL_ID) },
  }

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: (): PricesBoardInjected => board,
  }, PricesBoard))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 21,
    locale: NS,
    label: () => t('nav'),
  }, PricesPanelIcon))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: PANEL_ID,
    order: 24,
    label: () => t('nav'),
    locale: NS,
    inject: (): PricesSectionInjected => section,
  }, PricesSection))
}
