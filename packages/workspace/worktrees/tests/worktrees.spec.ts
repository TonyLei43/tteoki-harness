/** Parallel runs against real git repositories: lanes, diffs, merges, rollback, and discard. */

import { Context } from '@deepseek-ai/cordis'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { parseNumstat, slug, Worktrees } from '../src/index.ts'
import type { WorktreeLaneId, WorktreeRunId } from '../src/index.ts'

/**
 * Run git synchronously in a test repository.
 * @param cwd - repository directory.
 * @param args - git arguments.
 * @returns trimmed standard output.
 */
function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** Create a repository with one commit, a worktree root, and the service. */
function bench(maxPatchBytes = 1_000_000) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-worktrees-')))
  onTestFinished(() => { rmSync(dir, { recursive: true, force: true }) })
  const repo = join(dir, 'Course Repo')
  mkdirSync(join(repo, 'src'), { recursive: true })
  sh(repo, 'init', '-q', '-b', 'main')
  sh(repo, 'config', 'user.name', 'Test')
  sh(repo, 'config', 'user.email', 'test@example.com')
  sh(repo, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'src', 'a.txt'), 'one\ntwo\n')
  sh(repo, 'add', '.')
  sh(repo, 'commit', '-q', '-m', 'init')
  const root = join(dir, 'worktrees')
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const service = new Worktrees(ctx, { root, maxPatchBytes })
  return { dir, repo, root, ctx, service, signal: new AbortController().signal }
}

describe('helpers', () => {
  it('slugs labels into branch-safe names', () => {
    expect(slug('Academic (qwen 27B)')).toBe('academic-qwen-27b')
    expect(slug('!!!')).toBe('lane')
    expect(slug('x'.repeat(40))).toHaveLength(32)
  })

  it('parses numstat records, renames, and binary files', () => {
    expect(parseNumstat('3\t1\tsrc/a.txt\0-\t-\timg.png\0' + '2\t0\t\0old.txt\0new.txt\0')).toEqual([
      { path: 'src/a.txt', additions: 3, deletions: 1 },
      { path: 'img.png' },
      { path: 'new.txt', additions: 2, deletions: 0 },
    ])
    expect(parseNumstat('')).toEqual([])
  })
})

describe('Worktrees', () => {
  it('starts a run with one worktree and branch per lane at the current commit', async () => {
    const subject = bench()
    const base = sh(subject.repo, 'rev-parse', 'HEAD')
    const run = await subject.service.startRun({ repo: join(subject.repo, 'src'), prompt: 'Refactor', lanes: [{ label: 'Academic', preset: 'academic' }, { label: 'Academic' }] }, subject.signal)
    expect(run).toMatchObject({ repo: subject.repo, base, baseRef: 'main', prompt: 'Refactor' })
    expect(run.lanes.map(lane => [lane.id, lane.label, lane.preset])).toEqual([['academic', 'Academic', 'academic'], ['academic-2', 'Academic', undefined]])
    for (const lane of run.lanes) {
      expect(lane.path.startsWith(join(subject.root, `course-repo-${run.id}`))).toBe(true)
      expect(sh(lane.path, 'rev-parse', 'HEAD')).toBe(base)
      expect(sh(lane.path, 'branch', '--show-current')).toBe(lane.branch)
    }
    expect(lane0Branch(run.lanes)).toMatch(/^agents\/[0-9a-f]{8}-academic$/)
    expect((await subject.service.listRuns()).runs.map(entry => entry.id)).toEqual([run.id])

    const attached = await subject.service.attachSession({ runId: run.id, laneId: run.lanes[0]!.id, sessionId: 'session-1' })
    expect(attached.lanes[0]!.sessionId).toBe('session-1')
    expect(attached.lanes[1]!.sessionId).toBeUndefined()
  })

  it('rejects invalid starts and rolls back worktrees created before a failure', async () => {
    const subject = bench()
    await expect(subject.service.startRun({ repo: subject.dir, prompt: 'x', lanes: [{ label: 'a' }] }, subject.signal)).rejects.toThrow('is not inside a git repository')
    await expect(subject.service.startRun({ repo: subject.repo, prompt: ' ', lanes: [{ label: 'a' }] }, subject.signal)).rejects.toThrow('a run needs a prompt')
    await expect(subject.service.startRun({ repo: subject.repo, prompt: 'x', lanes: [] }, subject.signal)).rejects.toThrow('between 1 and 8 lanes')
    await expect(subject.service.startRun({ repo: subject.repo, prompt: 'x', lanes: Array.from({ length: 9 }, () => ({ label: 'a' })) }, subject.signal)).rejects.toThrow('between 1 and 8 lanes')

    // A post-checkout hook that fails inside lane "b" makes its `worktree add` fail after lane "a" exists.
    const hook = join(subject.repo, '.git', 'hooks', 'post-checkout')
    writeFileSync(hook, '#!/bin/sh\ncase "$PWD" in */b) exit 1;; esac\nexit 0\n', { mode: 0o755 })
    await expect(subject.service.startRun({ repo: subject.repo, prompt: 'x', lanes: [{ label: 'a' }, { label: 'b' }] }, subject.signal)).rejects.toThrow('git worktree failed')
    expect(sh(subject.repo, 'worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree '))).toHaveLength(1)
    expect(sh(subject.repo, 'branch', '--list', 'agents/*')).toBe('')
    expect(existsSync(subject.root) ? readdirSync(subject.root) : []).toEqual([])
    expect((await subject.service.listRuns()).runs).toEqual([])
  })

  it('reports a lane diff with uncommitted and untracked files and cuts long patches', async () => {
    const subject = bench(1024)
    const run = await subject.service.startRun({ repo: subject.repo, prompt: 'x', lanes: [{ label: 'a' }] }, subject.signal)
    const lane = run.lanes[0]!
    writeFileSync(join(lane.path, 'src', 'a.txt'), 'one\nTWO\nthree\n')
    writeFileSync(join(lane.path, 'notes.md'), `${'line\n'.repeat(400)}`)
    const diff = await subject.service.diff({ runId: run.id, laneId: lane.id }, subject.signal)
    expect(diff.files).toEqual([{ path: 'notes.md', additions: 400, deletions: 0 }, { path: 'src/a.txt', additions: 2, deletions: 1 }])
    expect(diff.truncated).toBe(true)
    expect(Buffer.byteLength(diff.patch)).toBeLessThanOrEqual(1024)
    expect(diff.patch.startsWith('diff --git a/notes.md b/notes.md')).toBe(true)

    await expect(subject.service.diff({ runId: run.id, laneId: 'nope' as WorktreeLaneId }, subject.signal)).rejects.toThrow('has no lane "nope"')
    await expect(subject.service.diff({ runId: 'nope' as WorktreeRunId, laneId: lane.id }, subject.signal)).rejects.toThrow('unknown run "nope"')
  })

  it('merges the chosen lane into the checked-out branch once', async () => {
    const subject = bench()
    const run = await subject.service.startRun({ repo: subject.repo, prompt: 'x', lanes: [{ label: 'a' }, { label: 'b' }] }, subject.signal)
    const [a, b] = run.lanes as [typeof run.lanes[0], typeof run.lanes[0]]
    writeFileSync(join(a!.path, 'src', 'a.txt'), 'one\nfrom a\n')
    writeFileSync(join(b!.path, 'src', 'a.txt'), 'one\nfrom b\n')
    await expect(subject.service.merge({ runId: run.id, laneId: a!.id, message: ' ' }, subject.signal)).rejects.toThrow('a merge needs a commit message')

    const merged = await subject.service.merge({ runId: run.id, laneId: a!.id, message: 'Lane a result' }, subject.signal)
    expect(merged.run.mergedLane).toBe(a!.id)
    expect(merged.head).toBe(sh(subject.repo, 'rev-parse', 'HEAD'))
    expect(readFileSync(join(subject.repo, 'src', 'a.txt'), 'utf8')).toBe('one\nfrom a\n')
    expect(sh(subject.repo, 'log', '--format=%s', '-1')).toBe(`Merge a from run ${run.id}`)
    expect(sh(subject.repo, 'log', '--format=%s', '-1', 'HEAD^2')).toBe('Lane a result')
    await expect(subject.service.merge({ runId: run.id, laneId: b!.id, message: 'b' }, subject.signal)).rejects.toThrow(`already merged lane ${a!.id}`)
  })

  it('aborts a conflicting merge and leaves the repository unchanged', async () => {
    const subject = bench()
    const run = await subject.service.startRun({ repo: subject.repo, prompt: 'x', lanes: [{ label: 'a' }] }, subject.signal)
    const lane = run.lanes[0]!
    writeFileSync(join(lane.path, 'src', 'a.txt'), 'one\nlane\n')
    writeFileSync(join(subject.repo, 'src', 'a.txt'), 'one\nmain\n')
    sh(subject.repo, 'commit', '-q', '-am', 'main change')
    const head = sh(subject.repo, 'rev-parse', 'HEAD')
    await expect(subject.service.merge({ runId: run.id, laneId: lane.id, message: 'lane' }, subject.signal)).rejects.toThrow('git merge failed')
    expect(sh(subject.repo, 'rev-parse', 'HEAD')).toBe(head)
    expect(sh(subject.repo, 'status', '--porcelain')).toBe('')
    expect((await subject.service.listRuns()).runs[0]!.mergedLane).toBeUndefined()
  })

  it('discards a run, persists the registry, and reloads it in a new instance', async () => {
    const subject = bench()
    const kept = await subject.service.startRun({ repo: subject.repo, prompt: 'keep', lanes: [{ label: 'k' }] }, subject.signal)
    const run = await subject.service.startRun({ repo: subject.repo, prompt: 'drop', lanes: [{ label: 'a' }, { label: 'b' }] }, subject.signal)
    await subject.service.discard({ runId: run.id })
    for (const lane of run.lanes) expect(existsSync(lane.path)).toBe(false)
    expect(sh(subject.repo, 'branch', '--list', `agents/${run.id}-*`)).toBe('')
    await expect(subject.service.discard({ runId: run.id })).rejects.toThrow(`unknown run "${run.id}"`)

    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const reloaded = new Worktrees(ctx, { root: subject.root, maxPatchBytes: 1_000_000 })
    expect((await reloaded.listRuns()).runs.map(entry => entry.prompt)).toEqual(['keep'])
    expect(kept.lanes[0]!.path.startsWith(subject.root)).toBe(true)
  })
})

/**
 * First lane's branch.
 * @param lanes - run lanes.
 * @returns the branch name.
 */
function lane0Branch(lanes: readonly { readonly branch: string }[]): string {
  return lanes[0]?.branch ?? ''
}
