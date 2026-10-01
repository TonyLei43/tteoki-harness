/**
 * Notability `.nbn` package reader. A package stores its title and dates in
 * `metadata.plist`, typed text in `Session.plist`, Notability's own handwriting
 * recognition per page in `HandwritingIndex/index.plist`, and the text layer of
 * imported PDFs in `NBPDFIndex/PDFIndex.zip`. Every part except the metadata is
 * optional.
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { isRecord, readPlist, unarchive, type Archived } from './archive.ts'

/** One Notability note's metadata. */
export interface NoteMeta {
  /** Note title as shown in Notability. */
  readonly title: string
  /** Stable note UUID. */
  readonly uuid: string
  /** Subject (divider) key the note is filed under; `unsortedNotesKey` when unfiled. */
  readonly subject: string
  /** Creation time. */
  readonly created: Date
  /** Last modification time. */
  readonly modified: Date
}

/** The text-bearing content of one Notability note. */
export interface NotabilityNote extends NoteMeta {
  /** Typed text, empty when the note has none. */
  readonly typed: string
  /** Recognized handwriting per page, in page order; pages without text are omitted. */
  readonly handwriting: readonly { readonly page: number; readonly text: string }[]
  /** Text layer of each imported PDF, in archive-entry order. */
  readonly pdfs: readonly string[]
}

/** Package files whose size and time decide whether the extracted text may have changed. */
const FINGERPRINT_FILES = ['metadata.plist', 'Session.plist', 'HandwritingIndex/index.plist', 'NBPDFIndex/PDFIndex.zip']

/**
 * Walk a decoded value by keys.
 * @param value - decoded root.
 * @param keys - property path.
 * @returns the value at the path, or undefined when any step is missing.
 */
function at(value: Archived, ...keys: string[]): Archived {
  let current = value
  for (const key of keys) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

/**
 * Read a decoded value as text.
 * @param value - a string or UTF-8 bytes.
 * @returns the text, or an empty string for any other value.
 */
function text(value: Archived): string {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return new TextDecoder().decode(value)
  return ''
}

/**
 * Read a file only when it exists.
 * @param path - absolute file path.
 * @param read - reader for an existing file.
 * @returns the reader's value, or undefined when the file is absent.
 */
async function optional<T>(path: string, read: (path: string) => Promise<T>): Promise<T | undefined> {
  try {
    await stat(path)
  } catch {
    // An absent optional package part contributes nothing.
    return undefined
  }
  return await read(path)
}

/**
 * Read the recognized handwriting pages of a handwriting index.
 * @param index - decoded `HandwritingIndex/index.plist`.
 * @returns non-empty pages in ascending page order.
 */
function handwritingPages(index: Archived): { page: number; text: string }[] {
  const pages = at(index, 'pages')
  if (!isRecord(pages)) return []
  return Object.entries(pages)
    .map(([page, value]) => ({ page: Number(page), text: text(at(value, 'text')).trim() }))
    .filter(entry => Number.isFinite(entry.page) && entry.text !== '')
    .sort((left, right) => left.page - right.page)
}

/**
 * Read the PDF text entries of a PDF index archive.
 * @param path - absolute `PDFIndex.zip` path.
 * @returns each imported PDF's non-empty text, in entry-name order.
 */
async function pdfTexts(path: string): Promise<string[]> {
  const entries = unzipSync(new Uint8Array(await readFile(path)), { filter: file => file.name.endsWith('/PDFTextIndex.txt') })
  return Object.keys(entries).sort().map(name => strFromU8(entries[name] as Uint8Array).trim()).filter(entry => entry !== '')
}

/**
 * Fingerprint the package files that feed extraction.
 * @param bundle - absolute `.nbn` directory.
 * @returns a string that changes when any text-bearing part changes size or time.
 */
export async function fingerprintNote(bundle: string): Promise<string> {
  const parts = await Promise.all(FINGERPRINT_FILES.map(async name => {
    const info = await optional(join(bundle, name), stat)
    return info === undefined ? `${name}:-` : `${name}:${info.size}:${info.mtimeMs}`
  }))
  return parts.join('|')
}

/**
 * Read one Notability package's metadata without its pages.
 * @param bundle - absolute `.nbn` directory.
 * @returns title, id, subject, and times.
 * @throws Error when `metadata.plist` is missing or not a keyed archive.
 */
export async function readNoteMeta(bundle: string): Promise<NoteMeta> {
  const metadata = unarchive(await readPlist(join(bundle, 'metadata.plist')))
  const created = at(metadata, 'noteCreationDateKey')
  const modified = at(metadata, 'noteModifiedDateKey')
  return {
    title: text(at(metadata, 'noteName')).trim(),
    uuid: text(at(metadata, 'uuidKey')),
    subject: text(at(metadata, 'noteSubject')),
    created: created instanceof Date ? created : new Date(0),
    modified: modified instanceof Date ? modified : new Date(0),
  }
}

/**
 * Read one Notability package.
 * @param bundle - absolute `.nbn` directory.
 * @returns the note's metadata and text.
 * @throws Error when `metadata.plist` is missing or not a keyed archive.
 */
export async function readNote(bundle: string): Promise<NotabilityNote> {
  const meta = await readNoteMeta(bundle)
  const session = await optional(join(bundle, 'Session.plist'), async path => unarchive(await readPlist(path), '$0'))
  const index = await optional(join(bundle, 'HandwritingIndex', 'index.plist'), readPlist)
  const typed = text(at(session, 'richText', 'NBAttributedBackingString', 'NBAttributedBackingStringCodingKey', 'stringKey'))
    || text(at(session, 'richText', 'attributedString', 'stringKey'))
  return {
    ...meta,
    typed: typed.trim(),
    handwriting: index === undefined ? [] : handwritingPages(index),
    pdfs: await optional(join(bundle, 'NBPDFIndex', 'PDFIndex.zip'), pdfTexts) ?? [],
  }
}

/**
 * Render a note as Markdown for indexing: the title, then typed text, each
 * handwriting page, and each imported PDF as its own section.
 * @param note - the note to render.
 * @returns Markdown text.
 * @throws Error when the note carries no text at all and needs OCR.
 */
export function noteMarkdown(note: NotabilityNote): string {
  const sections = [
    ...note.typed === '' ? [] : [`## Typed notes\n\n${note.typed}`],
    ...note.handwriting.map(page => `## Page ${page.page}\n\n${page.text}`),
    ...note.pdfs.map((pdf, index) => `## Imported PDF${note.pdfs.length === 1 ? '' : ` ${index + 1}`}\n\n${pdf}`),
  ]
  if (sections.length === 0) throw new Error('no typed text, recognized handwriting, or PDF text; the note needs OCR')
  return `# ${note.title}\n\n${sections.join('\n\n')}`
}
