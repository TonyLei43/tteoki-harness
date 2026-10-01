/** Package-manager execution for the skill-set installer. */

import { execFile } from 'node:child_process'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

/** Maximum captured bytes from one package-manager run. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/**
 * Run the package manager once in a working directory.
 * @param command - pnpm executable name or path.
 * @param args - pnpm arguments.
 * @param cwd - working directory (the staging project).
 * @param signal - caller cancellation; abort terminates the run.
 * @param timeoutMs - bound on the run in milliseconds.
 * @returns after the run exits successfully.
 * @throws when spawning fails, the deadline passes, or pnpm exits nonzero.
 */
export function runPnpm(
  command: string,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { cwd, env: scrubbedParentEnv(), signal, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES },
      (error) => {
        if (error === null) resolve()
        else reject(new Error(`${command} ${args.join(' ')} failed: ${error.message}`, { cause: error }))
      },
    )
  })
}
