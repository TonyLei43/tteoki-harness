/**
 * Prices sidebar panel: the DeepSeek off-peak clock, the DeepSeek token price
 * table, and the searchable OpenRouter catalog. The clock recomputes its
 * countdown locally from the host `changeAt`, so it ticks in the user's
 * timezone; the catalog reads once and on an explicit refresh.
 */

import { useEffect, useMemo, useState } from 'react'
import type {
  DeepseekValue, OpenRouterModel, PricesStatus,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { searchModels } from './catalog.ts'
import { formatCountdown, formatPeakWindows, formatPrice, formatTokens, remainingMs } from './clock.ts'
import css from './PricesBoard.module.css'

/** Registration-side business face for the board panel. */
export interface PricesBoardInjected {
  /** @returns the static DeepSeek rate card and schedule. */
  deepseek: () => Promise<DeepseekValue>
  /** @returns the host's off-peak state and timezone. */
  status: () => Promise<PricesStatus>
  /** @returns the normalized OpenRouter catalog. */
  openRouterModels: () => Promise<readonly OpenRouterModel[]>
}

/** Board panel props: the runtime share, the locale seat, and the injected face. */
export type PricesBoardProps =
  PropsRuntime<'main'>
  & PropsLocale<'prices'>
  & InjectFace<PricesBoardInjected>

/** The loaded DeepSeek card plus the host clock reading. */
interface BaseState {
  readonly deepseek: DeepseekValue
  readonly status: PricesStatus
}

/**
 * Render the Prices panel.
 * @param props - localized copy and the price actions.
 * @returns the panel.
 */
export function PricesBoard({ t, deepseek, status, openRouterModels }: PricesBoardProps) {
  const [base, setBase] = useState<BaseState>()
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [models, setModels] = useState<readonly OpenRouterModel[]>()
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let active = true
    setPhase('loading')
    Promise.all([deepseek(), status()]).then(
      ([card, clock]) => {
        if (!active) return
        setBase({ deepseek: card, status: clock })
        setPhase('ready')
      },
      () => { if (active) setPhase('error') },
    )
    return () => { active = false }
  }, [deepseek, status])

  useEffect(() => {
    let active = true
    openRouterModels().then(
      (rows) => { if (active) { setModels(rows); setCatalogFailed(false) } },
      () => { if (active) setCatalogFailed(true) },
    )
    return () => { active = false }
  }, [openRouterModels])

  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [])

  const visible = useMemo(() => searchModels(models ?? [], query), [models, query])

  const refreshCatalog = async (): Promise<void> => {
    setRefreshing(true)
    setCatalogFailed(false)
    try {
      setModels(await openRouterModels())
    } catch {
      setCatalogFailed(true)
    } finally {
      setRefreshing(false)
    }
  }

  if (phase === 'loading') {
    return <div className={css.board}><p className={css.notice}>{t('loading')}</p></div>
  }
  if (phase === 'error' || base === undefined) {
    return <div className={css.board}><p className={css.notice} role="alert">{t('error')}</p></div>
  }

  const windows = formatPeakWindows(base.deepseek.schedule.peakWindowsUtc)
  const offPeak = base.status.offPeak
  return (
    <div className={css.board}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>

      <section className={css.clock} data-off-peak={offPeak} aria-label={t('title')}>
        <span className={css.clockState} role="status">{offPeak ? t('clock.offPeak') : t('clock.peak')}</span>
        <span className={css.countdown}>{t('clock.changeIn', { time: formatCountdown(remainingMs(base.status.changeAt, now)) })}</span>
        <span className={css.clockMeta}>{t('clock.windows', { windows })}</span>
        <span className={css.clockMeta}>{t('clock.timezone', { zone: base.status.localTimezone })}</span>
        <span className={css.clockMeta}>{t('clock.verified')}</span>
      </section>

      <h3 className={css.subheading}>{t('deepseek.title')}</h3>
      <p className={css.notice}>{t('deepseek.priceHint')}</p>
      <table className={css.table}>
        <thead>
          <tr>
            <th scope="col">{t('deepseek.model')}</th>
            <th scope="col">{t('deepseek.cacheHit')}</th>
            <th scope="col">{t('deepseek.cacheMiss')}</th>
            <th scope="col">{t('deepseek.output')}</th>
          </tr>
        </thead>
        <tbody>
          {base.deepseek.models.map(model => (
            <tr key={model.id}>
              <th scope="row" className={css.modelName}>{model.id}</th>
              <td>{`${formatPrice(model.cacheHitInput.offPeak)} / ${formatPrice(model.cacheHitInput.peak)}`}</td>
              <td>{`${formatPrice(model.cacheMissInput.offPeak)} / ${formatPrice(model.cacheMissInput.peak)}`}</td>
              <td>{`${formatPrice(model.output.offPeak)} / ${formatPrice(model.output.peak)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className={css.subheading}>{t('openrouter.title')}</h3>
      <div className={css.controls}>
        <input
          className={css.input}
          value={query}
          aria-label={t('openrouter.searchPlaceholder')}
          placeholder={t('openrouter.searchPlaceholder')}
          onChange={(event) => { setQuery(event.target.value) }}
        />
        <button type="button" className={css.refresh} disabled={refreshing} onClick={() => { void refreshCatalog() }}>
          {refreshing ? t('openrouter.refreshing') : t('openrouter.refresh')}
        </button>
      </div>
      {catalogFailed
        ? <p className={css.notice} role="alert">{t('unavailable')}</p>
        : models === undefined
          ? <p className={css.notice}>{t('loading')}</p>
          : visible.length === 0
            ? <p className={css.notice}>{t('openrouter.empty')}</p>
            : (
              <ul className={css.models}>
                {visible.map(model => (
                  <li key={model.id} className={css.model}>
                    <span className={css.modelHead}>
                      <span className={css.modelTitle}>{model.name}</span>
                      <span className={css.modelId}>{model.id}</span>
                    </span>
                    <span className={css.modelMeta}>
                      {model.contextLength === undefined
                        ? null
                        : `${t('openrouter.context')}: ${t('openrouter.contextValue', { tokens: formatTokens(model.contextLength) })}`}
                      {` · ${t('openrouter.input')}: ${formatPrice(model.promptPerM)}`}
                      {` · ${t('openrouter.output')}: ${formatPrice(model.completionPerM)}`}
                      {model.cacheReadPerM === undefined ? null : ` · ${t('openrouter.cacheRead')}: ${formatPrice(model.cacheReadPerM)}`}
                      {model.cacheWritePerM === undefined ? null : ` · ${t('openrouter.cacheWrite')}: ${formatPrice(model.cacheWritePerM)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
    </div>
  )
}
