/** Decorative occupant for the Prices sidebar entry. */

import { IconGaugeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the price-meter glyph at the size the sidebar asks for; the sidebar
 * owns its accessible navigation label.
 * @param props - the sidebar's icon share: the requested edge and whether the panel is selected.
 * @returns the icon element.
 */
export function PricesPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconGaugeOutlineRegular size={size} />
}
