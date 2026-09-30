/** Tteoki CLI: command parsing, output, and exit codes over fake services. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { agendaLine, apply, tteokiCommand } from '../src/index.ts'
import type { CliIo } from '../src/index.ts'

const NOW = Date.UTC(2026, 8, 29, 16)
const at = (days: number) => new Date(NOW + days * 86_400_000).toISOString()

function bench(argv: string[] = []) {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = { out: line => out.push(line), err: line => err.push(line), now: () => NOW, timeZone: 'America/Los_Angeles' }
  const connectors = {
    agenda: vi.fn(async (request: { from: string; to: string; kinds?: string[] }) => ({
      items: [
        { id: 'o', source: 'c', kind: 'assignment', title: 'HW3', start: at(-2), allDay: false, course: 'STAT 534', status: 'missing' },
        { id: 'u', source: 'c', kind: 'assignment', title: 'HW4', start: at(2), allDay: false, course: 'STAT 534', status: 'upcoming' },
        { id: 'e', source: 'g', kind: 'event', title: 'Lecture', start: at(1), allDay: false, location: 'C-36' },
      ].filter(item => item.start >= request.from && item.start < request.to && (request.kinds === undefined || request.kinds.includes(item.kind)))
        .sort((left, right) => left.start.localeCompare(right.start)),
    })),
    status: vi.fn(async () => ({ connectors: [] })),
    sync: vi.fn(async () => ({ connectors: [{ id: 'canvas', syncedAt: NOW, items: 12, configured: true }, { id: 'google', syncedAt: NOW, items: 0, configured: true, error: 'calendar feed returned HTTP 404' }] })),
  }
  const memory = {
    getSettings: () => ({ collections: [{ id: 'academic', name: 'Academic', sources: [], description: 'UW' }, { id: 'ai', name: 'AI', sources: [] }] }),
    status: () => ({ collections: [{ id: 'academic', documents: 178 }] }),
    search: vi.fn(async () => ({ hits: [{ source: '/uw/hw4.pdf', collection: 'academic', heading: 'Page 3', text: 'Metropolis\n  Hastings', score: 0.757 }], entities: [] })),
    index: vi.fn(async () => ({ documents: 3, chunks: 9, skipped: 1, failures: [{ path: '/q.pdf', message: 'the PDF needs OCR' }] })),
  }
  const worktrees = {
    listRuns: vi.fn(async () => ({ runs: [{ id: 'r1', prompt: 'Speed up\nmore', mergedLane: 'a', lanes: [{ id: 'a', branch: 'agents/r1-a', path: '/w/a' }] }] })),
    diff: vi.fn(async () => ({ files: [], patch: 'diff --git a/x b/x\n', truncated: true })),
  }
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  ctx.provide('connectors', connectors as never)
  ctx.provide('memory', memory as never)
  ctx.provide('worktrees', worktrees as never)
  ctx.provide('cmdlineArgs', { get: () => argv } as never)
  const scheduled: { work?: () => Promise<void> } = {}
  const pending = (): (() => Promise<void>) | undefined => scheduled.work
  const program = tteokiCommand(ctx, io, (next) => { scheduled.work = next })
  // The launcher's parseCmdline routes every command's exit; the test throws instead.
  const override = (command: typeof program): void => { command.exitOverride().configureOutput({ writeErr: () => {}, writeOut: () => {} }); command.commands.forEach(override) }
  override(program)
  const run = async (...args: string[]): Promise<void> => {
    delete scheduled.work
    program.parse(args, { from: 'user' })
    await pending()?.()
  }
  return { ctx, io, out, err, connectors, memory, worktrees, run }
}

describe('agendaLine', () => {
  it('formats events and deadlines in the local time zone', () => {
    expect(agendaLine({ id: 'u', source: 'c', kind: 'assignment', title: 'HW4', start: '2026-10-02T06:59:00.000Z', allDay: false, course: 'STAT 534', status: 'upcoming' }, { timeZone: 'America/Los_Angeles' }))
      .toBe(`${'Thu, Oct 1, 11:59 PM'.padEnd(22)} HW4  (STAT 534)  [due upcoming]`)
    expect(agendaLine({ id: 'h', source: 'g', kind: 'event', title: 'Holiday', start: '2026-10-12T00:00:00.000Z', allDay: true }, { timeZone: 'Asia/Tokyo' }))
      .toBe(`${'Mon, Oct 12'.padEnd(22)} Holiday  [event]`)
  })
})

describe('commands', () => {
  it('agenda prints overdue work, the window, and a never-synced note', async () => {
    const subject = bench()
    await subject.run('agenda', '--days', '3')
    expect(subject.out[0]).toBe('Overdue')
    expect(subject.out[1]).toContain('HW3')
    expect(subject.out.slice(3)).toEqual(['Next 3 day(s)', expect.stringContaining('Lecture'), expect.stringContaining('HW4')])
    expect(subject.err).toEqual(['note: the agenda has never been synced; run `dsh tteoki sync` or connect accounts in the app'])
    subject.out.length = 0
    await subject.run('agenda', '--kind', 'event')
    expect(subject.out).toEqual(['Next 7 day(s)', expect.stringContaining('Lecture')])
    await expect(subject.run('agenda', '--kind', 'x')).rejects.toThrow('--kind must be "event" or "assignment"')
    await expect(subject.run('agenda', '--days', '0')).rejects.toThrow('expected a positive integer')
  })

  it('sync reports each connector', async () => {
    const subject = bench()
    await subject.run('sync')
    expect(subject.out).toEqual([`${'canvas'.padEnd(20)} 12 item(s)`, `${'google'.padEnd(20)} failed: calendar feed returned HTTP 404`])
  })

  it('kb list, search, and index', async () => {
    const subject = bench()
    await subject.run('kb', 'list')
    expect(subject.out).toEqual([`${'academic'.padEnd(12)}    178 docs  Academic — UW`, `${'ai'.padEnd(12)}      0 docs  AI`])
    subject.out.length = 0
    await subject.run('kb', 'search', 'metropolis', 'hastings', '--kb', 'academic', '--top', '3')
    expect(subject.memory.search).toHaveBeenCalledWith({ query: 'metropolis hastings', topK: 3, collections: ['academic'] }, expect.any(AbortSignal))
    expect(subject.out).toEqual(['[0.757] academic: /uw/hw4.pdf — Page 3', '    Metropolis Hastings'])
    subject.out.length = 0
    await subject.run('kb', 'index')
    expect(subject.out).toEqual(['3 document(s), 9 chunk(s); 1 unchanged; 1 failure(s)', '  /q.pdf: the PDF needs OCR'])
  })

  it('runs list and diff', async () => {
    const subject = bench()
    await subject.run('runs', 'list')
    expect(subject.out).toEqual(['r1  Speed up  [merged a]', `    ${'a'.padEnd(20)} agents/r1-a  /w/a`])
    subject.out.length = 0
    await subject.run('runs', 'diff', 'r1', 'a')
    expect(subject.out).toEqual(['diff --git a/x b/x'])
    expect(subject.err).toEqual(['note: the diff was cut at the configured size limit'])
  })
})

describe('apply', () => {
  it('runs the chosen command and exits 0, exits 1 on failure, and prints help for no arguments', async () => {
    for (const [argv, code] of [[['kb', 'list'], 0], [['runs', 'diff', 'r1', 'a'], 1], [[], 0]] as const) {
      const subject = bench([...argv])
      if (code === 1) subject.worktrees.diff.mockRejectedValueOnce(new Error('unknown run "r1"'))
      const exit = vi.fn()
      subject.ctx.provide('appExit', exit as never)
      apply(subject.ctx, subject.io)
      await vi.waitFor(() => { expect(exit).toHaveBeenCalledWith(code) })
      if (code === 1) expect(subject.err).toEqual(['error: unknown run "r1"'])
      if (argv.length === 0) expect(subject.out[0]).toMatch(/^Usage: dsh tteoki \[options\] \[command\]\n/)
    }
  })

  it('refuses to run without the launcher exit', () => {
    const subject = bench()
    expect(() => { apply(subject.ctx, subject.io) }).toThrow('tteoki-cli: the launcher must provide ctx.appExit')
  })
})
