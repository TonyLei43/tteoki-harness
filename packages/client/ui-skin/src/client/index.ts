/**
 * Deployment skin, browser half. The skin applies the chosen palette as a
 * token layer over the active light or dark theme, registers its pixel
 * display font, fills the brand slots with the pixel bunny, adds the palette
 * picker to the sidebar foot and the pixel scene to Home. The palette is
 * saved in the skin's settings section (the `ui-skin` Loader entry). Every
 * effect withdraws on plugin unload, so disabling the skin leaves no partial
 * brand, stale palette, or font.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the SlotRegistry (ctx.slots) Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the brand-slot owner contracts for both declaring packages.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: the dashboard's SlotMap merge (the 'dashboard.hero' seat).
import type {} from '@deepseek-ai/dsh-client-ui-dashboard/client'
// Type-only: pulls the theme service (ctx.theme) Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings forms service merge (ctx.configForms).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SkinBrandMark, SkinBrandName, SkinHeroMark } from './Brand.tsx'
import { PIXEL_FONT_WOFF2 } from './fonts.generated.ts'
import { en } from './locales.ts'
import { DEFAULT_PALETTE_ID, paletteById, PALETTES, PIXEL_FONT_FAMILY, skinTokens } from './palette.ts'
import { PixelScene } from './PixelScene.tsx'
import { ThemePicker } from './ThemePicker.tsx'
import type { ThemePickerInjected } from './ThemePicker.tsx'

export { DEFAULT_PALETTE_ID, paletteById, PALETTES, skinTokens } from './palette.ts'
export type { Palette } from './palette.ts'
export { isDaytime, PixelScene } from './PixelScene.tsx'
export { colorChannels, PARTICLE_SHADER, PixelSky } from './PixelSky.tsx'
export { spriteRuns, Sprite } from './pixel.tsx'
export { ThemePicker } from './ThemePicker.tsx'
export type { ThemePickerInjected, ThemePickerProps } from './ThemePicker.tsx'

/** Override layer identity; also names the layer's origin for inspection. */
const SKIN_SOURCE = '@deepseek-ai/dsh-client-ui-skin'

/** Dictionary namespace owned by this plugin. */
const NS = 'skin'

/** Settings namespace: the skin's Loader entry id. */
const SETTINGS_NAMESPACE = 'ui-skin'

/** Field holding the chosen palette id. */
const PALETTE_FIELD = 'palette'

/** Required services: the slot registry, the theme token registry, and the locale runtime. */
export const inject = ['slots', 'theme', 'locale']

/**
 * The `@font-face` rules for the embedded pixel font.
 * @returns CSS text.
 */
export function pixelFontCss(): string {
  return Object.entries(PIXEL_FONT_WOFF2).map(([weight, data]) =>
    `@font-face{font-family:'${PIXEL_FONT_FAMILY}';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2');}`,
  ).join('\n')
}

/**
 * Apply the palette, font, brand, picker, and Home scene.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, 'en', en), 'ui-skin: dictionary')
  const current = createSnapshotStore<string>(DEFAULT_PALETTE_ID)
  let save: (id: string) => void = () => {}
  ctx.effect(() => {
    let withdraw = ctx.theme.overrideTokens(SKIN_SOURCE, skinTokens(paletteById(current.getSnapshot())))
    const stop = current.subscribe(() => {
      withdraw()
      withdraw = ctx.theme.overrideTokens(SKIN_SOURCE, skinTokens(paletteById(current.getSnapshot())))
    })
    return () => {
      stop()
      withdraw()
    }
  }, 'ui-skin: palette')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.source = SKIN_SOURCE
    style.textContent = pixelFontCss()
    document.head.append(style)
    return () => { style.remove() }
  }, 'ui-skin: pixel font')
  // Without a settings provider the palette still switches, for this page only.
  ctx.inject(['configForms'], (scope) => {
    const form = scope.configForms.get<{ palette?: string }>(SETTINGS_NAMESPACE)
    const adopt = (): void => {
      const stored = form.getSnapshot().value?.[PALETTE_FIELD]
      if (stored !== undefined) current.set(paletteById(stored).id)
    }
    scope.effect(() => form.subscribe(adopt), 'ui-skin: palette setting')
    adopt()
    save = (id) => { void form.set(PALETTE_FIELD, id) }
    scope.effect(() => () => { save = () => {} }, 'ui-skin: palette writer')
  })
  const picker: ThemePickerInjected = {
    palettes: PALETTES,
    current,
    choose: (id) => {
      current.set(paletteById(id).id)
      save(paletteById(id).id)
    },
  }
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, SkinBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, SkinBrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, SkinHeroMark))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'skin.theme',
    locale: NS,
    label: () => t('theme'),
    inject: () => picker,
  }, ThemePicker))
  ctx.slots.inject('dashboard.hero', () => ctx.slots.register({ name: 'dashboard.hero' }, PixelScene))
}
