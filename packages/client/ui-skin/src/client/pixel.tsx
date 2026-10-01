/**
 * Pixel art drawn from character maps. Each map row is one pixel row; each
 * character names a color token, and `.` is transparent. Colors are CSS
 * custom properties from the active palette, so the art follows the theme.
 */

import type { CSSProperties } from 'react'

/** Character to fill color. */
export type SpriteColors = Readonly<Record<string, string>>

/** One horizontal run of same-colored pixels. */
interface Run {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly fill: string
}

/**
 * Merge a character map into horizontal runs.
 * @param rows - map rows, all the same length.
 * @param colors - fill per character; characters without a color are transparent.
 * @returns runs in row order.
 */
export function spriteRuns(rows: readonly string[], colors: SpriteColors): Run[] {
  const runs: Run[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const character = row[x] ?? '.'
      let end = x + 1
      while (end < row.length && row[end] === character) end += 1
      const fill = colors[character]
      if (fill !== undefined) runs.push({ x, y, width: end - x, fill })
      x = end
    }
  })
  return runs
}

/** Props of {@link Sprite}. */
export interface SpriteProps {
  readonly rows: readonly string[]
  readonly colors: SpriteColors
  /** Rendered edge of one pixel, in CSS pixels. */
  readonly scale: number
  readonly className?: string | undefined
  readonly style?: CSSProperties | undefined
  /** Accessible name; the sprite is decorative when absent. */
  readonly label?: string | undefined
}

/**
 * Render a character map as a crisp SVG.
 * @param props - map, colors, and scale.
 * @returns the SVG.
 */
export function Sprite({ rows, colors, scale, className, style, label }: SpriteProps) {
  const width = Math.max(...rows.map(row => row.length))
  return (
    <svg
      className={className}
      style={style}
      width={width * scale}
      height={rows.length * scale}
      viewBox={`0 0 ${width} ${rows.length}`}
      shapeRendering="crispEdges"
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      focusable="false"
    >
      {spriteRuns(rows, colors).map(run => <rect key={`${run.x}-${run.y}`} x={run.x} y={run.y} width={run.width} height={1} fill={run.fill} />)}
    </svg>
  )
}

/** Palette colors the bunny sprites use. */
export const BUNNY_COLORS: SpriteColors = {
  K: 'var(--tteoki-ink, #3B2A20)',
  W: 'var(--tteoki-fur, #FFFFFF)',
  S: 'var(--tteoki-fur-shade, #EADFD6)',
  P: 'var(--tteoki-blush, #F4A3B8)',
  E: 'var(--tteoki-ink, #3B2A20)',
}

/** The bunny head used as the product mark, 12 × 12. */
export const BUNNY_HEAD: readonly string[] = [
  '.KK.....KK..',
  'KWWK...KWWK.',
  'KWPK...KPWK.',
  'KWPK...KPWK.',
  'KWWKKKKKWWK.',
  'KWWWWWWWWWWK',
  'KWEWWWWWWEWK',
  'KWPWWKKWWPWK',
  'KWWWWWWWWWWK',
  '.KSWWWWWWSK.',
  '..KKKKKKKK..',
  '............',
]

/** A sitting bunny for the Home scene, 16 × 16. */
export const BUNNY_SITTING: readonly string[] = [
  '....KK....KK....',
  '...KWWK..KWWK...',
  '...KWPK..KPWK...',
  '...KWPK..KPWK...',
  '...KWWKKKKWWK...',
  '..KWWWWWWWWWWK..',
  '..KWWEWWWWEWWK..',
  '..KWPWWKKWWPWK..',
  '..KWWWWWWWWWWK..',
  '...KKWWWWWWKK...',
  '..KWWWWWWWWWWK..',
  '.KWWWWWWWWWWWWK.',
  '.KWWSWWWWWWSWWK.',
  '.KWWSWWWWWWSWWK.',
  '..KKWWKKKKWWKK..',
  '....KK....KK....',
]

/** The same bunny with its eyes closed, for blinking. */
export const BUNNY_BLINK: readonly string[] = BUNNY_SITTING.map((row, index) => index === 6 ? '..KWWKWWWWKWWK..' : row)

/** A carrot, 6 × 8. */
export const CARROT: readonly string[] = [
  '..G.G.',
  '...GG.',
  '..OOO.',
  '..OOO.',
  '..OO..',
  '..OO..',
  '...O..',
  '......',
]

/** Carrot colors. */
export const CARROT_COLORS: SpriteColors = { G: 'var(--tteoki-grass-dark, #86B56E)', O: '#F29A4A' }

/** A round sun or moon disc, 8 × 8. */
export const DISC: readonly string[] = [
  '..GGGG..',
  '.GGGGGG.',
  'GGGGGGGG',
  'GGGGGGGG',
  'GGGGGGGG',
  'GGGGGGGG',
  '.GGGGGG.',
  '..GGGG..',
]

/** A crescent moon, 8 × 8: the disc with a bite taken out by the night sky. */
export const CRESCENT: readonly string[] = [
  '..GGG...',
  '.GGG....',
  'GGG.....',
  'GGG.....',
  'GGG.....',
  'GGG.....',
  '.GGG....',
  '..GGG...',
]

/** A four-point star, 3 × 3. */
export const STAR: readonly string[] = [
  '.G.',
  'GGG',
  '.G.',
]

/** Glow color for the sun, moon, and stars. */
export const GLOW_COLORS: SpriteColors = { G: 'var(--tteoki-glow, #FFD27A)' }
