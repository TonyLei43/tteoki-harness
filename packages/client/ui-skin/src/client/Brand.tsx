/**
 * Brand occupants for the generic browser-brand slots. The mark is the pixel
 * bunny drawn in the active palette's colors, and the name reads from
 * {@link PRODUCT_NAME} in the pixel display font, so the deployment has one
 * rename point.
 */

import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { BUNNY_COLORS, BUNNY_HEAD, Sprite } from './pixel.tsx'
import { PRODUCT_NAME } from './product.ts'
import css from './Brand.module.css'

/** Geometry shared by the sidebar and hero mark seats. */
interface MarkGlyphProps {
  /** Requested square edge in pixels. */
  size: number
  /** Host class preserving the surrounding mark geometry. */
  className?: string | undefined
}

/**
 * Render the pixel bunny mark at the requested edge, in the palette's fur,
 * blush, and ink colors.
 * @param props - requested size and any host geometry class.
 * @returns the mark glyph.
 */
export function SkinMarkGlyph({ size, className }: MarkGlyphProps) {
  return (
    <Sprite
      className={className === undefined ? css.mark : `${css.mark} ${className}`}
      rows={BUNNY_HEAD}
      colors={BUNNY_COLORS}
      scale={size / BUNNY_HEAD.length}
    />
  )
}

/**
 * Render the sidebar brand mark.
 * @param props - sidebar-supplied mark geometry.
 * @returns the product mark.
 */
export function SkinBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <SkinMarkGlyph size={size} />
}

/**
 * Render the sidebar brand name.
 * @returns the product wordmark element.
 */
export function SkinBrandName() {
  return <span className={css.wordmark}>{PRODUCT_NAME}</span>
}

/**
 * Render the blank-session hero mark, preserving the host's geometry class.
 * @param props - hero-supplied mark geometry.
 * @returns the product mark.
 */
export function SkinHeroMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <SkinMarkGlyph size={size} className={className} />
}
