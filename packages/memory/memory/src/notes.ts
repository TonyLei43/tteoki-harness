/**
 * Agent memory notes: named Markdown files an agent writes into one knowledge
 * base's `memories/` directory. The directory is indexed with the knowledge
 * base's sources, so saved notes are searchable.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Note names: one safe file stem. */
const NOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/

/**
 * Resolve a note file, rejecting names that are not one safe file stem.
 * @param directory - the knowledge base's `memories/` directory.
 * @param name - note name without extension.
 * @returns the absolute note path.
 * @throws Error when the name is invalid.
 */
function notePath(directory: string, name: string): string {
  if (!NOTE_NAME.test(name) || name.endsWith('.')) {
    throw new Error(`invalid memory name "${name}": use up to 80 letters, digits, spaces, ".", "-", or "_"`)
  }
  return join(directory, `${name}.md`)
}

/**
 * List note names.
 * @param directory - the knowledge base's `memories/` directory.
 * @returns note names in ascending order; none when the directory is absent.
 */
export async function listNotes(directory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    // A knowledge base without saved notes has no directory yet.
    return []
  }
  return entries.filter(entry => entry.isFile() && entry.name.endsWith('.md')).map(entry => entry.name.slice(0, -3)).sort()
}

/**
 * Read one note.
 * @param directory - the knowledge base's `memories/` directory.
 * @param name - note name.
 * @returns the note content.
 * @throws Error when the name is invalid or the note does not exist.
 */
export async function readNote(directory: string, name: string): Promise<string> {
  const path = notePath(directory, name)
  try {
    return await readFile(path, 'utf8')
  } catch {
    // Any unreadable note is reported as missing to the caller.
    throw new Error(`memory "${name}" does not exist`)
  }
}

/**
 * Create or replace one note.
 * @param directory - the knowledge base's `memories/` directory, created when absent.
 * @param name - note name.
 * @param content - full Markdown content.
 * @param maxChars - largest accepted content length.
 * @throws Error when the name is invalid or the content is longer than `maxChars`.
 */
export async function writeNote(directory: string, name: string, content: string, maxChars: number): Promise<void> {
  const path = notePath(directory, name)
  if (content.length > maxChars) throw new Error(`memory content has ${content.length} characters, above ${maxChars}`)
  await mkdir(directory, { recursive: true })
  await writeFile(path, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
}
