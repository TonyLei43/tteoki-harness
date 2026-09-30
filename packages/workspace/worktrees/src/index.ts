/**
 * Parallel agent runs in git worktrees. A run fans one prompt out to several
 * lanes; each lane is a worktree on its own branch, created from the
 * repository's current commit, where one agent session works in isolation.
 * The service reports each lane's changes against that commit, merges the
 * chosen lane into the repository's checked-out branch, and discards runs.
 * Sessions are created and prompted by the caller; the service records which
 * session works in which lane.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { git, parseNumstat, slug } from './git.ts'
import type {
  WorktreeAttachRequest,
  WorktreeDiffValue,
  WorktreeLane,
  WorktreeLaneId,
  WorktreeLaneRef,
  WorktreeMergeRequest,
  WorktreeMergeValue,
  WorktreeRun,
  WorktreeRunId,
  WorktreeStartRequest,
} from './types.ts'

export type * from './types.ts'
export { parseNumstat, slug } from './git.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    worktrees: Worktrees
  }
}

/** Most lanes one run may fan out to. */
const MAX_LANES = 8

/** Deployment policy for parallel runs. */
export interface Config {
  /** Directory holding run worktrees and the run registry; defaults to `$DSH_HOME/worktrees`. */
  readonly root?: string
  /** Largest unified diff returned for one lane, in bytes. */
  readonly maxPatchBytes: number
}

/** Resolved policy. */
interface Spec {
  readonly root: string
  readonly maxPatchBytes: number
}

/**
 * Resolve the deployment policy.
 * @param config - configured values.
 * @returns the effective policy.
 */
export function resolve(config: Config): Spec {
  return { root: config.root ?? join(resolveDshHome(), 'worktrees'), maxPatchBytes: config.maxPatchBytes }
}

/**
 * Wrap a git or filesystem failure as a Remote error.
 * @param error - the failure.
 * @returns a bad-request Remote error carrying the message.
 */
function remoteError(error: unknown): RemoteError {
  return error instanceof RemoteError ? error : new RemoteError('gateway/bad-request', error instanceof Error ? error.message : String(error), {})
}

/** Remote service owning parallel runs and their worktrees. */
export class Worktrees extends TypertRemoteService {
  static Config: z<Config> = z.object({
    root: z.string(),
    maxPatchBytes: z.natural().min(1024).default(1_000_000),
  })

  static inject = ['typert']

  private readonly spec: Spec
  private readonly registry: string
  private runs: WorktreeRun[] | undefined
  private queue: Promise<unknown> = Promise.resolve()

  /** @param ctx - Host context. @param config - deployment policy. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'worktrees')
    this.spec = resolve(config)
    this.registry = join(this.spec.root, 'runs.json')
  }

  /**
   * List runs, newest first.
   * @returns every recorded run.
   */
  @Remote('listRuns')
  async listRuns(): Promise<{ runs: WorktreeRun[] }> {
    return { runs: [...await this.load()].sort((left, right) => right.createdAt - left.createdAt) }
  }

  /**
   * Start a run: create one worktree and branch per lane at the repository's
   * current commit. Worktrees created before a failure are removed again.
   * @param request - repository, prompt, and lanes.
   * @param signal - caller cancellation.
   * @returns the recorded run.
   * @throws RemoteError when the path is not in a git repository, the lane count is outside 1–8, or git fails.
   */
  @Remote('startRun')
  async startRun(request: WorktreeStartRequest, signal: AbortSignal): Promise<WorktreeRun> {
    if (request.prompt.trim() === '') throw new RemoteError('gateway/bad-request', 'a run needs a prompt', {})
    if (request.lanes.length === 0 || request.lanes.length > MAX_LANES) {
      throw new RemoteError('gateway/bad-request', `a run needs between 1 and ${MAX_LANES} lanes`, {})
    }
    return await this.mutate(async (runs) => {
      let repo: string
      try {
        repo = (await git(request.repo, ['rev-parse', '--show-toplevel'], signal)).trim()
      } catch {
        // Any failure here means the directory is not usable as a repository.
        throw new RemoteError('gateway/bad-request', `${request.repo} is not inside a git repository`, {})
      }
      const base = (await git(repo, ['rev-parse', 'HEAD'], signal)).trim()
      const baseRef = (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'], signal)).trim()
      const runKey = randomBytes(4).toString('hex')
      const runDir = join(this.spec.root, `${slug(basename(repo))}-${runKey}`)
      const lanes: WorktreeLane[] = []
      const used = new Set<string>()
      try {
        await mkdir(runDir, { recursive: true })
        for (const lane of request.lanes) {
          let name = slug(lane.label)
          for (let suffix = 2; used.has(name); suffix += 1) name = `${slug(lane.label)}-${suffix}`
          used.add(name)
          const branch = `agents/${runKey}-${name}`
          const path = join(runDir, name)
          // Recorded before `worktree add`, which can fail after creating the branch or directory.
          lanes.push({ id: brandString<WorktreeLaneId>(name), label: lane.label, ...lane.preset === undefined ? {} : { preset: lane.preset }, path, branch })
          await git(repo, ['worktree', 'add', '-b', branch, path, base], signal)
        }
      } catch (error: unknown) {
        await this.removeLanes(repo, lanes)
        await rm(runDir, { recursive: true, force: true })
        throw remoteError(error)
      }
      const run: WorktreeRun = { id: brandString<WorktreeRunId>(runKey), repo, base, baseRef, prompt: request.prompt, createdAt: Date.now(), lanes }
      return { runs: [...runs, run], value: run }
    })
  }

  /**
   * Record the session working in one lane.
   * @param request - run, lane, and session.
   * @returns the updated run.
   * @throws RemoteError when the run or lane is unknown.
   */
  @Remote('attachSession')
  async attachSession(request: WorktreeAttachRequest): Promise<WorktreeRun> {
    return await this.mutate(async (runs) => {
      const run = this.find(runs, request.runId)
      this.lane(run, request.laneId)
      const next: WorktreeRun = { ...run, lanes: run.lanes.map(lane => lane.id === request.laneId ? { ...lane, sessionId: request.sessionId } : lane) }
      return { runs: runs.map(entry => entry.id === run.id ? next : entry), value: next }
    })
  }

  /**
   * Report one lane's changes against the run's base commit, including
   * uncommitted and untracked files.
   * @param request - run and lane.
   * @param signal - caller cancellation.
   * @returns changed files and the unified diff, cut at `maxPatchBytes`.
   * @throws RemoteError when the run or lane is unknown or git fails.
   */
  @Remote('diff')
  async diff(request: WorktreeLaneRef, signal: AbortSignal): Promise<WorktreeDiffValue> {
    const run = this.find(await this.load(), request.runId)
    const lane = this.lane(run, request.laneId)
    try {
      // Intent-to-add makes untracked files visible to `git diff` without staging their content.
      await git(lane.path, ['add', '--intent-to-add', '--all'], signal)
      const files = parseNumstat(await git(lane.path, ['diff', '--numstat', '-z', '--no-ext-diff', run.base], signal))
      const full = await git(lane.path, ['diff', '--no-color', '--no-ext-diff', run.base], signal)
      const bytes = Buffer.from(full, 'utf8')
      const truncated = bytes.length > this.spec.maxPatchBytes
      return { files, patch: truncated ? bytes.subarray(0, this.spec.maxPatchBytes).toString('utf8') : full, truncated }
    } catch (error: unknown) {
      throw remoteError(error)
    }
  }

  /**
   * Commit one lane's uncommitted changes on its branch and merge the branch
   * into the repository's checked-out branch. A conflicting merge is aborted,
   * leaving the repository as it was.
   * @param request - run, lane, and commit message.
   * @param signal - caller cancellation.
   * @returns the updated run and the repository's new head commit.
   * @throws RemoteError when the run already merged a lane, the message is empty, or git fails or conflicts.
   */
  @Remote('merge')
  async merge(request: WorktreeMergeRequest, signal: AbortSignal): Promise<WorktreeMergeValue> {
    if (request.message.trim() === '') throw new RemoteError('gateway/bad-request', 'a merge needs a commit message', {})
    return await this.mutate(async (runs) => {
      const run = this.find(runs, request.runId)
      const lane = this.lane(run, request.laneId)
      if (run.mergedLane !== undefined) throw new RemoteError('gateway/bad-request', `run ${run.id} already merged lane ${run.mergedLane}`, {})
      try {
        await git(lane.path, ['add', '--all'], signal)
        if ((await git(lane.path, ['status', '--porcelain'], signal)).trim() !== '') {
          await git(lane.path, ['commit', '-m', request.message], signal)
        }
        try {
          await git(run.repo, ['merge', '--no-ff', '--no-edit', '-m', `Merge ${lane.label} from run ${run.id}`, lane.branch], signal)
        } catch (error: unknown) {
          await git(run.repo, ['merge', '--abort'], signal).catch(() => {
            // No merge in progress (git refused before starting): nothing to abort.
          })
          throw error
        }
        const head = (await git(run.repo, ['rev-parse', 'HEAD'], signal)).trim()
        const next: WorktreeRun = { ...run, mergedLane: lane.id }
        return { runs: runs.map(entry => entry.id === run.id ? next : entry), value: { run: next, head } }
      } catch (error: unknown) {
        throw remoteError(error)
      }
    })
  }

  /**
   * Remove a run's worktrees and branches and forget the run. Merged commits
   * stay in the repository.
   * @param request - the run.
   * @returns an empty receipt.
   * @throws RemoteError when the run is unknown.
   */
  @Remote('discard')
  async discard(request: { readonly runId: WorktreeRunId }): Promise<Record<string, never>> {
    return await this.mutate(async (runs) => {
      const run = this.find(runs, request.runId)
      await this.removeLanes(run.repo, run.lanes)
      const first = run.lanes[0]
      if (first !== undefined) await rm(join(first.path, '..'), { recursive: true, force: true })
      return { runs: runs.filter(entry => entry.id !== run.id), value: {} }
    })
  }

  private async removeLanes(repo: string, lanes: readonly WorktreeLane[]): Promise<void> {
    const signal = AbortSignal.timeout(60_000)
    for (const lane of lanes) {
      await git(repo, ['worktree', 'remove', '--force', lane.path], signal).catch(() => {
        // An already-deleted worktree directory: prune below clears its record.
      })
      await git(repo, ['branch', '-D', lane.branch], signal).catch(() => {
        // The branch is already gone.
      })
    }
    await git(repo, ['worktree', 'prune'], signal).catch(() => {
      // The repository itself may be gone; nothing left to prune.
    })
  }

  private find(runs: readonly WorktreeRun[], id: WorktreeRunId): WorktreeRun {
    const run = runs.find(entry => entry.id === id)
    if (run === undefined) throw new RemoteError('gateway/bad-request', `unknown run "${id}"`, {})
    return run
  }

  private lane(run: WorktreeRun, id: WorktreeLaneId): WorktreeLane {
    const lane = run.lanes.find(entry => entry.id === id)
    if (lane === undefined) throw new RemoteError('gateway/bad-request', `run ${run.id} has no lane "${id}"`, {})
    return lane
  }

  private async load(): Promise<WorktreeRun[]> {
    if (this.runs !== undefined) return this.runs
    try {
      const parsed = JSON.parse(await readFile(this.registry, 'utf8')) as { runs?: WorktreeRun[] }
      this.runs = Array.isArray(parsed.runs) ? parsed.runs : []
    } catch {
      // No registry yet: no runs.
      this.runs = []
    }
    return this.runs
  }

  /**
   * Apply one registry change after every earlier change settles, then persist it.
   * @param change - computes the next run list and the value to return.
   * @returns the change's value.
   */
  private async mutate<T>(change: (runs: readonly WorktreeRun[]) => Promise<{ runs: WorktreeRun[]; value: T }>): Promise<T> {
    const task = this.queue.then(async () => {
      const { runs, value } = await change(await this.load())
      await mkdir(this.spec.root, { recursive: true })
      const temporary = `${this.registry}.${randomBytes(4).toString('hex')}.tmp`
      await writeFile(temporary, `${JSON.stringify({ runs }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temporary, this.registry)
      this.runs = runs
      return value
    })
    this.queue = task.catch(() => {
      // A failed change leaves the registry untouched; later changes proceed.
    })
    return await task
  }
}

export default Worktrees
