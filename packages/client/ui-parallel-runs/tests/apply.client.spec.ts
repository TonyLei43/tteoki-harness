/** The parallel runs browser plugin: registration and Remote orchestration. */

import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import type { ParallelRunsInjected } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

const RUN = {
  id: 'r1', repo: '/repo', base: 'abc', baseRef: 'main', prompt: 'Task', createdAt: 0,
  lanes: [{ id: 'a', label: 'Academic', preset: 'academic', path: '/w/a', branch: 'agents/r1-a' }, { id: 'b', label: 'Default', path: '/w/b', branch: 'agents/r1-b' }],
}
const ok = <T>(value: T) => ({ ok: true as const, value })
const fail = (message: string) => ({ ok: false as const, error: { code: 'gateway/bad-request', message } })

async function bench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
  }
  new RemoteService(ctx)
  const worktrees = {
    listRuns: vi.fn(async () => ok({ runs: [RUN] })),
    startRun: vi.fn(async () => ok(RUN)),
    attachSession: vi.fn(async (request: { laneId: string; sessionId: string }) => ok({ ...RUN, lanes: RUN.lanes.map(lane => lane.id === request.laneId ? { ...lane, sessionId: request.sessionId } : lane) })),
    diff: vi.fn(async () => ok({ files: [], patch: '', truncated: false })),
    merge: vi.fn(async () => ok({ run: { ...RUN, mergedLane: 'a' }, head: 'def' })),
    discard: vi.fn(async () => ok({})),
  }
  let sessionCount = 0
  const session = {
    create: vi.fn(async () => ok({ sessionId: `s${++sessionCount}` })),
    prompt: vi.fn(async (_request: { sessionId: string; content: unknown }) => ok({})),
  }
  const agentPresets = { list: vi.fn(async () => ok({ presets: [{ id: 'academic', name: 'Academic' }, { id: 'broken', broken: 'x' }, { id: 'ai', name: null }] })) }
  const uiWorkspace = { openSession: vi.fn() }
  ctx.provide('remote.worktrees', worktrees)
  ctx.provide('remote.session', session)
  ctx.provide('remote.agentPresets', agentPresets)
  ctx.provide('uiWorkspace', uiWorkspace)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: { 'main': { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } } } as never, () => null)
  await ctx.plugin({ inject: [...inject], apply }).await()
  const panel = slots.entries('main').find(entry => (entry.options as { key?: string }).key === 'parallel-runs')!
  return { slots, worktrees, session, agentPresets, uiWorkspace, face: (panel.inject as unknown as () => ParallelRunsInjected)() }
}

describe('ui-parallel-runs browser plugin', () => {
  it('keeps the host Loader entry inert and declares its services', () => {
    expect(hostApply).not.toThrow()
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.worktrees', 'remote.session', 'remote.agentPresets', 'uiWorkspace'])
  })

  it('registers the panel and a localized sidebar entry', async () => {
    const subject = await bench()
    const nav = subject.slots.entries('sidebar.panellist').find(entry => (entry.options as { id?: string }).id === 'parallel-runs')!
    expect(resolveSlotLabel(nav.options.label)).toBe('Parallel')
  })

  it('starts a run: one session per lane in its worktree with its preset, attached and prompted', async () => {
    const subject = await bench()
    const run = await subject.face.startRun('/repo/src', 'Task', [{ label: 'Academic', preset: 'academic' }, { label: 'Default' }])
    expect(subject.worktrees.startRun).toHaveBeenCalledWith({ repo: '/repo/src', prompt: 'Task', lanes: [{ label: 'Academic', preset: 'academic' }, { label: 'Default' }] })
    expect(subject.session.create.mock.calls).toEqual([[{ cwd: '/w/a', agentPreset: 'academic' }], [{ cwd: '/w/b' }]])
    expect(subject.worktrees.attachSession.mock.calls.map(([request]) => request)).toEqual([{ runId: 'r1', laneId: 'a', sessionId: 's1' }, { runId: 'r1', laneId: 'b', sessionId: 's2' }])
    expect(subject.session.prompt.mock.calls.map(([request]) => [request.sessionId, request.content])).toEqual([
      ['s1', [{ type: 'text', text: 'Task' }]],
      ['s2', [{ type: 'text', text: 'Task' }]],
    ])
    expect(run.lanes.map(lane => lane.sessionId)).toEqual([undefined, 's2'])
  })

  it('wires listing, presets, diff, merge, discard, feedback, and navigation', async () => {
    const subject = await bench()
    await expect(subject.face.listRuns()).resolves.toEqual([RUN])
    await expect(subject.face.listPresets()).resolves.toEqual([{ id: 'academic', name: 'Academic' }, { id: 'ai', name: undefined }])
    await expect(subject.face.diff('r1' as never, 'a' as never)).resolves.toEqual({ files: [], patch: '', truncated: false })
    await expect(subject.face.merge('r1' as never, 'a' as never, 'msg')).resolves.toMatchObject({ mergedLane: 'a' })
    expect(subject.worktrees.merge).toHaveBeenCalledWith({ runId: 'r1', laneId: 'a', message: 'msg' })
    await expect(subject.face.discard('r1' as never)).resolves.toBeUndefined()
    await subject.face.sendFeedback('s1', 'fix it')
    expect(subject.session.prompt).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: 's1', mode: 'queue', content: [{ type: 'text', text: 'fix it' }] }))
    subject.face.openSession('s1')
    expect(subject.uiWorkspace.openSession).toHaveBeenCalledWith('s1')
  })

  it('surfaces Remote failures by message and treats missing presets as an empty roster', async () => {
    const subject = await bench()
    subject.worktrees.startRun.mockResolvedValueOnce(fail('/tmp is not inside a git repository') as never)
    await expect(subject.face.startRun('/tmp', 'x', [{ label: 'a' }])).rejects.toThrow('worktrees/startRun: /tmp is not inside a git repository')
    subject.session.create.mockResolvedValueOnce(fail('workspace missing') as never)
    await expect(subject.face.startRun('/repo', 'x', [{ label: 'a' }])).rejects.toThrow('session/create: workspace missing')
    subject.agentPresets.list.mockResolvedValueOnce(fail('no presets') as never)
    await expect(subject.face.listPresets()).resolves.toEqual([])
  })
})
