/**
 * The skin's palettes. Each palette is one token layer over the active theme:
 * surfaces, labels, the accent, and the `--tteoki-*` tokens the skin's pixel
 * art, cards, and display type read. Every value is a light/dark pair, so a
 * palette follows the user's light or dark theme. Text pairs keep at least
 * 4.5:1 against the surface they sit on.
 */

import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Font family name the skin registers for its embedded pixel font. */
export const PIXEL_FONT_FAMILY = 'Tteoki Pixel'

/** One light/dark color pair. */
type Pair = readonly [light: string, dark: string]

/** The colors a palette chooses; everything else derives from them. */
interface PaletteColors {
  /** Page background. */
  readonly base: Pair
  /** Card surface. */
  readonly card: Pair
  readonly layer2: Pair
  readonly layer3: Pair
  readonly sidebar: Pair
  readonly text: Pair
  readonly textDim: Pair
  readonly textSoft: Pair
  /** Accent for fills and marks. */
  readonly accent: Pair
  readonly accentHover: Pair
  /** Accent readable as link text on the page background. */
  readonly link: Pair
  /** Accent-tinted surface for selections and chips. */
  readonly accentSurface: Pair
  /** Card edge and offset shadow. */
  readonly edge: Pair
  readonly shadow: Pair
  /** Pixel bunny: fur, fur shade, inner ear and blush, eyes and outline. */
  readonly fur: Pair
  readonly furShade: Pair
  readonly blush: Pair
  readonly ink: Pair
  /** Home scene: daytime sky, night sky, grass, darker grass, stars and sun. */
  readonly skyDay: Pair
  readonly skyNight: Pair
  readonly grass: Pair
  readonly grassDark: Pair
  readonly glow: Pair
}

/** One selectable palette. */
export interface Palette {
  /** Stable id stored in the skin's settings. */
  readonly id: string
  /** Display name in the theme picker. */
  readonly name: string
  /** Three swatch colors the picker shows, light then dark. */
  readonly swatch: readonly Pair[]
  readonly colors: PaletteColors
}

/** Cream and strawberry, cocoa at night. */
const MOCHI: Palette = {
  id: 'mochi',
  name: 'Mochi',
  swatch: [['#FFF8F0', '#1E1916'], ['#D9577A', '#F28DA8'], ['#F4E6D6', '#3A302A']],
  colors: {
    base: ['#FFF8F0', '#1E1916'],
    card: ['#FFFDF9', '#27201C'],
    layer2: ['#FBF1E6', '#2E2621'],
    layer3: ['#F4E6D6', '#3A302A'],
    sidebar: ['#F8EEE2', '#1A1512'],
    text: ['#3B2A20', '#F3E7DA'],
    textDim: ['#4E3A2E', '#E2D4C6'],
    textSoft: ['#765D4E', '#BFAE9F'],
    accent: ['#D9577A', '#F28DA8'],
    accentHover: ['#C2466A', '#F7A8BD'],
    link: ['#B23E60', '#F5A3B9'],
    accentSurface: ['#FBE0E7', '#4A2A33'],
    edge: ['#EAD9C6', '#3E332C'],
    shadow: ['#EAD9C6', '#0F0C0A'],
    fur: ['#FFFFFF', '#F6EEE6'],
    furShade: ['#EADFD6', '#D2C4B8'],
    blush: ['#F4A3B8', '#F28DA8'],
    ink: ['#3B2A20', '#1E1916'],
    skyDay: ['#FDE6D2', '#3A2C3F'],
    skyNight: ['#3A3150', '#191427'],
    grass: ['#A8D08D', '#4F7A45'],
    grassDark: ['#86B56E', '#3D6236'],
    glow: ['#FFD27A', '#FFE3A3'],
  },
}

/** Sage and tea greens. */
const MATCHA: Palette = {
  id: 'matcha',
  name: 'Matcha',
  swatch: [['#F6F7EE', '#171C15'], ['#5E8C3A', '#9CCB6B'], ['#E3E7D2', '#303A2B']],
  colors: {
    base: ['#F6F7EE', '#171C15'],
    card: ['#FDFDF7', '#1F261C'],
    layer2: ['#EEF0E2', '#252D21'],
    layer3: ['#E3E7D2', '#303A2B'],
    sidebar: ['#EFF1E4', '#141912'],
    text: ['#2F3A26', '#E8EEDD'],
    textDim: ['#3E4B33', '#D6DFC8'],
    textSoft: ['#5B6750', '#A9B59B'],
    accent: ['#5E8C3A', '#9CCB6B'],
    accentHover: ['#4C7430', '#B3DA88'],
    link: ['#44692A', '#A9D47C'],
    accentSurface: ['#E2EDD3', '#2E3F23'],
    edge: ['#D9DEC4', '#34402D'],
    shadow: ['#D9DEC4', '#0B0E0A'],
    fur: ['#FFFFFF', '#F1F3EA'],
    furShade: ['#E4E6DA', '#CBD0BF'],
    blush: ['#F2A9A0', '#E89C93'],
    ink: ['#2F3A26', '#171C15'],
    skyDay: ['#E4F0DA', '#2A3531'],
    skyNight: ['#2D3A3A', '#121916'],
    grass: ['#9CC47A', '#4E7A3C'],
    grassDark: ['#7FAA5F', '#3C6230'],
    glow: ['#FFE08A', '#FFEAA8'],
  },
}

/** Lavender days, indigo nights lit by lantern gold. */
const STARLIGHT: Palette = {
  id: 'starlight',
  name: 'Starlight',
  swatch: [['#F5F3FB', '#15142A'], ['#6C5BD4', '#F5C451'], ['#E0DAF1', '#2E2B4F']],
  colors: {
    base: ['#F5F3FB', '#15142A'],
    card: ['#FDFCFF', '#1D1B36'],
    layer2: ['#ECE8F7', '#23213F'],
    layer3: ['#E0DAF1', '#2E2B4F'],
    sidebar: ['#EEEBF8', '#121126'],
    text: ['#2A2540', '#ECE9FF'],
    textDim: ['#3A3456', '#D9D5F5'],
    textSoft: ['#5E577C', '#ABA6CF'],
    accent: ['#6C5BD4', '#F5C451'],
    accentHover: ['#5847C0', '#FFD774'],
    link: ['#5746BE', '#F7CD6B'],
    accentSurface: ['#E4DFFA', '#3B3452'],
    edge: ['#DCD5F0', '#2F2C52'],
    shadow: ['#DCD5F0', '#08081A'],
    fur: ['#FFFFFF', '#F2F0FF'],
    furShade: ['#E2DEF2', '#C9C4E6'],
    blush: ['#F3A6C8', '#F0A0C4'],
    ink: ['#2A2540', '#15142A'],
    skyDay: ['#E3DDFB', '#2A2658'],
    skyNight: ['#2B2660', '#0E0D26'],
    grass: ['#9FC8A8', '#3E6A5A'],
    grassDark: ['#7FAF8B', '#2F5647'],
    glow: ['#F5C451', '#FFD774'],
  },
}

/** The original flat greys with a teal accent. */
const CLASSIC: Palette = {
  id: 'classic',
  name: 'Classic',
  swatch: [['#FFFFFF', '#0A0A0A'], ['#0D9488', '#2DD4BF'], ['#EDEDED', '#222222']],
  colors: {
    base: ['#FFFFFF', '#0A0A0A'],
    card: ['#FAFAFA', '#141414'],
    layer2: ['#F5F5F5', '#1A1A1A'],
    layer3: ['#EDEDED', '#222222'],
    sidebar: ['#F7F7F7', '#111111'],
    text: ['#171717', '#EDEDED'],
    textDim: ['#262626', '#D4D4D4'],
    textSoft: ['#525252', '#A3A3A3'],
    accent: ['#0D9488', '#2DD4BF'],
    accentHover: ['#0F766E', '#5EEAD4'],
    link: ['#0F766E', '#2DD4BF'],
    accentSurface: ['#CCFBF1', '#134E4A'],
    edge: ['#E5E5E5', '#262626'],
    shadow: ['#E5E5E5', '#000000'],
    fur: ['#FFFFFF', '#F5F5F5'],
    furShade: ['#E5E5E5', '#CFCFCF'],
    blush: ['#F4A3B8', '#F28DA8'],
    ink: ['#171717', '#0A0A0A'],
    skyDay: ['#E0F2F1', '#1F2A2A'],
    skyNight: ['#1F2937', '#0B1016'],
    grass: ['#9BD4B8', '#2F6B57'],
    grassDark: ['#7CC2A0', '#245445'],
    glow: ['#FFE08A', '#FFEAA8'],
  },
}

/** Every palette, the default first. */
export const PALETTES: readonly Palette[] = [MOCHI, MATCHA, STARLIGHT, CLASSIC]

/** Palette used when none is chosen or the stored id is unknown. */
export const DEFAULT_PALETTE_ID = MOCHI.id

/**
 * Find a palette by id.
 * @param id - stored palette id.
 * @returns the palette, or the default palette for an unknown id.
 */
export function paletteById(id: string | undefined): Palette {
  return PALETTES.find(palette => palette.id === id) ?? MOCHI
}

/**
 * Build one palette's override layer.
 * @param palette - the palette.
 * @returns token-name to light/dark pair map applied over the active theme.
 */
export function skinTokens(palette: Palette): ThemeTokenOverrides {
  const c = palette.colors
  const pair = ([light, dark]: Pair) => ({ light, dark })
  const same = (value: string) => ({ light: value, dark: value })
  return {
    '--dsw-alias-bg-base': pair(c.base),
    '--dsw-alias-bg-layer-1': pair(c.card),
    '--dsw-alias-bg-layer-2': pair(c.layer2),
    '--dsw-alias-bg-layer-3': pair(c.layer3),
    '--dsw-alias-bg-module-platform': pair(c.layer3),
    '--dsw-alias-bg-overlay': pair(c.layer3),
    '--dsw-alias-interactive-bg-hover-solid': pair(c.layer2),
    '--dsw-alias-label-primary': pair(c.text),
    '--dsw-alias-label-primary-dimmed': pair(c.textDim),
    '--dsw-alias-label-secondary': pair(c.textSoft),
    '--dsw-alias-label-tertiary': pair(c.textSoft),
    '--dsw-alias-label-caption': pair(c.textSoft),
    '--dsw-alias-border-l1': pair(c.edge),
    '--dsw-alias-border-l2': pair(c.edge),
    '--dsw-alias-markdown-code-block': pair(c.layer2),
    '--dsw-alias-markdown-code-block-banner': pair(c.layer3),
    '--dsw-specific-sidebar-fill': pair(c.sidebar),
    '--dsw-specific-sidebar-nav-item-hover': pair(c.layer3),
    '--dsw-specific-sidebar-nav-item-active': pair(c.accentSurface),
    '--dsw-alias-brand-primary': pair(c.accent),
    '--dsw-alias-brand-primary-new-colorprimary-new-color': pair(c.accent),
    '--dsw-alias-link': pair(c.link),
    '--dsw-alias-state-business-primary': pair(c.accent),
    '--dsw-alias-state-business-tertiary': pair(c.accentSurface),
    '--dsw-alias-button-info-fill': pair(c.accent),
    '--dsw-alias-button-info-hover': pair(c.accentHover),
    '--dsw-specific-sidebar-nav-item-active-accent': pair(c.accentSurface),
    '--tteoki-font-display': same(`'${PIXEL_FONT_FAMILY}', ui-rounded, system-ui, sans-serif`),
    '--tteoki-font-rounded': same('ui-rounded, "SF Pro Rounded", system-ui, sans-serif'),
    '--tteoki-card-radius': same('10px'),
    '--tteoki-card-border-width': same('2px'),
    '--tteoki-button-radius': same('6px'),
    '--tteoki-button-shadow': { light: `0 3px 0 ${c.accentHover[0]}`, dark: `0 3px 0 ${c.shadow[1]}` },
    '--tteoki-card-title-size': same('13px'),
    '--tteoki-card-border': pair(c.edge),
    '--tteoki-card-shadow': { light: `3px 3px 0 ${c.shadow[0]}`, dark: `3px 3px 0 ${c.shadow[1]}` },
    '--tteoki-home-bg': {
      light: `radial-gradient(${c.edge[0]} 1px, transparent 1.4px) 0 0 / 18px 18px`,
      dark: `radial-gradient(${c.edge[1]} 1px, transparent 1.4px) 0 0 / 18px 18px`,
    },
    '--tteoki-fur': pair(c.fur),
    '--tteoki-fur-shade': pair(c.furShade),
    '--tteoki-blush': pair(c.blush),
    '--tteoki-ink': pair(c.ink),
    '--tteoki-sky-day': pair(c.skyDay),
    '--tteoki-sky-night': pair(c.skyNight),
    '--tteoki-grass': pair(c.grass),
    '--tteoki-grass-dark': pair(c.grassDark),
    '--tteoki-glow': pair(c.glow),
  }
}
