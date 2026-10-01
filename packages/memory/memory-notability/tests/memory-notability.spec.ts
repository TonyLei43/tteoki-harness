/** Notability extractor: keyed-archive decoding, package reading, Markdown rendering, and registration. */

import { Context } from '@deepseek-ai/cordis'
import { cpSync, mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { isRecord, readPlist, unarchive } from '../src/archive.ts'
import { apply, createNotabilityExtractor, extractNote, fingerprintNote, notabilityExtractor, noteMarkdown, readNote, readStrokes, renderPages } from '../src/index.ts'
import { readPlist as readSession } from '../src/archive.ts'

const FIXTURES = fileURLToPath(new URL('fixtures/', import.meta.url))
const NOTE = join(FIXTURES, 'Lec 1.nbn')

describe('keyed archives', () => {
  it('resolves strings, bytes, dates, dictionaries, arrays, nulls, and cycles', async () => {
    const session = unarchive(await readPlist(join(NOTE, 'Session.plist')), '$0')
    if (!isRecord(session) || !isRecord(session.richText) || !isRecord(session.richText.NBAttributedBackingString)) throw new Error('unexpected session')
    expect(session.name).toBe('STAT 538 Lec 1')
    expect(session.tags).toEqual({ week: ['week', undefined] })
    expect(session.richText.NBAttributedBackingString.owner).toBe(session)
    const metadata = unarchive(await readPlist(join(NOTE, 'metadata.plist')))
    expect(isRecord(metadata) && metadata.noteCreationDateKey).toEqual(new Date('2026-02-02T16:33:27.000Z'))
  })

  it('rejects a plist that is not a keyed archive', async () => {
    expect(() => unarchive('x')).toThrow('not an NSKeyedArchiver plist')
    expect(() => unarchive(0)).toThrow('not an NSKeyedArchiver plist')
    await expect(readPlist(join(FIXTURES, 'not-archive.plist')).then(unarchive)).rejects.toThrow('not an NSKeyedArchiver plist')
  })
})

describe('Notability packages', () => {
  it('reads metadata, typed text, handwriting pages in order, and imported PDF text', async () => {
    expect(await readNote(NOTE)).toEqual({
      title: 'STAT 538 Lec 1',
      uuid: 'F501223E-0000-0000-0000-000000000001',
      subject: 'SUBJECT-538',
      created: new Date('2026-02-02T16:33:27.000Z'),
      modified: new Date('2026-02-02T16:33:27.000Z'),
      typed: 'Typed: MLE is consistent',
      handwriting: [{ page: 1, text: 'Lec 1 asymptotics' }, { page: 2, text: 'Fisher information\nI(theta)' }],
      pdfs: ['Homework 4\nlogistic regression', 'Second handout'],
    })
  })

  it('renders one section per part and fails a note with no text', async () => {
    expect(noteMarkdown(await readNote(NOTE))).toBe([
      '# STAT 538 Lec 1',
      '## Typed notes\n\nTyped: MLE is consistent',
      '## Page 1\n\nLec 1 asymptotics',
      '## Page 2\n\nFisher information\nI(theta)',
      '## Imported PDF 1\n\nHomework 4\nlogistic regression',
      '## Imported PDF 2\n\nSecond handout',
    ].join('\n\n'))
    const blank = await readNote(join(FIXTURES, 'Blank.nbn'))
    expect(blank).toMatchObject({ title: '', typed: '', handwriting: [], pdfs: [], created: new Date(0) })
    expect(() => noteMarkdown(blank)).toThrow('no typed text, recognized handwriting, or PDF text; the note needs OCR')
    expect(noteMarkdown({ ...blank, title: 'One', pdfs: ['only'] })).toBe('# One\n\n## Imported PDF\n\nonly')
  })

  it('fingerprints the text-bearing files and changes when one is touched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-notability-'))
    onTestFinished(() => { rmSync(dir, { recursive: true, force: true }) })
    const copy = join(dir, 'Lec 1.nbn')
    cpSync(NOTE, copy, { recursive: true })
    const before = await fingerprintNote(copy)
    expect(await fingerprintNote(join(FIXTURES, 'Blank.nbn'))).toMatch(/Session\.plist:-\|HandwritingIndex\/index\.plist:-\|NBPDFIndex\/PDFIndex\.zip:-$/)
    utimesSync(join(copy, 'HandwritingIndex', 'index.plist'), new Date(0), new Date(1_000))
    expect(await fingerprintNote(copy)).not.toBe(before)
  })

  it('registers the bundle extractor with the memory service', async () => {
    const registered: unknown[] = []
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    ctx.provide('memory', { registerExtractor: (extractor: unknown) => { registered.push(extractor); return () => {} }, ocrEnabled: () => false } as never)
    apply(ctx)
    expect(registered).toMatchObject([{ id: 'notability', bundles: ['.nbn'] }])
    expect(notabilityExtractor.bundles).toEqual(['.nbn'])
    await expect(notabilityExtractor.extract(NOTE, new AbortController().signal)).resolves.toMatch(/^# STAT 538 Lec 1\n\n## Typed notes/)
  })

  it('reads pen strokes and page geometry, and renders one image per page with strokes', async () => {
    const strokes = readStrokes(unarchive(await readSession(join(FIXTURES, 'Handwritten.nbn', 'Session.plist')), '$0'))
    expect(strokes.pageWidth).toBe(600)
    expect(strokes.pageHeight).toBeCloseTo(600 * 11 / 8.5)
    expect(strokes.strokes.map(stroke => [stroke.points.length / 2, stroke.width, stroke.color])).toEqual([[3, 2, 'rgba(0, 0, 0, 1.000)'], [2, 1, 'rgba(200, 0, 0, 1.000)']])
    const pages = await renderPages(strokes, 1)
    expect(pages.map(page => page.page)).toEqual([1, 2])
    expect(Array.from(pages[0]!.png.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47])
    expect(readStrokes(undefined)).toMatchObject({ pageWidth: 834.4, strokes: [] })
    expect(await renderPages(readStrokes(undefined))).toEqual([])
  })

  it('transcribes handwriting-only notes page by page when OCR is available', async () => {
    const note = join(FIXTURES, 'Handwritten.nbn')
    await expect(extractNote(note, new AbortController().signal)).rejects.toThrow('the note needs OCR')
    const ocr = vi.fn(async (_png: Uint8Array, hint: string) => hint.startsWith('page 1') ? 'Martingale $M_n$' : '')
    await expect(extractNote(note, new AbortController().signal, ocr)).resolves.toBe('# MATH 491 Lec 1\n\n## Page 1\n\nMartingale $M_n$')
    expect(ocr.mock.calls.map(call => call[1])).toEqual(['page 1 of handwritten lecture notes titled "MATH 491 Lec 1"', 'page 2 of handwritten lecture notes titled "MATH 491 Lec 1"'])
    await expect(extractNote(note, new AbortController().signal, async () => ' ')).rejects.toThrow('the note has no handwriting to transcribe')
    await expect(createNotabilityExtractor(() => ocr).extract(NOTE, new AbortController().signal)).resolves.toMatch(/^# STAT 538 Lec 1/)
    expect(notabilityExtractor.id).toBe('notability')
  })

  it('renders a handwritten page for previews', async () => {
    const extractor = createNotabilityExtractor()
    const png = await extractor.renderPage!(join(FIXTURES, 'Handwritten.nbn'), 2, new AbortController().signal)
    expect(Array.from(png.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47])
    await expect(extractor.renderPage!(join(FIXTURES, 'Handwritten.nbn'), 5, new AbortController().signal)).rejects.toThrow('page 5 has no handwriting')
  })

  it('replaces Notability recognition with OCR when asked, keeping typed and PDF text', async () => {
    const ocr = vi.fn(async () => 'Clean transcript')
    await expect(extractNote(NOTE, new AbortController().signal, ocr)).resolves.toContain('## Page 1\n\nLec 1 asymptotics')
    expect(ocr).not.toHaveBeenCalled()
    const replaced = await extractNote(join(FIXTURES, 'Handwritten.nbn'), new AbortController().signal, ocr, true)
    expect(replaced).toBe('# MATH 491 Lec 1\n\n## Page 1\n\nClean transcript\n\n## Page 2\n\nClean transcript')
  })
})
