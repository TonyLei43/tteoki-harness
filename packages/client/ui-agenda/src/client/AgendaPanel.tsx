/** Agenda main panel: connectors, secrets, the Obsidian note folder, sync, and the next 30 days. */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { AgendaItem, ConnectorConfig, ConnectorKind, ConnectorSettings, ConnectorsStatus } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { CoursesSection } from './CoursesSection.tsx'
import { byDay, clock, DAY, dayHeading, relative } from './model.ts'
import type { AgendaInjected } from './model.ts'
import { fill } from './Widgets.tsx'
import css from './AgendaPanel.module.css'

/** Props the renderer binds for the panel. */
export type AgendaPanelProps =
  PropsRuntime<'main'>
  & PropsLocale<'agenda'>
  & InjectFace<AgendaInjected>

/**
 * Derive a connector id and credential name from its display name.
 * @param kind - connector kind.
 * @param name - display name.
 * @param taken - ids already in use.
 * @returns a unique id and its credential reference.
 */
export function connectorIdentity(kind: ConnectorKind, name: string, taken: ReadonlySet<string>): { id: string; secret: string } {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || kind
  let id = base
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`
  return { id, secret: `${kind === 'canvas' ? 'CANVAS' : 'ICS'}_${id.toUpperCase().replace(/-/g, '_')}` }
}

/** A connector being added. */
interface Draft {
  readonly kind: ConnectorKind
  readonly name: string
  readonly baseUrl: string
  readonly secret: string
}

/**
 * Render the Agenda panel.
 * @param props - locale binding and the agenda face.
 * @returns the panel element.
 */
export function AgendaPanel(props: AgendaPanelProps) {
  const { t, getSettings, setSettings, setSecret, status: loadStatus, sync, agenda, revision, knowledgeBases: loadKnowledgeBases } = props
  const version = useSyncExternalStore(revision.subscribe, revision.getSnapshot)
  const [settings, setLocalSettings] = useState<ConnectorSettings | undefined>()
  const [status, setStatus] = useState<ConnectorsStatus | undefined>()
  const [items, setItems] = useState<readonly AgendaItem[]>([])
  const [bases, setBases] = useState<readonly { readonly id: string; readonly name: string }[]>([])
  const [draft, setDraft] = useState<Draft | undefined>()
  const [secretFor, setSecretFor] = useState<{ id: string; value: string } | undefined>()
  const [notesDir, setNotesDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const now = Date.now()

  const run = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await task()
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const reload = useCallback(async (): Promise<void> => {
    const [nextSettings, nextStatus, nextItems, nextBases] = await Promise.all([getSettings(), loadStatus(), agenda(new Date(Date.now() - DAY), new Date(Date.now() + 30 * DAY)), loadKnowledgeBases()])
    setBases(nextBases)
    setLocalSettings(nextSettings)
    setNotesDir(nextSettings.notesDir ?? '')
    setStatus(nextStatus)
    setItems(nextItems)
  }, [getSettings, loadStatus, agenda, loadKnowledgeBases])

  useEffect(() => {
    reload().catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)) })
  }, [reload, version])

  const saveConnectors = async (connectors: readonly ConnectorConfig[]): Promise<void> => {
    setLocalSettings(await setSettings({ connectors }))
    setStatus(await loadStatus())
  }

  const connectors = settings?.connectors ?? []
  const statusOf = (id: string) => status?.connectors.find(entry => entry.id === id)

  return (
    <div className={css.panel}>
      <header className={css.header}>
        <div>
          <h1 className={css.title}>{t('title')}</h1>
          <p className={css.caption}>{t('intro')}</p>
        </div>
        <div className={css.row}>
          <span className={css.caption}>{status?.syncedAt === undefined ? t('neverSynced') : fill(t('syncedAt'), { time: relative(status.syncedAt, now) })}</span>
          <button type="button" className={css.primary} disabled={busy || connectors.length === 0} onClick={() => { void run(async () => { setStatus(await sync()) }) }}>
            {busy ? t('syncing') : t('syncNow')}
          </button>
        </div>
      </header>
      {error === undefined ? null : <p className={css.alert} role="alert">{fill(t('error'), { message: error })}</p>}

      <section className={css.section}>
        <h2 className={css.subtitle}>{t('connectorsTitle')}</h2>
        {connectors.length === 0 ? <p className={css.caption}>{t('noConnectors')}</p> : null}
        <ul className={css.connectors}>
          {connectors.map(connector => {
            const state = statusOf(connector.id)
            return (
              <li key={connector.id} className={css.connector}>
                <div className={css.connectorHead}>
                  <label className={css.row}>
                    <input
                      type="checkbox"
                      checked={connector.enabled}
                      aria-label={`${t('enabled')}: ${connector.name}`}
                      onChange={(event) => {
                        const enabled = event.target.checked
                        void run(() => saveConnectors(connectors.map(entry => entry.id === connector.id ? { ...entry, enabled } : entry)))
                      }}
                    />
                    <strong>{connector.name}</strong>
                  </label>
                  <span className={css.badge}>{t(`kind.${connector.kind}`)}</span>
                </div>
                <p className={state?.error === undefined ? css.caption : css.alert}>
                  {state === undefined || !state.configured
                    ? t('secretMissing')
                    : state.error ?? (state.syncedAt === 0 ? t('neverSynced') : `${fill(t('lastSync'), { time: relative(state.syncedAt, now) })} · ${fill(t('itemsCount'), { count: String(state.items) })}`)}
                </p>
                {secretFor?.id === connector.id ? (
                  <form className={css.row} onSubmit={(event) => {
                    event.preventDefault()
                    const value = secretFor.value
                    void run(async () => {
                      await setSecret(connector.id, value)
                      setSecretFor(undefined)
                      setStatus(await loadStatus())
                    })
                  }}>
                    <input
                      className={css.input}
                      type="password"
                      autoComplete="off"
                      aria-label={connector.kind === 'canvas' ? t('secretCanvas') : t('secretCalendar')}
                      placeholder={connector.kind === 'canvas' ? t('secretCanvas') : t('secretCalendar')}
                      value={secretFor.value}
                      onChange={(event) => { setSecretFor({ id: connector.id, value: event.target.value }) }}
                    />
                    <button type="button" className={css.secondary} onClick={() => { setSecretFor(undefined) }}>{t('cancel')}</button>
                    <button type="submit" className={css.primary} disabled={busy || secretFor.value.trim() === ''}>{t('save')}</button>
                  </form>
                ) : (
                  <div className={css.row}>
                    <button type="button" className={css.secondary} onClick={() => { setSecretFor({ id: connector.id, value: '' }) }}>{t('replaceSecret')}</button>
                    <button type="button" className={css.secondary} onClick={() => { void run(() => saveConnectors(connectors.filter(entry => entry.id !== connector.id))) }}>{t('remove')}</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {draft === undefined ? (
          <div className={css.row}>
            <button type="button" className={css.secondary} onClick={() => { setDraft({ kind: 'ics', name: '', baseUrl: '', secret: '' }) }}>{t('addCalendar')}</button>
            <button type="button" className={css.secondary} onClick={() => { setDraft({ kind: 'canvas', name: 'Canvas', baseUrl: 'https://canvas.uw.edu', secret: '' }) }}>{t('addCanvas')}</button>
          </div>
        ) : (
          <form className={css.form} onSubmit={(event) => {
            event.preventDefault()
            const { id, secret } = connectorIdentity(draft.kind, draft.name, new Set(connectors.map(entry => entry.id)))
            const connector: ConnectorConfig = draft.kind === 'canvas'
              ? { id, kind: 'canvas', name: draft.name.trim(), enabled: true, secret, baseUrl: draft.baseUrl.trim() }
              : { id, kind: 'ics', name: draft.name.trim(), enabled: true, secret }
            void run(async () => {
              await saveConnectors([...connectors, connector])
              await setSecret(id, draft.secret)
              setDraft(undefined)
              setStatus(await sync())
            })
          }}>
            <p className={css.caption}>{draft.kind === 'canvas' ? t('canvasHint') : t('calendarHint')}</p>
            <input className={css.input} aria-label={t('name')} placeholder={t('name')} value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }} />
            {draft.kind === 'canvas'
              ? <input className={css.input} aria-label={t('baseUrl')} placeholder={t('baseUrl')} value={draft.baseUrl} onChange={(event) => { setDraft({ ...draft, baseUrl: event.target.value }) }} />
              : null}
            <input
              className={css.input}
              type="password"
              autoComplete="off"
              aria-label={draft.kind === 'canvas' ? t('secretCanvas') : t('secretCalendar')}
              placeholder={draft.kind === 'canvas' ? t('secretCanvas') : t('secretCalendar')}
              value={draft.secret}
              onChange={(event) => { setDraft({ ...draft, secret: event.target.value }) }}
            />
            <div className={css.row}>
              <button type="button" className={css.secondary} onClick={() => { setDraft(undefined) }}>{t('cancel')}</button>
              <button type="submit" className={css.primary} disabled={busy || draft.name.trim() === '' || draft.secret.trim() === ''}>{t('save')}</button>
            </div>
          </form>
        )}
      </section>

      <CoursesSection
        t={t}
        courses={settings?.courses ?? []}
        knowledgeBases={bases}
        busy={busy}
        onSave={courses => run(async () => { setLocalSettings(await setSettings({ courses })) })}
      />

      <section className={css.section}>
        <h2 className={css.subtitle}>{t('notesTitle')}</h2>
        <p className={css.caption}>{t('notesHint')}</p>
        <form className={css.row} onSubmit={(event) => {
          event.preventDefault()
          void run(async () => { setLocalSettings(await setSettings({ notesDir: notesDir.trim() === '' ? null : notesDir.trim() })) })
        }}>
          <input className={css.input} aria-label={t('notesTitle')} placeholder={t('notesPlaceholder')} value={notesDir} onChange={(event) => { setNotesDir(event.target.value) }} />
          <button type="submit" className={css.secondary} disabled={busy || notesDir.trim() === (settings?.notesDir ?? '')}>{t('save')}</button>
        </form>
      </section>

      <section className={css.section}>
        <h2 className={css.subtitle}>{t('agendaTitle')}</h2>
        {items.length === 0 ? <p className={css.caption}>{t('noItems')}</p> : null}
        {byDay(items).map(group => (
          <div key={group.key} className={css.day}>
            <h3 className={css.dayHeading}>{dayHeading(group.key, now, { today: t('today'), tomorrow: t('tomorrow') })}</h3>
            <ul className={css.items}>
              {group.items.map(item => (
                <li key={item.id} className={css.item}>
                  <span className={css.time}>{item.allDay ? t('allDay') : clock(item.start)}</span>
                  <span className={css.itemTitle}>
                    {item.url === undefined ? item.title : <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>}
                  </span>
                  <span className={css.caption}>{[item.course, item.location].filter(part => part !== undefined).join(' · ')}</span>
                  {item.status === undefined ? null : <span className={css.badge}>{t(`status.${item.status}`)}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  )
}
