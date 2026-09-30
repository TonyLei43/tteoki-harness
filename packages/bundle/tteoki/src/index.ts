/**
 * Tteoki's command-line companion: `dsh tteoki <command>` reads the same
 * knowledge bases, agenda, and parallel runs as the app, prints the result to
 * stdout, and exits. Errors go to stderr with exit code 1.
 *
 * Commands:
 * - `agenda [--days N] [--kind event|assignment]` — upcoming events and deadlines, overdue first.
 * - `sync` — sync every enabled connector.
 * - `kb list` — knowledge bases with document counts.
 * - `kb search <query...> [--kb ID] [--top N]` — search passages.
 * - `kb index [--kb ID]` — re-index sources and memory notes.
 * - `runs list` — parallel runs and their lanes.
 * - `runs diff <run> <lane>` — one lane's unified diff.
 * - `notes export --to DIR [--filter RE] [--school NAME --earlier-school NAME --since DATE] [--ocr [--transcribe-all]]` — Notability notes into a vault.
 */

import { Command, InvalidArgumentError } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-connectors'
import type { AgendaItem } from '@deepseek-ai/dsh-connectors'
import { exportNotes } from '@deepseek-ai/dsh-memory-notability'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-memory'
import type {} from '@deepseek-ai/dsh-worktrees'
import type { WorktreeLaneId, WorktreeRunId } from '@deepseek-ai/dsh-worktrees'

export const name = 'tteoki-cli'

export const inject = ['cmdlineArgs', 'memory', 'connectors', 'worktrees']

/** Output sinks and the clock, replaceable in tests. */
export interface CliIo {
  /** Writes one line of command output. */
  readonly out: (line: string) => void
  /** Writes one line of diagnostics. */
  readonly err: (line: string) => void
  /** Returns the current time in epoch milliseconds. */
  readonly now: () => number
  /** IANA time zone that agenda dates render in. */
  readonly timeZone: string
}

/** Default sinks: stdout, stderr, the system clock, and the host time zone. */
const DEFAULT_IO: CliIo = {
  out: (line) => { process.stdout.write(`${line}\n`) },
  err: (line) => { process.stderr.write(`${line}\n`) },
  now: () => Date.now(),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
}

/**
 * Parse a positive integer option.
 * @param value - raw option text.
 * @returns the integer.
 * @throws InvalidArgumentError when the text is not a positive integer.
 */
function positiveInt(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new InvalidArgumentError('expected a positive integer')
  return parsed
}

/**
 * Format one agenda item as a line.
 * @param item - the item.
 * @param io - time zone source.
 * @returns the line.
 */
export function agendaLine(item: AgendaItem, io: Pick<CliIo, 'timeZone'>): string {
  const when = new Intl.DateTimeFormat('en-US', item.allDay
    ? { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }
    : { timeZone: io.timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(item.start))
  const tag = item.kind === 'assignment' ? `due ${item.status ?? 'upcoming'}` : 'event'
  const where = [item.course, item.location].filter((part): part is string => part !== undefined).join(' · ')
  return `${when.padEnd(22)} ${item.title}${where === '' ? '' : `  (${where})`}  [${tag}]`
}

/**
 * Build the command tree. Each action records the work to run after parsing.
 * @param ctx - context with the services injected.
 * @param io - output sinks.
 * @param schedule - receives the chosen command's work.
 * @returns the program.
 */
export function tteokiCommand(ctx: Context, io: CliIo, schedule: (work: () => Promise<void>) => void): Command {
  const program = new Command()
    .name('dsh tteoki')
    .description('Tteoki on the command line: your agenda, knowledge bases, and parallel runs.')
    .helpOption('-h, --help', 'show this help')
    .showHelpAfterError()

  program.command('agenda')
    .description('upcoming events and assignment deadlines, overdue work first')
    .option('--days <n>', 'days ahead to show', positiveInt, 7)
    .option('--kind <kind>', 'only "event" or "assignment"')
    .action((options: { days: number; kind?: string }) => {
      if (options.kind !== undefined && options.kind !== 'event' && options.kind !== 'assignment') program.error('error: --kind must be "event" or "assignment"')
      schedule(async () => {
        const now = io.now()
        const kinds = options.kind === undefined ? undefined : [options.kind as 'event' | 'assignment']
        const past = kinds?.[0] === 'event' ? [] : (await ctx.connectors.agenda({ from: new Date(now - 30 * 86_400_000).toISOString(), to: new Date(now).toISOString(), kinds: ['assignment'] })).items
          .filter(item => item.status === 'missing' || item.status === 'late' || item.status === 'upcoming')
        const ahead = (await ctx.connectors.agenda({ from: new Date(now).toISOString(), to: new Date(now + options.days * 86_400_000).toISOString(), ...kinds === undefined ? {} : { kinds } })).items
        if (past.length > 0) {
          io.out('Overdue')
          for (const item of past) io.out(`  ${agendaLine(item, io)}`)
          io.out('')
        }
        io.out(`Next ${options.days} day(s)`)
        if (ahead.length === 0) io.out('  nothing scheduled')
        for (const item of ahead) io.out(`  ${agendaLine(item, io)}`)
        const status = await ctx.connectors.status()
        if (status.syncedAt === undefined) io.err('note: the agenda has never been synced; run `dsh tteoki sync` or connect accounts in the app')
      })
    })

  program.command('sync')
    .description('sync every enabled calendar and Canvas connector')
    .action(() => {
      schedule(async () => {
        const status = await ctx.connectors.sync({}, AbortSignal.timeout(180_000))
        if (status.connectors.length === 0) io.out('no connectors; add them in the app\'s Agenda panel')
        for (const connector of status.connectors) {
          io.out(`${connector.id.padEnd(20)} ${connector.error === undefined ? `${connector.items} item(s)` : `failed: ${connector.error}`}`)
        }
      })
    })

  const kb = program.command('kb').description('knowledge bases')
  kb.command('list')
    .description('knowledge bases with document counts')
    .action(() => {
      schedule(async () => {
        const settings = ctx.memory.getSettings()
        const status = ctx.memory.status()
        for (const collection of settings.collections) {
          const documents = status.collections.find(entry => entry.id === collection.id)?.documents ?? 0
          io.out(`${collection.id.padEnd(12)} ${String(documents).padStart(6)} docs  ${collection.name}${collection.description === undefined ? '' : ` — ${collection.description}`}`)
        }
      })
    })
  kb.command('search')
    .description('search passages')
    .argument('<query...>', 'what to look for')
    .option('--kb <id>', 'only this knowledge base')
    .option('--top <n>', 'passages to show', positiveInt, 5)
    .action((query: string[], options: { kb?: string; top: number }) => {
      schedule(async () => {
        const value = await ctx.memory.search({ query: query.join(' '), topK: options.top, ...options.kb === undefined ? {} : { collections: [options.kb] } }, AbortSignal.timeout(120_000))
        if (value.hits.length === 0) io.out('no passages matched')
        for (const hit of value.hits) {
          io.out(`[${hit.score.toFixed(3)}] ${hit.collection}: ${hit.source}${hit.heading === undefined ? '' : ` — ${hit.heading}`}`)
          io.out(`    ${hit.text.replace(/\s+/g, ' ').slice(0, 300)}`)
        }
      })
    })
  kb.command('index')
    .description('re-index sources and memory notes')
    .option('--kb <id>', 'only this knowledge base')
    .action((options: { kb?: string }) => {
      schedule(async () => {
        const value = await ctx.memory.index(options.kb === undefined ? {} : { collections: [options.kb] }, AbortSignal.timeout(3_600_000))
        io.out(`${value.documents} document(s), ${value.chunks} chunk(s); ${value.skipped} unchanged; ${value.failures.length} failure(s)`)
        for (const failure of value.failures) io.out(`  ${failure.path}: ${failure.message}`)
      })
    })

  const runs = program.command('runs').description('parallel agent runs')
  runs.command('list')
    .description('runs and their lanes, newest first')
    .action(() => {
      schedule(async () => {
        const value = await ctx.worktrees.listRuns()
        if (value.runs.length === 0) io.out('no runs')
        for (const run of value.runs) {
          io.out(`${run.id}  ${run.prompt.split('\n')[0] ?? ''}${run.mergedLane === undefined ? '' : `  [merged ${run.mergedLane}]`}`)
          for (const lane of run.lanes) io.out(`    ${lane.id.padEnd(20)} ${lane.branch}  ${lane.path}`)
        }
      })
    })
  runs.command('diff')
    .description('one lane\'s changes against the run\'s base commit')
    .argument('<run>', 'run id')
    .argument('<lane>', 'lane id')
    .action((run: string, lane: string) => {
      schedule(async () => {
        const value = await ctx.worktrees.diff({ runId: run as WorktreeRunId, laneId: lane as WorktreeLaneId }, AbortSignal.timeout(60_000))
        io.out(value.patch === '' ? 'no changes' : value.patch.replace(/\n$/, ''))
        if (value.truncated) io.err('note: the diff was cut at the configured size limit')
      })
    })
  program.command('notes')
    .description('Notability notes')
    .command('export')
    .description('export Notability notes into a vault folder, filed by school, course, and date')
    .requiredOption('--to <folder>', 'vault folder receiving <school>/<course>/<date> <title>.md, such as "~/Documents/My Vault/Academic"')
    .option('--from <folder>', 'Notability\'s iCloud Documents folder; found automatically when omitted')
    .option('--filter <regex>', 'only notes whose title matches, case-insensitive')
    .option('--school <name>', 'school folder for notes created on or after --since', '')
    .option('--earlier-school <name>', 'school folder for notes created before --since', '')
    .option('--since <date>', 'YYYY-MM-DD splitting --school from --earlier-school')
    .option('--ocr', 'transcribe handwriting-only notes with the vision model (slow)')
    .option('--transcribe-all', 'with --ocr, also replace Notability\'s handwriting recognition with the vision model (slower, cleaner)')
    .action((options: { to: string; from?: string; filter?: string; school: string; earlierSchool: string; since?: string; ocr?: boolean; transcribeAll?: boolean }) => {
      const since = options.since === undefined ? new Date(0) : new Date(`${options.since}T00:00:00`)
      if (Number.isNaN(since.getTime())) program.error('error: --since must be a date such as 2025-09-01')
      let filter: RegExp | undefined
      try {
        filter = options.filter === undefined ? undefined : new RegExp(options.filter, 'i')
      } catch {
        program.error(`error: --filter "${options.filter ?? ''}" is not a valid regular expression`)
      }
      if (options.ocr === true && !ctx.memory.ocrEnabled()) program.error('error: --ocr needs a vision model; set one in Settings → Memory')
      schedule(async () => {
        const expand = (path: string): string => path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
        const from = options.from === undefined ? await findNotabilityFolder() : expand(options.from)
        const counts: Record<string, number> = {}
        const results = await exportNotes({
          notabilityDir: from,
          targetDir: expand(options.to),
          ...filter === undefined ? {} : { filter },
          schoolCutoff: since,
          schoolAfter: options.school,
          schoolBefore: options.earlierSchool,
          ...options.ocr === true ? { ocr: (png: Uint8Array, hint: string, signal: AbortSignal) => ctx.memory.ocrImage(png, hint, signal), transcribeAll: options.transcribeAll === true, concurrency: ctx.memory.ocrConcurrency() } : {},
        }, AbortSignal.timeout(24 * 3_600_000), (entry) => {
          counts[entry.outcome] = (counts[entry.outcome] ?? 0) + 1
          io.out(`${entry.outcome.padEnd(9)} ${entry.title}${entry.path === undefined ? '' : `  →  ${entry.path}`}${entry.reason === undefined ? '' : `  (${entry.reason})`}`)
        })
        io.out(`${results.length} note(s): ${Object.entries(counts).map(([outcome, count]) => `${count} ${outcome}`).join(', ') || 'none matched'}`)
      })
    })
  return program
}

/**
 * Find Notability's iCloud Documents folder: the Notability container with the most notes.
 * @returns the folder.
 * @throws Error when no Notability container exists.
 */
async function findNotabilityFolder(): Promise<string> {
  const root = join(homedir(), 'Library', 'Mobile Documents')
  let best: { path: string; notes: number } | undefined
  for (const container of (await readdir(root)).filter(name => name.endsWith('~com~gingerlabs~Notability'))) {
    const path = join(root, container, 'Documents')
    let notes = 0
    try {
      notes = (await readdir(path)).filter(name => name.endsWith('.nbn')).length
    } catch {
      // A container without Documents holds no notes.
      notes = 0
    }
    if (notes > (best?.notes ?? 0)) best = { path, notes }
  }
  if (best === undefined) throw new Error('no Notability iCloud folder found; turn on iCloud sync in Notability or pass --from')
  return best.path
}

/**
 * Parse the command line and run the chosen command, then exit.
 * @param ctx - context with the services injected.
 * @param io - output sinks; defaults to stdout, stderr, and the system clock.
 */
export function apply(ctx: Context, io: CliIo = DEFAULT_IO): void {
  // appExit is an optional launcher value, read through the global service store.
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('tteoki-cli: the launcher must provide ctx.appExit before the tree mounts')
  let work: (() => Promise<void>) | undefined
  const program = tteokiCommand(ctx, io, (next) => { work = next })
  parseCmdline(ctx, program)
  if (work === undefined) {
    // Commander already answered --help and grammar errors through the launcher; a bare
    // `dsh tteoki` gets the help text here.
    if ((ctx.get('cmdlineArgs')?.get() ?? []).length === 0) {
      io.out(program.helpInformation().trimEnd())
      exit(0)
    }
    return
  }
  void work().then(
    () => { exit(0) },
    (error: unknown) => {
      io.err(`error: ${error instanceof Error ? error.message : String(error)}`)
      exit(1)
    },
  )
}
