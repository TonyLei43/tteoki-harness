/**
 * PDF extractor for the memory ingestion pipeline: reads each page's text
 * layer through pdfjs and emits one `## Page N` section per page, so search
 * hits cite their page. A PDF without any text layer (a scan) is rendered page
 * by page and transcribed by the memory service's vision model when OCR is
 * configured; otherwise it fails with a message naming OCR, which the index
 * run reports as a per-file failure.
 */

import type { Context } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import type { Extractor } from '@deepseek-ai/dsh-memory'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export const name = 'memory-pdf'

export const inject = ['memory']

/** One page content item as pdfjs reports it: a text run or a marked-content marker. */
export type PageItem = { readonly str: string; readonly hasEOL: boolean } | { readonly type: string }

/**
 * Join one page's text items, keeping pdfjs end-of-line marks.
 * @param items - the page's text content items.
 * @returns the page text, trimmed.
 */
export function pageText(items: readonly PageItem[]): string {
  return items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ''}` : '').join('').replace(/[ \t]+\n/g, '\n').trim()
}

/**
 * Map items with at most `limit` calls in flight, keeping input order.
 * @param items - inputs.
 * @param limit - most concurrent calls, at least 1.
 * @param map - the async mapping.
 * @returns outputs in input order.
 */
async function mapLimit<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      out[index] = await map(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

/** Transcribes one rendered page image. */
export type PageOcr = (png: Uint8Array, hint: string, signal: AbortSignal) => Promise<string>

/** Render scale for OCR: 2x the PDF's 72-dpi page size. */
const OCR_SCALE = 2

/**
 * Extract every page's text layer as Markdown sections, transcribing a
 * scanned PDF page by page when OCR is available.
 * @param path - absolute PDF path.
 * @param signal - caller cancellation, checked between pages.
 * @param ocr - page transcription, or undefined when OCR is off.
 * @param concurrency - pages transcribed at once.
 * @returns one `## Page N` section per page that has text.
 * @throws Error when no page has a text layer and OCR is off, or OCR fails.
 */
export async function extractPdf(path: string, signal: AbortSignal, ocr?: PageOcr, concurrency = 1): Promise<string> {
  const task = getDocument({ data: new Uint8Array(await readFile(path)), disableFontFace: true, verbosity: 0 })
  try {
    const document = await task.promise
    const sections: string[] = []
    for (let number = 1; number <= document.numPages; number += 1) {
      signal.throwIfAborted()
      const page = await document.getPage(number)
      const text = pageText((await page.getTextContent()).items)
      page.cleanup()
      if (text !== '') sections.push(`## Page ${number}\n\n${text}`)
    }
    if (sections.length > 0) return sections.join('\n\n')
    if (ocr === undefined) throw new Error(`no text layer in ${document.numPages} page(s); the PDF needs OCR`)
    const numbers = Array.from({ length: document.numPages }, (_, index) => index + 1)
    const transcripts = await mapLimit(numbers, concurrency, async (number) => {
      signal.throwIfAborted()
      return (await ocr(await renderPdfPage(path, number, OCR_SCALE), `page ${number} of a scanned PDF`, signal)).trim()
    })
    transcripts.forEach((transcript, index) => { if (transcript !== '') sections.push(`## Page ${index + 1}\n\n${transcript}`) })
    if (sections.length === 0) throw new Error(`OCR found no text in ${document.numPages} page(s)`)
    return sections.join('\n\n')
  } finally {
    await task.destroy()
  }
}

/**
 * Render one PDF page as a PNG on a white background.
 * @param path - absolute PDF path.
 * @param number - 1-based page number.
 * @param scale - pixels per PDF point.
 * @returns PNG bytes.
 * @throws Error when the page does not exist.
 */
export async function renderPdfPage(path: string, number: number, scale = 1.5): Promise<Uint8Array> {
  const task = getDocument({ data: new Uint8Array(await readFile(path)), disableFontFace: true, verbosity: 0 })
  try {
    const document = await task.promise
    if (number < 1 || number > document.numPages) throw new Error(`page ${number} is outside 1–${document.numPages}`)
    const page = await document.getPage(number)
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    // pdfjs draws through the 2D context; the napi canvas implements the same API.
    await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise
    page.cleanup()
    return await canvas.encode('png')
  } finally {
    await task.destroy()
  }
}

/**
 * Build the `.pdf` extractor.
 * @param ocr - page transcription used for scans; reads the current OCR availability on each call.
 * @param concurrency - pages transcribed at once; read on each call.
 * @returns the extractor.
 */
export function createPdfExtractor(ocr?: () => PageOcr | undefined, concurrency: () => number = () => 1): Extractor {
  return { id: 'pdf', version: 1, files: ['.pdf'], bundles: [], extract: (path, signal) => extractPdf(path, signal, ocr?.(), concurrency()), renderPage: (path, page) => renderPdfPage(path, page) }
}

/** The `.pdf` extractor without OCR. */
export const pdfExtractor: Extractor = createPdfExtractor()

/**
 * Register the PDF extractor with the memory service.
 * @param ctx - plugin context with `memory` injected.
 */
export function apply(ctx: Context): void {
  const extractor = createPdfExtractor(() => ctx.memory.ocrEnabled() ? (png, hint, signal) => ctx.memory.ocrImage(png, hint, signal) : undefined, () => ctx.memory.ocrConcurrency())
  ctx.effect(() => ctx.memory.registerExtractor(extractor), 'memory-pdf: extractor')
}
