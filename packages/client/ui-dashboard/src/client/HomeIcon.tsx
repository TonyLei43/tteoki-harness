/** Decorative occupant for the Home sidebar entry: a house outline in `currentColor`. */

import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the house glyph at the size the sidebar asks for; the sidebar owns
 * its accessible navigation label.
 * @param props - the sidebar's icon share: the requested edge and whether the panel is selected.
 * @returns the icon element.
 */
export function HomeIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}
