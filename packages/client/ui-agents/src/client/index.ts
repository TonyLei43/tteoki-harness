/**
 * Agents settings section, browser half: registers one `settings.section`
 * entry that lists agent presets and binds each preset's model route. The
 * binding is applied by the Host at agent creation.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the slot registry merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote merge and the wire vocabulary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { AgentsSection } from './AgentsSection.tsx'
import type { AgentsSectionInjected } from './AgentsSection.tsx'
import { en, zh } from './locales.ts'

export type { AgentModelOption, AgentRow, AgentBindings, AgentsSectionInjected, AgentsSectionProps } from './AgentsSection.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'agents'

/** Required services: slots, locale, and the mounted agent/model Remote namespaces. */
export const inject = ['slots', 'locale', 'remote', 'remote.agentPresets', 'remote.agentModels', 'remote.session']

/**
 * Mount the Agents settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-agents: dictionaries')

  const injected = (): AgentsSectionInjected => ({
    load: async () => {
      const [presets, models, bound] = await Promise.all([
        ctx.remote.agentPresets.list(),
        ctx.remote.session.modelCatalog(),
        ctx.remote.agentModels.list(),
      ])
      if (!presets.ok) throw new Error(`agentPresets/list failed: ${presets.error.code}: ${presets.error.message}`)
      if (!models.ok) throw new Error(`session/modelCatalog failed: ${models.error.code}: ${models.error.message}`)
      if (!bound.ok) throw new Error(`agentModels/list failed: ${bound.error.code}: ${bound.error.message}`)
      return {
        presets: presets.value.presets.map(row => ({
          id: row.id,
          ...row.name === undefined ? {} : { name: row.name },
          ...row.description === undefined ? {} : { description: row.description },
          isDefault: row.isDefault,
        })),
        options: models.value.groups.flatMap(group => group.models.map(model => ({
          provider: group.id,
          providerName: group.name,
          model: model.id,
          modelName: model.name,
        }))),
        bindings: bound.value.bindings,
      }
    },
    save: async (preset, route) => {
      const result = await ctx.remote.agentModels.setPreset({ preset, selection: route })
      if (!result.ok) throw new Error(`agentModels/setPreset failed: ${result.error.code}: ${result.error.message}`)
      return result.value.bindings
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'agents',
    order: 22,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, AgentsSection))
}
