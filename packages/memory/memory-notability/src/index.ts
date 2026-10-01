/**
 * Notability extractor for the memory ingestion pipeline: each `.nbn` package
 * is one document built from its typed text, Notability's handwriting
 * recognition, and imported PDF text. A note carrying none of these is drawn
 * from its pen strokes and transcribed by the memory service's vision model
 * when OCR is configured; otherwise it fails with a message naming OCR.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Extractor } from '@deepseek-ai/dsh-memory'
import { join } from 'node:path'
import { readPlist, unarchive } from './archive.ts'
import { extractNote } from './extract-note.ts'
import type { PageOcr } from './extract-note.ts'
import { fingerprintNote } from './note.ts'
import { readStrokes, renderPages } from './render.ts'

export { fingerprintNote, noteMarkdown, readNote, readNoteMeta, type NotabilityNote, type NoteMeta } from './note.ts'
export { readStrokes, renderPages, type Stroke, type StrokeDocument } from './render.ts'
export { extractNote, mapLimit, type PageOcr } from './extract-note.ts'
export { courseOfTitle, exportNote, exportNotes, splitFrontMatter, type ExportEntry, type ExportOptions, type ExportOutcome } from './export.ts'

export const name = 'memory-notability'

export const inject = ['memory']

/**
 * Build the `.nbn` bundle extractor.
 * @param ocr - page transcription for handwriting-only notes; read on each call.
 * @param concurrency - pages transcribed at once; read on each call.
 * @returns the extractor.
 */
export function createNotabilityExtractor(ocr?: () => PageOcr | undefined, concurrency: () => number = () => 1): Extractor {
  return {
    id: 'notability',
    version: 1,
    files: [],
    bundles: ['.nbn'],
    fingerprint: fingerprintNote,
    extract: (path, signal) => extractNote(path, signal, ocr?.(), false, concurrency()),
    renderPage: async (path, page) => {
      const rendered = (await renderPages(readStrokes(unarchive(await readPlist(join(path, 'Session.plist')), '$0')))).find(entry => entry.page === page)
      if (rendered === undefined) throw new Error(`page ${page} has no handwriting`)
      return rendered.png
    },
  }
}

/** The `.nbn` bundle extractor without OCR. */
export const notabilityExtractor: Extractor = createNotabilityExtractor()

/**
 * Register the Notability extractor with the memory service.
 * @param ctx - plugin context with `memory` injected.
 */
export function apply(ctx: Context): void {
  const extractor = createNotabilityExtractor(() => ctx.memory.ocrEnabled() ? (png, hint, signal) => ctx.memory.ocrImage(png, hint, signal) : undefined, () => ctx.memory.ocrConcurrency())
  ctx.effect(() => ctx.memory.registerExtractor(extractor), 'memory-notability: extractor')
}
