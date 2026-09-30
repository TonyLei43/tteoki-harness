---
description: "Parallel agent runs in git worktrees: one worktree and branch per lane, lane diffs against the base commit, merge of the chosen lane, and cleanup."
kind: "package-reference"
---

# @deepseek-ai/dsh-worktrees

## Summary

A **run** sends one prompt to several agents at once. Each **lane** is a git worktree on its own branch, created from the repository's current commit, where one agent session works without touching the others. The service reports each lane's changes against that commit, merges the lane you choose into the repository's checked-out branch, and removes a run's worktrees and branches when you discard it. It serves the `worktrees` Remote namespace that the Web **Parallel** panel ([ui-parallel-runs](../../client/ui-parallel-runs/README.md)) drives; that panel creates and prompts the sessions.

## Use this package

Mount it in the Host plane.

```yaml
- id: worktrees
  name: '@deepseek-ai/dsh-worktrees'
  config:
    maxPatchBytes: 1000000
```

| Field | Default | Meaning |
|---|---|---|
| `root` | `$DSH_HOME/worktrees` | Directory holding run worktrees (`<repo>-<run>/<lane>`) and the run registry `runs.json`. |
| `maxPatchBytes` | `1000000` | Largest unified diff returned for one lane; a longer diff is cut and marked `truncated`. |

| Method | Behavior |
|---|---|
| `startRun({ repo, prompt, lanes })` | Creates 1–8 lanes on branches `agents/<run>-<lane>` at the current `HEAD`. A failure removes the worktrees and branches created so far. |
| `attachSession({ runId, laneId, sessionId })` | Records the session working in a lane. |
| `diff({ runId, laneId })` | Changed files with line counts and the unified diff against the base commit, including uncommitted and untracked files. |
| `merge({ runId, laneId, message })` | Commits the lane's uncommitted changes with `message`, then merges its branch with `--no-ff` into the repository's checked-out branch. A conflict aborts the merge and leaves the repository unchanged. One lane per run can merge. |
| `discard({ runId })` | Removes the run's worktrees and branches and forgets the run; merged commits stay. |
| `listRuns()` | Recorded runs, newest first. |

Git runs without a shell, with credential-shaped environment variables removed and prompts and editors disabled. Merging uses the repository's own git identity and hooks.

## Model Experience

None: the service registers no tools or prompt text. Lane sessions see their worktree as their working directory.

## Known Limitations and Deferred Work

- Merging targets whatever branch the repository has checked out at merge time, not necessarily the branch the run started from; the panel shows the starting branch.
- Lane sessions stay after a run is discarded; their working directory no longer exists.
- **Runtime invariant:** No companion is published. The registry file and git's own worktree records are the only state, and every call reads git directly.
