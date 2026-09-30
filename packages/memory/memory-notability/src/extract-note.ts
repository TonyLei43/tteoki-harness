/** One note's text: its own text layers, or OCR of its handwriting when it has none. */

import { join } from 'node:path'
import { readPlist, unarchive } from './archive.ts'
import { noteMarkdown, readNote } from './note.ts'
import { readStrokes, renderPages } from './render.ts'

/** Transcribes one rendered page image. */
export type PageOcr = (png: Uint8Array, hint: string, signal: AbortSignal) => Promise<string>

/**
 * Extract one note: its typed, recognized, and PDF text. A note with none of
 * these is rendered from its pen strokes and transcribed when OCR is
 * available; with `transcribeAll`, handwriting is transcribed by OCR in place
 * of Notability's own recognition, keeping typed and PDF text.
 * @param bundle - absolute `.nbn` directory.
 * @param signal - caller cancellation.
 * @param ocr - page transcription, or undefined when OCR is off.
 * @param transcribeAll - whether OCR replaces Notability's handwriting recognition.
 * @param concurrency - pages transcribed at once.
 * @returns Markdown text.
 * @throws Error when the note has no text and OCR is off or finds none.
 */
export async function extractNote(bundle: string, signal: AbortSignal, ocr?: PageOcr, transcribeAll = false, concurrency = 1): Promise<string> {
  const note = await readNote(bundle)
  const hasText = note.typed !== '' || note.handwriting.length > 0 || note.pdfs.length > 0
  if (ocr === undefined || (hasText && !transcribeAll)) return noteMarkdown(note)
  const pages = await renderPages(readStrokes(unarchive(await readPlist(join(bundle, 'Session.plist')), '$0')))
  const transcripts = await mapLimit(pages, concurrency, async (page) => {
    signal.throwIfAborted()
    return { page: page.page, text: (await ocr(page.png, `page ${page.page} of handwritten lecture notes titled "${note.title}"`, signal)).trim() }
  })
  const handwriting = transcripts.filter(entry => entry.text !== '')
  if (!hasText && handwriting.length === 0) throw new Error('the note has no handwriting to transcribe')
  return noteMarkdown({ ...note, handwriting: handwriting.length > 0 ? handwriting : note.handwriting })
}

/**
 * Map items with at most `limit` calls in flight, keeping input order.
 * @param items - inputs.
 * @param limit - most concurrent calls, at least 1.
 * @param map - the async mapping.
 * @returns outputs in input order.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
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
