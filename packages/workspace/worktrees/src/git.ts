/** Git plumbing for parallel runs: argument-vector invocations with a scrubbed environment. */

import { execFile } from 'node:child_process'

/** Environment names that may carry credentials; never passed to git. */
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD/i

/** Largest git output read into memory; a diff beyond it fails instead of truncating mid-hunk. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/**
 * Copy the process environment without credential-shaped variables, and keep
 * git from opening an editor or prompting.
 * @returns the child environment.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(process.env)) if (!SECRET_NAME.test(name)) env[name] = value
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no' }
}

/**
 * Run one git command.
 * @param cwd - working directory.
 * @param args - git arguments; never passed through a shell.
 * @param signal - caller cancellation.
 * @returns standard output.
 * @throws Error carrying git's standard error when the command fails or is cancelled.
 */
export async function git(cwd: string, args: readonly string[], signal: AbortSignal): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, env: childEnv(), signal, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error === null) resolve(stdout)
      else reject(new Error(`git ${args[0] ?? ''} failed: ${(stderr.trim() || error.message).split('\n').slice(0, 4).join(' ')}`))
    })
  })
}

/**
 * Parse `git diff --numstat -z` output.
 * @param output - NUL-separated numstat records.
 * @returns changed files; binary files carry no line counts.
 */
export function parseNumstat(output: string): { path: string; additions?: number; deletions?: number }[] {
  const out: { path: string; additions?: number; deletions?: number }[] = []
  const fields = output.split('\0')
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index] ?? ''
    if (record === '') continue
    const [added, deleted, path] = record.split('\t')
    if (added === undefined || deleted === undefined || path === undefined) continue
    let name = path
    if (name === '') {
      // A rename record carries the old and new paths as the next two fields.
      index += 2
      name = fields[index] ?? ''
    }
    out.push(added === '-' ? { path: name } : { path: name, additions: Number(added), deletions: Number(deleted) })
  }
  return out
}

/**
 * Turn a label into a branch- and path-safe slug.
 * @param label - free text.
 * @returns lower-case letters, digits, and single dashes, at most 32 characters; `lane` when nothing remains.
 */
export function slug(label: string): string {
  const cleaned = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '')
  return cleaned === '' ? 'lane' : cleaned
}
