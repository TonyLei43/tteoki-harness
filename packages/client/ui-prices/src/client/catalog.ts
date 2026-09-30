/**
 * Pure operations over the OpenRouter catalog: a case-insensitive id/name
 * search that keeps the list sorted by display name.
 */

import type { OpenRouterModel } from '@deepseek-ai/dsh-api-remotes/client'

/**
 * Filter and sort the catalog for the search field. An empty query keeps every
 * model; the result is always ordered by name (then id) so the display is
 * stable as the query changes.
 * @param models - normalized catalog rows.
 * @param query - free-text id or name filter.
 * @returns the matching rows in display order.
 */
export function searchModels(models: readonly OpenRouterModel[], query: string): readonly OpenRouterModel[] {
  const needle = query.trim().toLowerCase()
  return models
    .filter(model => needle === ''
      || model.id.toLowerCase().includes(needle)
      || model.name.toLowerCase().includes(needle))
    .slice()
    .sort((left, right) => {
      const byName = left.name.localeCompare(right.name)
      return byName !== 0 ? byName : left.id.localeCompare(right.id)
    })
}
