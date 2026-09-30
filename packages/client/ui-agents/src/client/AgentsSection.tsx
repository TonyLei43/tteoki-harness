/** Agents settings section: presets and their bound model routes. */

import { useEffect, useState } from 'react'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentsLocaleKey } from './locales.ts'
import css from './AgentsSection.module.css'

/** One composed agent preset shown in the list. */
export interface AgentRow {
  readonly id: string
  readonly name?: string | undefined
  readonly description?: string | undefined
  readonly isDefault: boolean
}

/** One selectable provider/model route from the live catalog. */
export interface AgentModelOption {
  readonly provider: string
  readonly providerName: string
  readonly model: string
  readonly modelName: string
}

/** A preset's stored binding, keyed by preset id. */
export type AgentBindings = Readonly<Record<string, { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }>>

/** Registration-side business face for the section. */
export interface AgentsSectionInjected {
  /** @returns presets, the selectable routes, and the current bindings. */
  load: () => Promise<{ presets: readonly AgentRow[]; options: readonly AgentModelOption[]; bindings: AgentBindings }>
  /**
   * Bind or clear one preset's route.
   * @param preset - preset id.
   * @param route - chosen provider/model, or null to clear.
   * @returns the updated bindings.
   */
  save: (preset: string, route: { provider: string; model: string } | null) => Promise<AgentBindings>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agents settings section copy. */
    agents: AgentsLocaleKey
  }
}

/** Props the renderer binds for the section. */
export type AgentsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'agents'>
  & InjectFace<AgentsSectionInjected>

/**
 * Render the Agents page: each preset with a model-route picker.
 * @param props - localized copy plus the load/save actions.
 * @returns the agents section.
 */
export function AgentsSection({ t, load, save }: AgentsSectionProps) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [rows, setRows] = useState<readonly AgentRow[]>([])
  const [options, setOptions] = useState<readonly AgentModelOption[]>([])
  const [bindings, setBindings] = useState<AgentBindings>({})
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(false)

  useEffect(() => {
    let active = true
    setPhase('loading')
    load().then(
      (state) => {
        if (!active) return
        setRows(state.presets)
        setOptions(state.options)
        setBindings(state.bindings)
        setPhase('ready')
      },
      () => {
        if (!active) return
        setPhase('error')
      },
    )
    return () => { active = false }
  }, [load])

  const apply = async (preset: string, route: { provider: string; model: string } | null): Promise<void> => {
    setBusy(true)
    setActionError(false)
    try {
      setBindings(await save(preset, route))
    } catch {
      setActionError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {phase === 'loading' ? <p className={css.notice}>{t('loading')}</p>
        : phase === 'error' ? <p className={css.notice} role="alert">{t('error')}</p>
          : rows.length === 0 ? <p className={css.notice}>{t('empty')}</p>
            : (
              <ul className={css.list}>
                {rows.map((row) => {
                  const bound = bindings[row.id]
                  const value = bound === undefined ? '' : `${bound.provider}::${bound.model}`
                  const label = row.name ?? row.id
                  return (
                    <li key={row.id} className={css.item}>
                      <span className={css.identity}>
                        <span className={css.name}>{label}</span>
                        <span className={css.meta}>{row.description ?? row.id}</span>
                      </span>
                      <select
                        className={css.select}
                        aria-label={label}
                        value={value}
                        disabled={busy}
                        onChange={(event) => {
                          const next = event.target.value
                          if (next === '') void apply(row.id, null)
                          else {
                            const [provider = '', model = ''] = next.split('::')
                            void apply(row.id, { provider, model })
                          }
                        }}
                      >
                        <option value="">{t('default')}</option>
                        {options.map(option => (
                          <option
                            key={`${option.provider}::${option.model}`}
                            value={`${option.provider}::${option.model}`}
                          >
                            {`${option.providerName} — ${option.modelName}`}
                          </option>
                        ))}
                      </select>
                    </li>
                  )
                })}
              </ul>
            )}
      {actionError ? <p className={css.notice} role="alert">{t('actionError')}</p> : null}
    </div>
  )
}
