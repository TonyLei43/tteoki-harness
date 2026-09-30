/** Parallel runs main panel: start runs, compare lane changes, review, and merge. */

import { useCallback, useEffect, useState } from 'react'
import type { WorktreeDiffValue, WorktreeLane, WorktreeLaneId, WorktreeRun, WorktreeRunId } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { DiffView } from './DiffView.tsx'
import { formatFeedback } from './diff.ts'
import type { DiffComment } from './diff.ts'
import type { ParallelRunsLocaleKey } from './locales.ts'
import css from './ParallelRunsPanel.module.css'

/** One selectable agent preset. */
export interface RunPreset {
  readonly id: string
  readonly name?: string | undefined
}

/** One lane the user asks for when starting a run. */
export interface LaneRequest {
  readonly label: string
  readonly preset?: string
}

/** Registration-side business face for the panel. */
export interface ParallelRunsInjected {
  /** @returns recorded runs, newest first. */
  listRuns: () => Promise<readonly WorktreeRun[]>
  /** @returns selectable agent presets. */
  listPresets: () => Promise<readonly RunPreset[]>
  /**
   * Create the run's worktrees, one session per lane in its worktree, and send each session the prompt.
   * @param repo - folder inside the repository.
   * @param prompt - prompt for every lane.
   * @param lanes - lanes to create.
   * @returns the run with every lane's session attached.
   */
  startRun: (repo: string, prompt: string, lanes: readonly LaneRequest[]) => Promise<WorktreeRun>
  /**
   * Read one lane's changes.
   * @param runId - the run.
   * @param laneId - the lane.
   * @returns changed files and the unified diff.
   */
  diff: (runId: WorktreeRunId, laneId: WorktreeLaneId) => Promise<WorktreeDiffValue>
  /**
   * Merge one lane into the repository's checked-out branch.
   * @param runId - the run.
   * @param laneId - the lane.
   * @param message - commit message for uncommitted lane changes.
   * @returns the updated run.
   */
  merge: (runId: WorktreeRunId, laneId: WorktreeLaneId, message: string) => Promise<WorktreeRun>
  /**
   * Delete a run's worktrees and branches.
   * @param runId - the run.
   */
  discard: (runId: WorktreeRunId) => Promise<void>
  /**
   * Send review feedback to a lane's session as a follow-up prompt.
   * @param sessionId - the lane's session.
   * @param text - the message.
   */
  sendFeedback: (sessionId: string, text: string) => Promise<void>
  /**
   * Open a lane's session in the conversation view.
   * @param sessionId - the session.
   */
  openSession: (sessionId: string) => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Parallel runs panel copy. */
    parallelRuns: ParallelRunsLocaleKey
  }
}

/** Props the renderer binds for the panel. */
export type ParallelRunsPanelProps =
  PropsRuntime<'main'>
  & PropsLocale<'parallelRuns'>
  & InjectFace<ParallelRunsInjected>

/** Locale lookup shared by the panel's parts. */
type Translate = (key: ParallelRunsLocaleKey) => string

/**
 * Fill `{name}` placeholders in a translated string.
 * @param template - translated text.
 * @param values - placeholder values.
 * @returns the filled text.
 */
function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match)
}

/**
 * Read an error's message.
 * @param error - a thrown value.
 * @returns its message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Props for {@link LaneCard}. */
interface LaneCardProps extends Pick<ParallelRunsInjected, 'diff' | 'merge' | 'sendFeedback' | 'openSession'> {
  readonly t: Translate
  readonly run: WorktreeRun
  readonly lane: WorktreeLane
  readonly onMerged: (run: WorktreeRun) => void
  readonly onError: (message: string) => void
}

/**
 * One lane: its session, changes with review comments, and merge.
 * @param props - the lane, its run, and actions.
 * @returns the lane card.
 */
function LaneCard({ t, run, lane, diff, merge, sendFeedback, openSession, onMerged, onError }: LaneCardProps) {
  const [changes, setChanges] = useState<WorktreeDiffValue | undefined>()
  const [open, setOpen] = useState(false)
  const [comments, setComments] = useState<readonly DiffComment[]>([])
  const [mergeMessage, setMergeMessage] = useState<string | undefined>()
  const [busy, setBusy] = useState<'diff' | 'merge' | 'send' | undefined>()
  const [sent, setSent] = useState(false)
  const merged = run.mergedLane === lane.id

  const act = async (kind: 'diff' | 'merge' | 'send', task: () => Promise<void>): Promise<void> => {
    setBusy(kind)
    try {
      await task()
    } catch (error: unknown) {
      onError(messageOf(error))
    } finally {
      setBusy(undefined)
    }
  }

  const loadChanges = (): Promise<void> => act('diff', async () => { setChanges(await diff(run.id, lane.id)) })
  const additions = changes?.files.reduce((total, file) => total + (file.additions ?? 0), 0)
  const deletions = changes?.files.reduce((total, file) => total + (file.deletions ?? 0), 0)

  return (
    <article className={merged ? `${css.lane} ${css.laneMerged}` : css.lane}>
      <header className={css.laneHead}>
        <div className={css.laneTitle}>
          <span className={css.dot} data-state={merged ? 'merged' : lane.sessionId === undefined ? 'idle' : 'active'} />
          <strong>{lane.label}</strong>
          {merged ? <span className={css.badge}>{t('merged')}</span> : null}
        </div>
        <code className={css.branch}>{lane.branch}</code>
      </header>
      <div className={css.laneActions}>
        {lane.sessionId === undefined
          ? <span className={css.caption}>{t('noSession')}</span>
          : <button type="button" className={css.secondary} onClick={() => { if (lane.sessionId !== undefined) openSession(lane.sessionId) }}>{t('openSession')}</button>}
        <button type="button" className={css.secondary} disabled={busy !== undefined} onClick={() => {
          if (open) { setOpen(false); return }
          setOpen(true)
          void loadChanges()
        }}>
          {open ? t('hideDiff') : t('viewDiff')}
        </button>
        {open ? <button type="button" className={css.secondary} disabled={busy !== undefined} onClick={() => { void loadChanges() }}>{t('refresh')}</button> : null}
        {run.mergedLane === undefined && mergeMessage === undefined
          ? <button type="button" className={css.primary} disabled={busy !== undefined} onClick={() => { setMergeMessage(`${lane.label}: ${run.prompt.split('\n')[0]?.slice(0, 60) ?? ''}`) }}>{t('merge')}</button>
          : null}
      </div>
      {changes !== undefined && open ? <p className={css.caption}>{fill(t('changeSummary'), { files: String(changes.files.length), additions: String(additions ?? 0), deletions: String(deletions ?? 0) })}</p> : null}
      {mergeMessage === undefined ? null : (
        <form className={css.mergeForm} onSubmit={(event) => {
          event.preventDefault()
          void act('merge', async () => {
            const next = await merge(run.id, lane.id, mergeMessage)
            setMergeMessage(undefined)
            onMerged(next)
          })
        }}>
          <input className={css.input} value={mergeMessage} aria-label={t('mergeMessage')} onChange={(event) => { setMergeMessage(event.target.value) }} />
          <div className={css.row}>
            <button type="button" className={css.secondary} onClick={() => { setMergeMessage(undefined) }}>{t('cancel')}</button>
            <button type="submit" className={css.primary} disabled={busy !== undefined || mergeMessage.trim() === ''}>
              {busy === 'merge' ? t('merging') : fill(t('confirmMerge'), { ref: run.baseRef })}
            </button>
          </div>
        </form>
      )}
      {merged ? <p className={css.caption}>{fill(t('mergedInto'), { ref: run.baseRef })}</p> : null}
      {comments.length > 0 ? (
        <div className={css.comments}>
          <p className={css.caption}>{fill(t('comments'), { count: String(comments.length) })}</p>
          <ul className={css.commentList}>
            {comments.map((comment, index) => (
              <li key={`${comment.path}:${index}`}>
                <code>{`${comment.path}:${comment.line.newNumber ?? comment.line.oldNumber ?? ''}`}</code> {comment.text}
                <button type="button" className={css.link} aria-label={t('removeComment')} onClick={() => { setComments(comments.filter((_, other) => other !== index)) }}>×</button>
              </li>
            ))}
          </ul>
          <button type="button" className={css.primary} disabled={busy !== undefined || lane.sessionId === undefined} onClick={() => {
            const sessionId = lane.sessionId
            if (sessionId === undefined) return
            void act('send', async () => {
              await sendFeedback(sessionId, formatFeedback(comments))
              setComments([])
              setSent(true)
            })
          }}>
            {busy === 'send' ? t('sending') : t('sendFeedback')}
          </button>
        </div>
      ) : null}
      {sent && comments.length === 0 ? <p className={css.caption}>{t('sent')}</p> : null}
      {open && busy === 'diff' && changes === undefined ? <p className={css.caption}>{t('loadingDiff')}</p> : null}
      {open && changes !== undefined ? (
        <DiffView t={t} diff={changes} onComment={(comment) => { setComments([...comments, comment]); setSent(false) }} />
      ) : null}
    </article>
  )
}

/** Props for {@link NewRunForm}. */
interface NewRunFormProps {
  readonly t: Translate
  readonly presets: readonly RunPreset[]
  readonly busy: boolean
  readonly onStart: (repo: string, prompt: string, lanes: readonly LaneRequest[]) => void
  readonly onCancel: () => void
}

/**
 * The new-run form: repository, prompt, and one preset per lane.
 * @param props - presets and submit/cancel actions.
 * @returns the form.
 */
function NewRunForm({ t, presets, busy, onStart, onCancel }: NewRunFormProps) {
  const [repo, setRepo] = useState('')
  const [prompt, setPrompt] = useState('')
  const [lanes, setLanes] = useState<readonly (string | undefined)[]>([undefined, undefined])
  const labelFor = (preset: string | undefined): string => presets.find(entry => entry.id === preset)?.name ?? preset ?? t('noPreset')
  return (
    <form className={css.form} onSubmit={(event) => {
      event.preventDefault()
      onStart(repo.trim(), prompt, lanes.map(preset => preset === undefined ? { label: labelFor(preset) } : { label: labelFor(preset), preset }))
    }}>
      <label className={css.field}>
        <span className={css.label}>{t('repo')}</span>
        <input className={css.input} value={repo} placeholder={t('repoHint')} onChange={(event) => { setRepo(event.target.value) }} />
      </label>
      <label className={css.field}>
        <span className={css.label}>{t('prompt')}</span>
        <textarea className={css.textarea} value={prompt} placeholder={t('promptHint')} onChange={(event) => { setPrompt(event.target.value) }} />
      </label>
      <fieldset className={css.field}>
        <legend className={css.label}>{`${t('lanes')} — ${t('lanesHint')}`}</legend>
        {lanes.map((preset, index) => (
          <div key={index} className={css.row}>
            <select className={css.input} value={preset ?? ''} aria-label={`${t('lanes')} ${index + 1}`} onChange={(event) => {
              const value = event.target.value
              setLanes(lanes.map((entry, other) => other === index ? (value === '' ? undefined : value) : entry))
            }}>
              <option value="">{t('noPreset')}</option>
              {presets.map(entry => <option key={entry.id} value={entry.id}>{entry.name ?? entry.id}</option>)}
            </select>
            <button type="button" className={css.secondary} aria-label={t('removeLane')} disabled={lanes.length <= 1} onClick={() => { setLanes(lanes.filter((_, other) => other !== index)) }}>×</button>
          </div>
        ))}
        <button type="button" className={css.secondary} disabled={lanes.length >= 8} onClick={() => { setLanes([...lanes, undefined]) }}>{t('addLane')}</button>
      </fieldset>
      <div className={css.row}>
        <button type="button" className={css.secondary} onClick={onCancel}>{t('cancel')}</button>
        <button type="submit" className={css.primary} disabled={busy || repo.trim() === '' || prompt.trim() === ''}>{busy ? t('starting') : t('start')}</button>
      </div>
    </form>
  )
}

/**
 * Render the parallel runs panel.
 * @param props - locale binding and the injected business face.
 * @returns the panel element.
 */
export function ParallelRunsPanel({ t, listRuns, listPresets, startRun, diff, merge, discard, sendFeedback, openSession }: ParallelRunsPanelProps) {
  const [runs, setRuns] = useState<readonly WorktreeRun[]>([])
  const [presets, setPresets] = useState<readonly RunPreset[]>([])
  const [view, setView] = useState<'list' | 'new' | WorktreeRunId>('list')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setRuns(await listRuns())
    } catch (failure: unknown) {
      setError(messageOf(failure))
    }
  }, [listRuns])

  useEffect(() => {
    void refresh()
    listPresets().then(setPresets, (failure: unknown) => { setError(messageOf(failure)) })
  }, [refresh, listPresets])

  const run = typeof view === 'string' && view !== 'list' && view !== 'new' ? runs.find(entry => entry.id === view) : undefined
  const replace = (next: WorktreeRun): void => { setRuns(runs.map(entry => entry.id === next.id ? next : entry)) }

  return (
    <div className={css.panel}>
      <header className={css.header}>
        <div>
          <h1 className={css.title}>{t('title')}</h1>
          <p className={css.caption}>{t('intro')}</p>
        </div>
        <div className={css.row}>
          {view === 'list' ? null : <button type="button" className={css.secondary} onClick={() => { setView('list'); setConfirmDiscard(false) }}>{t('back')}</button>}
          <button type="button" className={css.secondary} onClick={() => { void refresh() }}>{t('refresh')}</button>
          {view === 'new' ? null : <button type="button" className={css.primary} onClick={() => { setView('new') }}>{t('newRun')}</button>}
        </div>
      </header>
      {error === undefined ? null : <p className={css.alert} role="alert">{fill(t('error'), { message: error })}</p>}

      {view === 'new' ? (
        <NewRunForm t={t} presets={presets} busy={busy} onCancel={() => { setView('list') }} onStart={(repo, prompt, lanes) => {
          setBusy(true)
          setError(undefined)
          startRun(repo, prompt, lanes).then(
            (started) => { setRuns([started, ...runs]); setView(started.id) },
            (failure: unknown) => { setError(messageOf(failure)); void refresh() },
          ).finally(() => { setBusy(false) })
        }} />
      ) : null}

      {view === 'list' ? (
        runs.length === 0 ? <p className={css.caption}>{t('noRuns')}</p> : (
          <ul className={css.runs}>
            {runs.map(entry => (
              <li key={entry.id}>
                <button type="button" className={css.runRow} onClick={() => { setView(entry.id) }}>
                  <span className={css.runPrompt}>{entry.prompt.split('\n')[0]}</span>
                  <span className={css.caption}>
                    {`${entry.repo.split('/').pop() ?? entry.repo} · ${fill(t('lanesCount'), { count: String(entry.lanes.length) })} · ${new Date(entry.createdAt).toLocaleString()}`}
                  </span>
                  {entry.mergedLane === undefined ? null : <span className={css.badge}>{t('merged')}</span>}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {run === undefined ? null : (
        <section className={css.run}>
          <div className={css.runHead}>
            <p className={css.runPromptFull}>{run.prompt}</p>
            <p className={css.caption}>{`${run.repo} — ${fill(t('base'), { ref: run.baseRef, commit: run.base.slice(0, 8) })}`}</p>
            <div className={css.row}>
              {confirmDiscard ? (
                <>
                  <button type="button" className={css.secondary} onClick={() => { setConfirmDiscard(false) }}>{t('cancel')}</button>
                  <button type="button" className={css.danger} onClick={() => {
                    discard(run.id).then(
                      () => { setRuns(runs.filter(entry => entry.id !== run.id)); setView('list'); setConfirmDiscard(false) },
                      (failure: unknown) => { setError(messageOf(failure)) },
                    )
                  }}>{t('confirmDiscard')}</button>
                </>
              ) : <button type="button" className={css.secondary} onClick={() => { setConfirmDiscard(true) }}>{t('discard')}</button>}
            </div>
          </div>
          <div className={css.lanes}>
            {run.lanes.map(lane => (
              <LaneCard
                key={lane.id}
                t={t}
                run={run}
                lane={lane}
                diff={diff}
                merge={merge}
                sendFeedback={sendFeedback}
                openSession={openSession}
                onMerged={replace}
                onError={(message) => { setError(message) }}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
