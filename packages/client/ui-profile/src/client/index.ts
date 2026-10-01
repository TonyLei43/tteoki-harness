/**
 * Profile settings section, browser half: registers one `settings.section`
 * entry that edits the browser-local display name and avatar shown in the
 * sidebar banner.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the slot registry merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ProfileSection } from './ProfileSection.tsx'
import type { ProfileSectionInjected } from './ProfileSection.tsx'
import { profileSnapshot, subscribeProfile } from './profile-storage.ts'
import { en, zh } from './locales.ts'

export type { ProfileSectionInjected, ProfileSectionProps } from './ProfileSection.tsx'
export type { LocalProfile } from './profile-storage.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'profile'

/** Required services: the slot registry and the locale registry. */
export const inject = ['slots', 'locale']

/**
 * Mount the Profile settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-profile: dictionaries')

  const injected = (): ProfileSectionInjected => ({
    hooks: { profile: { getSnapshot: profileSnapshot, subscribe: subscribeProfile } },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'profile',
    // After Account (-10) so the desktop's Account entry stays first, before General.
    order: -5,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, ProfileSection))
}
