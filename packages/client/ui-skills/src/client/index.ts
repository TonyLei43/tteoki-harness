/**
 * Skills settings section, browser half: registers one `settings.section`
 * entry that lists every skill the host composition can load. The inventory
 * rides the generated `skills` Remote namespace, so this package reads no
 * filesystem and needs no session.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the slot registry merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote merge and the inventory wire vocabulary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SkillsSection } from './SkillsSection.tsx'
import type { SkillsSectionInjected } from './SkillsSection.tsx'
import { en, zh } from './locales.ts'

export type { SkillsSectionInjected, SkillsSectionProps } from './SkillsSection.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'skills'

/** Required services: slots, locale, and the mounted skills Remote namespaces. */
export const inject = ['slots', 'locale', 'remote', 'remote.skills', 'remote.skillSets']

/**
 * Mount the Skills settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-skills: dictionaries')

  const injected = (): SkillsSectionInjected => ({
    load: async () => {
      const result = await ctx.remote.skills.inventory()
      if (!result.ok) throw new Error(`skills/inventory failed: ${result.error.code}: ${result.error.message}`)
      return result.value.skills
    },
    loadSets: async () => {
      const result = await ctx.remote.skillSets.list()
      if (!result.ok) throw new Error(`skillSets/list failed: ${result.error.code}: ${result.error.message}`)
      return result.value.sets
    },
    installSet: async (spec) => {
      const result = await ctx.remote.skillSets.installSet({ spec })
      if (!result.ok) throw new Error(`skillSets/installSet failed: ${result.error.code}: ${result.error.message}`)
      return result.value.sets
    },
    removeSet: async (name) => {
      const result = await ctx.remote.skillSets.removeSet({ name })
      if (!result.ok) throw new Error(`skillSets/removeSet failed: ${result.error.code}: ${result.error.message}`)
      return result.value.sets
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skills',
    order: 25,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, SkillsSection))
}
