/**
 * Native orchestrator board: every DSH session grouped by project directory,
 * each row carrying its status pill, plus one auto-router input. Live rows read
 * the framework's `useSessions` and `useSessionStatus` hooks; the router's
 * decision and the preset roster are component-local.
 */

import { useEffect, useMemo, useState } from 'react'
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { activityLabel, buildRows, orderedGroups, type BoardRow, type BoardStatus } from './board.ts'
import type { OrchestratorLocaleKey } from './locales.ts'
import {
  presetLabel, routeIntent, type RouteIntentOptions, type RoutePreset, type RouteSession, type RouteTarget,
} from './router.ts'
import { StatusPill } from './StatusPill.tsx'
import css from './OrchestratorBoard.module.css'

/** Registration-side business face for the board panel. */
export interface OrchestratorBoardInjected {
  /** @returns the selectable, composable agent presets. */
  loadPresets: () => Promise<readonly RoutePreset[]>
  /**
   * Create a session composed with one agent preset and return its identity.
   * @param presetId - the preset the new session runs.
   * @returns the created session id.
   */
  createSessionForPreset: (presetId: string) => Promise<SessionId>
  /**
   * Send one prompt to a session through the session Remote.
   * @param sessionId - the session to prompt.
   * @param text - the prompt text.
   */
  promptSession: (sessionId: SessionId, text: string) => Promise<void>
  /**
   * Select a session and show its conversation.
   * @param sessionId - the session to open.
   */
  openSession: (sessionId: SessionId) => void
  /**
   * Optional model-based classifier seam. When supplied it replaces the pure
   * token router; when absent the board uses `routeIntent`. A classifier must
   * stay optional so v1 needs no model call.
   */
  classify?: ((input: string, options: RouteIntentOptions) => Promise<RouteTarget | undefined> | RouteTarget | undefined) | undefined
}

/** Board panel props: the runtime share (sessions + status hooks), the locale seat, and the injected face. */
export type OrchestratorBoardProps =
  PropsRuntime<'main'>
  & PropsLocale<'orchestrator'>
  & InjectFace<OrchestratorBoardInjected>

/** Dictionary keys naming each board status's pill label. */
const STATUS_LABEL_KEYS: Readonly<Record<BoardStatus, OrchestratorLocaleKey>> = {
  'needs-feedback': 'state.needs-feedback',
  error: 'state.error',
  retrying: 'state.retrying',
  running: 'state.running',
  done: 'state.done',
  idle: 'state.idle',
}

/** The board-local notice on display, or undefined. */
type BoardNotice = 'no-targets' | 'error'

/**
 * Render the orchestrator board and its auto-router.
 * @param props - the framework session hooks, localized copy, and the board actions.
 * @returns the board.
 */
export function OrchestratorBoard({
  t, useSessions, useSessionStatus, loadPresets, createSessionForPreset, promptSession, openSession, classify,
}: OrchestratorBoardProps) {
  const sessions = useSessions(state => state)
  const statuses = useSessionStatus(map => map)
  const [presets, setPresets] = useState<readonly RoutePreset[]>([])
  const [ask, setAsk] = useState('')
  const [routing, setRouting] = useState(false)
  const [routed, setRouted] = useState<string>()
  const [notice, setNotice] = useState<BoardNotice>()

  useEffect(() => {
    let active = true
    loadPresets().then(
      (loaded) => { if (active) setPresets(loaded) },
      () => { if (active) setPresets([]) },
    )
    return () => { active = false }
  }, [loadPresets])

  const rows = useMemo(() => buildRows(sessions, statuses), [sessions, statuses])
  const groups = useMemo(() => orderedGroups(rows), [rows])

  // The classifier seam: an injected model classifier wins, else the pure
  // token router. Both receive the same candidate sets and return one target.
  const decide = async (text: string, options: RouteIntentOptions): Promise<RouteTarget | undefined> =>
    classify === undefined ? routeIntent(text, options) : await classify(text, options)

  const submit = async (): Promise<void> => {
    const text = ask.trim()
    if (text === '') return
    if (rows.length === 0 && presets.length === 0) {
      setNotice('no-targets')
      return
    }
    const options: RouteIntentOptions = { sessions: rows.map(toRouteSession), presets }
    setRouting(true)
    setNotice(undefined)
    setRouted(undefined)
    let target: RouteTarget | undefined
    try {
      target = await decide(text, options)
    } catch {
      setNotice('error')
      setRouting(false)
      return
    }
    if (target === undefined) {
      setNotice('no-targets')
      setRouting(false)
      return
    }
    try {
      if (target.kind === 'session') {
        await promptSession(target.session.id, text)
        setRouted(target.session.title)
        openSession(target.session.id)
      } else {
        const id = await createSessionForPreset(target.preset.id)
        await promptSession(id, text)
        setRouted(presetLabel(target.preset))
        openSession(id)
      }
      setAsk('')
    } catch {
      setNotice('error')
    } finally {
      setRouting(false)
    }
  }

  return (
    <div className={css.board}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      <div className={css.router}>
        <input
          className={css.routerInput}
          value={ask}
          aria-label={t('ask.placeholder')}
          placeholder={t('ask.placeholder')}
          onChange={(event) => { setAsk(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <button
          type="button"
          className={css.routerSend}
          disabled={routing || ask.trim() === ''}
          onClick={() => { void submit() }}
        >
          {routing ? t('ask.routing') : t('ask.send')}
        </button>
      </div>
      {routed === undefined ? null : <p className={css.routed} role="status">{t('ask.routed', { target: routed })}</p>}
      {notice === 'no-targets' ? <p className={css.notice} role="alert">{t('ask.noTargets')}</p> : null}
      {notice === 'error' ? <p className={css.notice} role="alert">{t('ask.error')}</p> : null}
      {sessions.phase === 'pending'
        ? <p className={css.notice}>{t('loading')}</p>
        : groups.length === 0
          ? <p className={css.notice}>{t('empty')}</p>
          : (
            <ul className={css.groups}>
              {groups.map(group => (
                <li key={group.cwd}>
                  <h3 className={css.groupName}>
                    {group.cwd === '' ? t('group.untitled') : group.name}
                    {group.cwd === '' ? null : <span aria-hidden={true}>{` — ${group.cwd}`}</span>}
                  </h3>
                  <ul className={css.rows}>
                    {group.rows.map(row => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className={css.rowButton}
                          aria-label={t('open.session', { title: row.title })}
                          onClick={() => { openSession(row.id) }}
                        >
                          <StatusPill state={row.status} label={t(STATUS_LABEL_KEYS[row.status])} />
                          <span className={css.rowMain}>
                            <span className={css.rowTitle}>{row.title}</span>
                            <span className={css.rowMeta}>{rowMeta(row, t)}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
    </div>
  )
}

/**
 * The board row as a router candidate.
 * @param row - the display row.
 * @returns the session candidate.
 */
function toRouteSession(row: BoardRow): RouteSession {
  return {
    id: row.id,
    title: row.title,
    cwd: row.cwd === '' ? undefined : row.cwd,
    agentPreset: row.preset,
    updatedAt: row.updatedAt,
  }
}

/**
 * The row's meta line: agent preset and last-activity label, skipping the
 * preset when absent.
 * @param row - the display row.
 * @param t - localized labels for the meta names and activity buckets.
 * @returns the joined meta text.
 */
function rowMeta(row: BoardRow, t: OrchestratorBoardProps['t']): string {
  const parts = [
    ...(row.preset === undefined ? [] : [t('meta.preset', { name: row.preset })]),
    activityLabel(t, relativeTime(row.updatedAt, Date.now())),
  ]
  return parts.join(' · ')
}