/** Host loader entry for the sidebar: publishes its settings section to the browser. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** Sidebar settings the browser reads through its settings form. */
export interface Config {
  /** Panel ids folded under the collapsible Others row instead of listed at the top level. */
  others: Volatile<string[]>
}

/** Validated sidebar settings; no Others row by default. */
export const Config = z.object({
  others: z.array(z.string()).default([]).volatile(),
})

/**
 * Expose the settings section to the browser's settings forms.
 * @param ctx - Host context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (scope) => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber))
  })
}
