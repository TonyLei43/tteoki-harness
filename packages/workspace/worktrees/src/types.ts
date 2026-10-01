/** Wire vocabulary for the `worktrees` Remote namespace: parallel agent runs in git worktrees. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identity of one parallel run. */
export type WorktreeRunId = Branded<'WorktreeRunId'>

/** Identity of one lane (one agent's worktree) inside a run. */
export type WorktreeLaneId = Branded<'WorktreeLaneId'>

/** One agent's isolated worktree inside a run. */
export interface WorktreeLane {
  /** Lane identity, unique within its run. */
  readonly id: WorktreeLaneId
  /** Display label, such as the preset or model the lane runs. */
  readonly label: string
  /** Agent preset the lane's session runs, when one was chosen. */
  readonly preset?: string
  /** Absolute worktree directory; the lane's session works here. */
  readonly path: string
  /** Branch checked out in the worktree. */
  readonly branch: string
  /** Session working in this lane, once attached. */
  readonly sessionId?: string
}

/** One prompt fanned out to several lanes from the same base commit. */
export interface WorktreeRun {
  /** Run identity. */
  readonly id: WorktreeRunId
  /** Absolute top-level directory of the source repository. */
  readonly repo: string
  /** Commit every lane starts from. */
  readonly base: string
  /** Branch the repository had checked out when the run started, or `HEAD` when detached. */
  readonly baseRef: string
  /** Prompt sent to every lane. */
  readonly prompt: string
  /** Creation time in epoch milliseconds. */
  readonly createdAt: number
  /** Lanes in creation order. */
  readonly lanes: readonly WorktreeLane[]
  /** Lane whose changes were merged into the repository, once merged. */
  readonly mergedLane?: WorktreeLaneId
}

/** Starts a run: one worktree per lane, all at the repository's current commit. */
export interface WorktreeStartRequest {
  /** Any directory inside the source repository. */
  readonly repo: string
  /** Prompt the caller will send to every lane. */
  readonly prompt: string
  /** Lanes to create, in order. */
  readonly lanes: readonly { readonly label: string; readonly preset?: string }[]
}

/** Records the session working in one lane. */
export interface WorktreeAttachRequest {
  readonly runId: WorktreeRunId
  readonly laneId: WorktreeLaneId
  readonly sessionId: string
}

/** Names one lane. */
export interface WorktreeLaneRef {
  readonly runId: WorktreeRunId
  readonly laneId: WorktreeLaneId
}

/** Merges one lane into the repository. */
export interface WorktreeMergeRequest extends WorktreeLaneRef {
  /** Commit message for the lane's uncommitted changes. */
  readonly message: string
}

/** One changed file in a lane. */
export interface WorktreeFileChange {
  /** Path relative to the repository root. */
  readonly path: string
  /** Added lines; undefined for binary files. */
  readonly additions?: number
  /** Deleted lines; undefined for binary files. */
  readonly deletions?: number
}

/** A lane's changes against its run's base commit, including uncommitted and untracked files. */
export interface WorktreeDiffValue {
  readonly files: readonly WorktreeFileChange[]
  /** Unified diff text, cut at `maxPatchBytes`. */
  readonly patch: string
  /** Whether `patch` was cut. */
  readonly truncated: boolean
}

/** Result of merging a lane. */
export interface WorktreeMergeValue {
  /** The run after the merge. */
  readonly run: WorktreeRun
  /** Commit the repository's branch points at after the merge. */
  readonly head: string
}
