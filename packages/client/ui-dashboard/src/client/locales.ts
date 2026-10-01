/** English copy for the Home dashboard. */

/** Locale keys the dashboard renders. */
export type DashboardLocaleKey = 'nav' | 'morning' | 'afternoon' | 'evening' | 'empty'

/** English copy. */
export const en: Record<DashboardLocaleKey, string> = {
  nav: 'Home',
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
  empty: 'No widgets yet. Plugins add them to Home.',
}
