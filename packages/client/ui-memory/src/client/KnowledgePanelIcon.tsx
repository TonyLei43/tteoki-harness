/** Decorative occupant for the Knowledge sidebar entry. */

import { IconDatabaseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the knowledge glyph at the size the sidebar asks for; the sidebar owns
 * its accessible navigation label.
 * @param props - the sidebar's icon share: the requested edge and whether the panel is selected.
 * @returns the icon element.
 */
export function KnowledgePanelIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconDatabaseOutlineRegular size={size} />
}
