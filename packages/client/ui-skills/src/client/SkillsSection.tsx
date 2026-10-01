/** Skills settings section: installed skills plus npm skill-set management. */

import { useEffect, useMemo, useState } from 'react'
import type { SkillInventoryEntry, SkillSetInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillsLocaleKey } from './locales.ts'
import css from './SkillsSection.module.css'

/** Registration-side business face for the section. */
export interface SkillsSectionInjected {
  /** @returns every installed skill, or rejects when the host cannot answer. */
  load: () => Promise<readonly SkillInventoryEntry[]>
  /** @returns every installed skill set. */
  loadSets: () => Promise<readonly SkillSetInfo[]>
  /**
   * Install one npm skill set.
   * @param spec - npm spec to install.
   * @returns the updated installed-set list.
   */
  installSet: (spec: string) => Promise<readonly SkillSetInfo[]>
  /**
   * Remove one installed skill set.
   * @param name - installed package name.
   * @returns the updated installed-set list.
   */
  removeSet: (name: string) => Promise<readonly SkillSetInfo[]>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Skills settings section copy. */
    skills: SkillsLocaleKey
  }
}

/** Props the renderer binds for the section. */
export type SkillsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'skills'>
  & InjectFace<SkillsSectionInjected>

/** One skill's name, routing description, origin, and invocation badges. */
function SkillItem({ skill, t }: { skill: SkillInventoryEntry; t: (key: SkillsLocaleKey) => string }) {
  return (
    <li className={css.item}>
      <div className={css.rowHead}>
        <code className={css.name}>{skill.name}</code>
        <span className={css.badges}>
          {skill.modelInvocable ? <span className={css.badge}>{t('modelBadge')}</span> : null}
          {skill.userInvocable ? <span className={css.badge}>{t('userBadge')}</span> : null}
        </span>
      </div>
      <p className={css.description}>{skill.description}</p>
      <p className={css.meta}>{skill.source} · {skill.provider}</p>
    </li>
  )
}

/**
 * Render the Skills page: a search field over the host's installed skills plus
 * npm skill-set installation and removal.
 * @param props - localized copy and the inventory/installer actions.
 * @returns the skills section.
 */
export function SkillsSection({ t, load, loadSets, installSet, removeSet }: SkillsSectionProps) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [entries, setEntries] = useState<readonly SkillInventoryEntry[]>([])
  const [sets, setSets] = useState<readonly SkillSetInfo[]>([])
  const [query, setQuery] = useState('')
  const [spec, setSpec] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(false)

  useEffect(() => {
    let active = true
    setPhase('loading')
    Promise.all([load(), loadSets()]).then(
      ([skills, installed]) => {
        if (!active) return
        setEntries(skills)
        setSets(installed)
        setPhase('ready')
      },
      () => {
        if (!active) return
        setPhase('error')
      },
    )
    return () => { active = false }
  }, [load, loadSets])

  const change = async (action: () => Promise<readonly SkillSetInfo[]>): Promise<void> => {
    setBusy(true)
    setActionError(false)
    try {
      setSets(await action())
      setEntries(await load())
    } catch {
      setActionError(true)
    } finally {
      setBusy(false)
    }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const sorted = [...entries].sort((left, right) => left.name.localeCompare(right.name))
    if (needle === '') return sorted
    return sorted.filter(skill =>
      skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle))
  }, [entries, query])

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      <input
        className={css.search}
        type="search"
        value={query}
        placeholder={t('search')}
        aria-label={t('search')}
        onChange={(event) => { setQuery(event.target.value) }}
      />
      {phase === 'loading' ? <p className={css.notice}>{t('loading')}</p>
        : phase === 'error' ? <p className={css.notice} role="alert">{t('error')}</p>
          : entries.length === 0 ? <p className={css.notice}>{t('empty')}</p>
            : visible.length === 0 ? <p className={css.notice}>{t('noMatch')}</p>
              : (
                <ul className={css.list}>
                  {visible.map(skill => <SkillItem key={skill.name} skill={skill} t={t} />)}
                </ul>
              )}

      <h3 className={css.subheading}>{t('setsTitle')}</h3>
      <p className={css.intro}>{t('setsIntro')}</p>
      <div className={css.installRow}>
        <input
          className={css.search}
          type="text"
          value={spec}
          placeholder={t('specPlaceholder')}
          aria-label={t('specPlaceholder')}
          onChange={(event) => { setSpec(event.target.value) }}
        />
        <button
          type="button"
          className={css.install}
          disabled={busy || spec.trim() === ''}
          onClick={() => {
            const trimmed = spec.trim()
            void change(async () => {
              const next = await installSet(trimmed)
              setSpec('')
              return next
            })
          }}
        >
          {busy ? t('installing') : t('install')}
        </button>
      </div>
      {actionError ? <p className={css.notice} role="alert">{t('actionError')}</p> : null}
      {sets.length === 0 ? <p className={css.notice}>{t('setsEmpty')}</p> : (
        <ul className={css.list}>
          {sets.map(set => (
            <li key={set.name} className={css.item}>
              <div className={css.rowHead}>
                <code className={css.name}>{set.name}</code>
                <button type="button" className={css.remove} disabled={busy} onClick={() => { void change(() => removeSet(set.name)) }}>
                  {t('remove')}
                </button>
              </div>
              <p className={css.meta}>{set.version === undefined ? set.spec : `${set.spec} · ${set.version}`}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
