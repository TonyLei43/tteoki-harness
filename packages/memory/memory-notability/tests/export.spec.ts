/** Notability export: course parsing, filing, idempotence, edit protection, and OCR skipping. */

import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { courseOfTitle, exportNotes, mapLimit, splitFrontMatter } from '../src/index.ts'

const FIXTURES = fileURLToPath(new URL('fixtures/', import.meta.url))

describe('courseOfTitle', () => {
  it('reads course codes from note titles', () => {
    expect(courseOfTitle('STAT 538 Lec 8')).toEqual({ code: 'STAT 538', rest: 'Lec 8' })
    expect(courseOfTitle('Stat 513 Lec16')).toEqual({ code: 'STAT 513', rest: 'Lec16' })
    expect(courseOfTitle('Math 151B Lec 7')).toEqual({ code: 'MATH 151B', rest: 'Lec 7' })
    expect(courseOfTitle('STAT_512_Lectures-Lec6')).toEqual({ code: 'STAT 512', rest: 'Lectures-Lec6' })
    expect(courseOfTitle('STAT 534')).toEqual({ code: 'STAT 534', rest: 'STAT 534' })
    expect(courseOfTitle('Note Feb 24, 2021')).toBeUndefined()
    expect(courseOfTitle('Lecture 12_22')).toBeUndefined()
  })

  it('splits front matter from the body', () => {
    expect(splitFrontMatter('---\ncourse: "STAT 538"\ntteoki_hash: abc\n---\n# Body\n')).toEqual({ fields: { course: 'STAT 538', tteoki_hash: 'abc' }, body: '# Body\n' })
    expect(splitFrontMatter('# No front matter')).toEqual({ fields: {}, body: '# No front matter' })
  })
})

describe('exportNotes', () => {
  function bench() {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-export-'))
    onTestFinished(() => { rmSync(dir, { recursive: true, force: true }) })
    const from = join(dir, 'Notability')
    cpSync(FIXTURES, from, { recursive: true })
    rmSync(join(from, 'not-archive.plist'))
    return { from, to: join(dir, 'Vault', 'Academic') }
  }
  const options = (from: string, to: string) => ({ notabilityDir: from, targetDir: to, schoolCutoff: new Date('2025-09-01T00:00:00'), schoolAfter: 'UW', schoolBefore: 'UCLA' })

  it('files notes by school, course, and date, and skips handwriting-only notes without OCR', async () => {
    const subject = bench()
    const progress = vi.fn()
    const results = await exportNotes(options(subject.from, subject.to), new AbortController().signal, progress)
    expect(results.map(entry => [entry.title, entry.outcome, entry.path?.slice(subject.to.length), entry.reason])).toEqual([
      ['Blank', 'skipped', undefined, 'handwriting only; needs OCR'],
      ['MATH 491 Lec 1', 'skipped', undefined, 'handwriting only; needs OCR'],
      ['STAT 538 Lec 1', 'written', '/UW/STAT 538/2026-02-02 Lec 1.md', undefined],
    ])
    expect(progress).toHaveBeenCalledTimes(3)
    const note = readFileSync(join(subject.to, 'UW', 'STAT 538', '2026-02-02 Lec 1.md'), 'utf8')
    expect(note).toMatch(/^---\ncourse: "STAT 538"\ncreated: 2026-02-02\nmodified: 2026-02-02\nsource: notability\nnotability_id: "F501223E-0000-0000-0000-000000000001"\nnotability_title: "STAT 538 Lec 1"\ntteoki_hash: [0-9a-f]{16}\n---\n# STAT 538 Lec 1\n\n## Typed notes/)
  })

  it('leaves unchanged notes, updates unedited ones, and keeps edited ones', async () => {
    const subject = bench()
    const filter = /^STAT/
    await exportNotes({ ...options(subject.from, subject.to), filter }, new AbortController().signal)
    const path = join(subject.to, 'UW', 'STAT 538', '2026-02-02 Lec 1.md')
    expect((await exportNotes({ ...options(subject.from, subject.to), filter }, new AbortController().signal))[0]!.outcome).toBe('unchanged')

    const original = readFileSync(path, 'utf8')
    writeFileSync(path, original.replace(/tteoki_hash: [0-9a-f]+/, 'tteoki_hash: 0000000000000000').replace('# STAT 538 Lec 1', '# STAT 538 Lec 1 '))
    const refreshed = await exportNotes({ ...options(subject.from, subject.to), filter }, new AbortController().signal)
    expect(refreshed[0]!.outcome).toBe('conflict')
    expect(readdirSync(join(subject.to, 'UW', 'STAT 538')).sort()).toEqual(['2026-02-02 Lec 1 (from Notability).md', '2026-02-02 Lec 1.md'])
    expect(readFileSync(path, 'utf8')).toContain('# STAT 538 Lec 1 \n')

    const { fields, body } = splitFrontMatter(original)
    writeFileSync(path, `---\ncourse: "STAT 538"\ntteoki_hash: ${fields.tteoki_hash ?? ''}\n---\n${body}`.replace(/tteoki_hash: [0-9a-f]+/, `tteoki_hash: ${fields.tteoki_hash ?? ''}`).replace(body, 'stale body\n'))
    const stale = readFileSync(path, 'utf8')
    writeFileSync(path, stale.replace(/tteoki_hash: [0-9a-f]+/, `tteoki_hash: ${(await import('node:crypto')).createHash('sha256').update('stale body\n').digest('hex').slice(0, 16)}`))
    expect((await exportNotes({ ...options(subject.from, subject.to), filter }, new AbortController().signal))[0]!.outcome).toBe('written')
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it('transcribes handwriting-only notes with OCR and files notes without a course as unsorted', async () => {
    const subject = bench()
    const results = await exportNotes({ ...options(subject.from, subject.to), filter: /MATH|^$|Blank/i, ocr: async hint => hint.length > 0 ? 'Martingale' : '' }, new AbortController().signal)
    expect(results.find(entry => entry.title === 'MATH 491 Lec 1')).toMatchObject({ outcome: 'written' })
    expect(results.find(entry => entry.title === 'MATH 491 Lec 1')!.path).toMatch(/\/UCLA\/MATH 491\/19(69-12-31|70-01-01) Lec 1\.md$/)
    expect(results.find(entry => entry.title === 'Blank')).toMatchObject({ outcome: 'failed' })
  })
})

describe('mapLimit', () => {
  it('keeps order and never exceeds the limit', async () => {
    let active = 0
    let peak = 0
    const out = await mapLimit([30, 10, 20, 5, 1], 2, async (delay) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, delay))
      active -= 1
      return delay * 2
    })
    expect(out).toEqual([60, 20, 40, 10, 2])
    expect(peak).toBe(2)
    await expect(mapLimit([], 4, async () => 1)).resolves.toEqual([])
  })
})
