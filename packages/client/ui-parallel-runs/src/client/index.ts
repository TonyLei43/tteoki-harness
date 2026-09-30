/**
 * Parallel runs, browser half: one `main` keyed panel and its
 * `sidebar.panellist` entry. Starting a run creates one git worktree per lane
 * through the `worktrees` Remote namespace, then one session per lane in that
 * worktree with the lane's agent preset, and sends every session the prompt.
 * Review comments reach a lane's agent as an ordinary follow-up prompt.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the slot registry merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the layout SlotMap merge (the 'main' keyed slot) and its ids.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the sidebar's SlotMap merge (the 'sidebar.panellist' list).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: the cross-Controller Workspace navigation merge (ctx.uiWorkspace).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: the ctx.remote merge and the session, preset, and worktree wire vocabulary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { WorktreeRun } from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { ParallelRunsPanel } from './ParallelRunsPanel.tsx'
import type { ParallelRunsInjected } from './ParallelRunsPanel.tsx'
import { ParallelRunsPanelIcon } from './ParallelRunsPanelIcon.tsx'
import { en } from './locales.ts'

export { formatFeedback, parsePatch } from './diff.ts'
export type { DiffComment, DiffFile, DiffHunk, DiffLine } from './diff.ts'
export type { LaneRequest, ParallelRunsInjected, ParallelRunsPanelProps, RunPreset } from './ParallelRunsPanel.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'parallelRuns'

/** The id shared by the sidebar entry and the main panel it opens. */
const PANEL_ID = 'parallel-runs' as MainPanelId

/** Required services. */
export const inject = ['slots', 'locale', 'remote', 'remote.worktrees', 'remote.session', 'remote.agentPresets', 'uiWorkspace']

/**
 * Unwrap a Remote result.
 * @param method - `namespace/method` for the failure message.
 * @param result - the Remote call result.
 * @returns the success value.
 * @throws Error carrying the Remote error's message on failure.
 */
function unwrap<T>(method: string, result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${method}: ${result.error.message}`)
  return result.value
}

/**
 * Mount the parallel runs panel and its sidebar entry.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, 'en', en), 'ui-parallel-runs: dictionaries')

  const prompt = async (sessionId: string, text: string): Promise<void> => {
    unwrap('session/prompt', await ctx.remote.session.prompt({
      requestId: brandString<SessionRequestId>(randomUUID()),
      sessionId: brandString<SessionId>(sessionId),
      mode: 'queue',
      content: [{ type: 'text', text }],
    }))
  }

  const face: ParallelRunsInjected = {
    listRuns: async () => unwrap('worktrees/listRuns', await ctx.remote.worktrees.listRuns()).runs,
    listPresets: async () => {
      const result = await ctx.remote.agentPresets.list()
      // Agent presets are optional: an unmounted service is an empty roster.
      if (!result.ok) return []
      return result.value.presets.filter(preset => preset.broken === undefined).map(preset => ({ id: preset.id, name: preset.name ?? undefined }))
    },
    startRun: async (repo, text, lanes) => {
      let run: WorktreeRun = unwrap('worktrees/startRun', await ctx.remote.worktrees.startRun({ repo, prompt: text, lanes }))
      for (const lane of run.lanes) {
        const created = unwrap('session/create', await ctx.remote.session.create({ cwd: lane.path, ...lane.preset === undefined ? {} : { agentPreset: lane.preset } }))
        run = unwrap('worktrees/attachSession', await ctx.remote.worktrees.attachSession({ runId: run.id, laneId: lane.id, sessionId: created.sessionId }))
        await prompt(created.sessionId, text)
      }
      return run
    },
    diff: async (runId, laneId) => unwrap('worktrees/diff', await ctx.remote.worktrees.diff({ runId, laneId })),
    merge: async (runId, laneId, message) => unwrap('worktrees/merge', await ctx.remote.worktrees.merge({ runId, laneId, message })).run,
    discard: async (runId) => { unwrap('worktrees/discard', await ctx.remote.worktrees.discard({ runId })) },
    sendFeedback: prompt,
    openSession: (sessionId) => { ctx.uiWorkspace.openSession(brandString<SessionId>(sessionId)) },
  }

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: (): ParallelRunsInjected => face,
  }, ParallelRunsPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 22,
    locale: NS,
    label: () => t('nav'),
  }, ParallelRunsPanelIcon))
}
