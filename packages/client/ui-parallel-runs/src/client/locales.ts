/** English copy for the parallel runs panel. */

/** Locale keys the panel renders. */
export type ParallelRunsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'newRun' | 'noRuns' | 'refresh' | 'back'
  | 'repo' | 'repoHint' | 'prompt' | 'promptHint' | 'lanes' | 'lanesHint' | 'noPreset' | 'addLane' | 'removeLane' | 'start' | 'starting'
  | 'lanesCount' | 'changeSummary' | 'merged' | 'base' | 'openSession' | 'noSession' | 'viewDiff' | 'hideDiff' | 'loadingDiff' | 'noChanges' | 'truncated' | 'binary'
  | 'merge' | 'mergeMessage' | 'confirmMerge' | 'cancel' | 'merging' | 'mergedInto' | 'discard' | 'confirmDiscard'
  | 'comment' | 'commentPlaceholder' | 'addComment' | 'comments' | 'removeComment' | 'sendFeedback' | 'sending' | 'sent'
  | 'error'

/** English copy. */
export const en: Record<ParallelRunsLocaleKey, string> = {
  nav: 'Parallel',
  title: 'Parallel runs',
  intro: 'Send one prompt to several agents, each in its own git worktree, then compare their changes and merge the best one.',
  newRun: 'New run',
  noRuns: 'No runs yet.',
  refresh: 'Refresh',
  back: 'All runs',
  repo: 'Repository folder',
  repoHint: 'Any folder inside a git repository.',
  prompt: 'Prompt',
  promptHint: 'Every lane receives this prompt.',
  lanes: 'Lanes',
  lanesHint: 'One agent per lane, up to 8.',
  noPreset: 'Default preset',
  addLane: 'Add lane',
  removeLane: 'Remove lane',
  start: 'Start run',
  starting: 'Starting…',
  lanesCount: '{count} lanes',
  changeSummary: '{files} files · +{additions} −{deletions}',
  merged: 'Merged',
  base: 'from {ref} at {commit}',
  openSession: 'Open session',
  noSession: 'No session',
  viewDiff: 'View changes',
  hideDiff: 'Hide changes',
  loadingDiff: 'Loading changes…',
  noChanges: 'No changes yet.',
  truncated: 'The diff is too long; only the beginning is shown.',
  binary: 'Binary file',
  merge: 'Merge',
  mergeMessage: 'Commit message',
  confirmMerge: 'Merge into {ref}',
  cancel: 'Cancel',
  merging: 'Merging…',
  mergedInto: 'Merged into {ref}.',
  discard: 'Discard run',
  confirmDiscard: 'Delete worktrees and branches',
  comment: 'Comment on this line',
  commentPlaceholder: 'What should the agent change here?',
  addComment: 'Add comment',
  comments: '{count} comment(s) for this lane',
  removeComment: 'Remove comment',
  sendFeedback: 'Send to agent',
  sending: 'Sending…',
  sent: 'Sent to the agent.',
  error: 'The request failed: {message}',
}
