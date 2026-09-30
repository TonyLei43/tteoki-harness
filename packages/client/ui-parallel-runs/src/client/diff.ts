/** Unified-diff parsing and review-feedback formatting for the parallel runs panel. */

/** One line of a hunk. */
export interface DiffLine {
  /** Whether the line is unchanged, added, or deleted. */
  readonly kind: 'context' | 'add' | 'del'
  /** Line number in the base file; absent for added lines. */
  readonly oldNumber?: number
  /** Line number in the changed file; absent for deleted lines. */
  readonly newNumber?: number
  /** Line text without its diff marker. */
  readonly text: string
}

/** One hunk: its `@@` header and lines. */
export interface DiffHunk {
  readonly header: string
  readonly lines: readonly DiffLine[]
}

/** One changed file. */
export interface DiffFile {
  /** Path of the changed file, or of the deleted file when it was removed. */
  readonly path: string
  /** Whether git reported the file as binary. */
  readonly binary: boolean
  readonly hunks: readonly DiffHunk[]
}

/** One review comment anchored to a diff line. */
export interface DiffComment {
  /** File path. */
  readonly path: string
  /** The commented line. */
  readonly line: DiffLine
  /** Reviewer text. */
  readonly text: string
}

/** A `@@ -a,b +c,d @@` hunk header. */
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Parse `git diff` output into files, hunks, and numbered lines.
 * @param patch - unified diff text; a cut final hunk parses up to its last whole line.
 * @returns changed files in patch order.
 */
export function parsePatch(patch: string): DiffFile[] {
  const files: { path: string; binary: boolean; hunks: { header: string; lines: DiffLine[] }[] }[] = []
  let file: (typeof files)[number] | undefined
  let hunk: { header: string; lines: DiffLine[] } | undefined
  let oldLine = 0
  let newLine = 0
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const match = / b\/(.*)$/.exec(raw)
      file = { path: match?.[1] ?? raw.slice('diff --git '.length), binary: false, hunks: [] }
      files.push(file)
      hunk = undefined
      continue
    }
    if (file === undefined) continue
    if (hunk === undefined) {
      if (raw.startsWith('+++ ') && raw !== '+++ /dev/null') file.path = raw.slice(4).replace(/^b\//, '')
      else if (raw.startsWith('Binary files ')) file.binary = true
    }
    const header = HUNK.exec(raw)
    if (header !== null) {
      oldLine = Number(header[1])
      newLine = Number(header[2])
      hunk = { header: raw, lines: [] }
      file.hunks.push(hunk)
      continue
    }
    if (hunk === undefined) continue
    if (raw.startsWith('+')) {
      hunk.lines.push({ kind: 'add', newNumber: newLine, text: raw.slice(1) })
      newLine += 1
    } else if (raw.startsWith('-')) {
      hunk.lines.push({ kind: 'del', oldNumber: oldLine, text: raw.slice(1) })
      oldLine += 1
    } else if (raw.startsWith(' ')) {
      hunk.lines.push({ kind: 'context', oldNumber: oldLine, newNumber: newLine, text: raw.slice(1) })
      oldLine += 1
      newLine += 1
    }
  }
  return files
}

/**
 * Format review comments as one follow-up message for the lane's agent.
 * @param comments - comments in the order the reviewer wrote them.
 * @returns the message text; each comment names its file, line, and quoted code.
 */
export function formatFeedback(comments: readonly DiffComment[]): string {
  const items = comments.map((comment, index) => {
    const where = comment.line.kind === 'del'
      ? `removed line ${comment.line.oldNumber ?? '?'}`
      : `line ${comment.line.newNumber ?? '?'}`
    return `${index + 1}. ${comment.path}, ${where}: \`${comment.line.text.trim()}\`\n   ${comment.text.trim().replace(/\n/g, '\n   ')}`
  })
  return `Review comments on your changes in this worktree:\n\n${items.join('\n\n')}\n\nAddress each comment, then summarize what you changed.`
}
