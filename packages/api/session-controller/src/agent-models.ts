/** Resolve an agent's initial model selection, honoring a preset binding. */

import type { Context } from '@deepseek-ai/cordis'

/** Structural face of the optional per-preset binding service. */
interface PresetModelResolver {
  resolveFor: (preset: string | undefined) => ModelRoute | undefined
}

/** A provider/model route with an optional adapter reasoning effort. */
export interface ModelRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/**
 * Resolve the model route for an agent created with a preset. A preset binding
 * wins; otherwise the process-wide default applies, so a deployment without the
 * binding service behaves exactly as before.
 * @param ctx - Host context carrying the default-model service.
 * @param preset - the agent's preset id, or undefined when none applies.
 * @returns the route the fresh agent should use.
 */
export function resolveAgentSelection(ctx: Context, preset: string | undefined): ModelRoute {
  const bindings = ctx.get('agentModels') as PresetModelResolver | undefined
  return bindings?.resolveFor(preset) ?? ctx.agentDefaultModel.currentSelection()
}
