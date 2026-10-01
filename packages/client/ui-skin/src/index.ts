/**
 * Deployment skin, node half: publishes the skin's settings section (the
 * chosen palette) to the browser. Brand, palette, and pixel art are browser
 * halves.
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** Skin settings the browser reads through its settings form. */
export interface Config {
  /** Palette id: `mochi`, `matcha`, `starlight`, or `classic`. */
  palette: Volatile<string>
}

/** Validated skin settings. */
export const Config = z.object({
  palette: z.string().default('mochi').volatile(),
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
