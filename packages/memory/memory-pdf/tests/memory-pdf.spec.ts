/** PDF extractor: page sections, scanned-PDF failure, and registration. */

import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { apply, createPdfExtractor, extractPdf, pageText, renderPdfPage } from '../src/index.ts'

/**
 * Build a minimal single-font PDF whose pages draw the given strings.
 * @param pages - one entry per page; `undefined` draws nothing on that page.
 * @returns the PDF bytes as latin-1 text.
 */
function pdf(pages: readonly (readonly string[] | undefined)[]): string {
  const objects: string[] = []
  const add = (body: string): number => objects.push(body)
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageIds: number[] = []
  const pagesId = pages.length * 2 + 2 + 1
  for (const lines of pages) {
    const stream = lines === undefined ? '' : `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map(line => `(${line}) '`).join(' ')} ET`
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`))
  }
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  add(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(out.length)
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  return `${out}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
}

/**
 * Write a PDF into a fresh temporary directory.
 * @param pages - page strings passed to {@link pdf}.
 * @returns the absolute PDF path.
 */
function writePdf(pages: readonly (readonly string[] | undefined)[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-pdf-'))
  onTestFinished(() => { rmSync(dir, { recursive: true, force: true }) })
  const path = join(dir, 'doc.pdf')
  writeFileSync(path, pdf(pages), 'latin1')
  return path
}

describe('memory-pdf', () => {
  it('joins text items at end-of-line marks', () => {
    expect(pageText([{ str: 'Homework 2 ', hasEOL: true }, { type: 'beginMarkedContent' }, { str: 'n = 148', hasEOL: false }])).toBe('Homework 2\nn = 148')
  })

  it('emits one section per page with text and skips blank pages', async () => {
    const text = await extractPdf(writePdf([['STAT 534', 'Homework 2'], undefined, ['Logistic regression']]), new AbortController().signal)
    expect(text).toMatch(/^## Page 1\n\nSTAT 534\s+Homework 2\n\n## Page 3\n\nLogistic regression$/)
  })

  it('fails a PDF without a text layer and honors cancellation', async () => {
    await expect(extractPdf(writePdf([undefined, undefined]), new AbortController().signal)).rejects.toThrow('no text layer in 2 page(s); the PDF needs OCR')
    await expect(extractPdf(writePdf([['x']]), AbortSignal.abort())).rejects.toThrow()
  })

  it('registers the extractor with the memory service', async () => {
    const registered: unknown[] = []
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    ctx.provide('memory', { registerExtractor: (extractor: unknown) => { registered.push(extractor); return () => {} }, ocrEnabled: () => false } as never)
    apply(ctx)
    expect(registered).toMatchObject([{ id: 'pdf', files: ['.pdf'] }])
  })

  it('transcribes a scanned PDF page by page when OCR is available', async () => {
    const path = writePdf([undefined, undefined])
    const ocr = vi.fn(async (png: Uint8Array, hint: string) => {
      expect(Array.from(png.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47])
      return hint.includes('page 1') ? '# Problem 1\n\nShow $X_n \\to X$.' : '  '
    })
    await expect(extractPdf(path, new AbortController().signal, ocr)).resolves.toBe('## Page 1\n\n# Problem 1\n\nShow $X_n \\to X$.')
    expect(ocr).toHaveBeenCalledTimes(2)
    await expect(extractPdf(path, new AbortController().signal, async () => '')).rejects.toThrow('OCR found no text in 2 page(s)')
    const extractor = createPdfExtractor(() => ocr)
    await expect(extractor.extract(path, new AbortController().signal)).resolves.toContain('Problem 1')
  })

  it('renders a page to PNG and rejects pages out of range', async () => {
    const path = writePdf([['STAT 534'], ['Homework 2']])
    const png = await renderPdfPage(path, 2, 1)
    expect(Array.from(png.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47])
    await expect(renderPdfPage(path, 3)).rejects.toThrow('page 3 is outside 1–2')
    await expect(createPdfExtractor().renderPage!(path, 1, new AbortController().signal)).resolves.toBeInstanceOf(Uint8Array)
  })
})
