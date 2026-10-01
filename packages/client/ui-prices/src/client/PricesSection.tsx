/** Prices settings section: the off-peak state summary and a jump to the panel. */

import { useEffect, useState } from 'react'
import type { PricesStatus } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PricesSection.module.css'

/** Registration-side business face for the section. */
export interface PricesSectionInjected {
  /** @returns the host off-peak reading and the catalog size, when reachable. */
  load: () => Promise<{ status: PricesStatus; modelCount?: number }>
  /** Select the prices panel in the main layout. */
  openBoard: () => void
}

/** Section props: the runtime share, the locale seat, and the injected face. */
export type PricesSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'prices'>
  & InjectFace<PricesSectionInjected>

/**
 * Render the Prices settings section.
 * @param props - localized copy and the prices actions.
 * @returns the section.
 */
export function PricesSection({ t, load, openBoard }: PricesSectionProps) {
  const [state, setState] = useState<{ status: PricesStatus; modelCount?: number }>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    load().then(
      (value) => { if (active) setState(value) },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [load])

  if (state === undefined) {
    return (
      <div className={css.section}>
        <h2 className={css.heading}>{t('title')}</h2>
        {failed ? <p className={css.notice} role="alert">{t('error')}</p> : <p className={css.notice}>{t('intro')}</p>}
      </div>
    )
  }

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      <p className={css.state} role="status">{state.status.offPeak ? t('clock.offPeak') : t('clock.peak')}</p>
      <p className={css.notice}>{t('section.summary')}</p>
      {state.modelCount === undefined ? null : <p className={css.notice}>{t('section.modelCount', { models: state.modelCount })}</p>}
      <div className={css.actions}>
        <button type="button" className={css.button} onClick={openBoard}>{t('openBoard')}</button>
      </div>
    </div>
  )
}
