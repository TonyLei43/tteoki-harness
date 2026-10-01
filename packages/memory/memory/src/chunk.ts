/** Markdown-aware chunking that preserves heading context. */

/** One chunk of a document with the nearest heading above it. */
export interface Chunk {
  /** Nearest markdown heading, when the chunk sits under one. */
  readonly heading?: string
  /** Chunk text. */
  readonly text: string
}

/** A markdown heading line: one to six leading hashes then the title. */
const HEADING = /^(#{1,6})\s+(.*)$/

/**
 * Split one block that exceeds the target into overlapping windows.
 * @param out - accumulator.
 * @param heading - heading context for the block.
 * @param text - the oversized block text.
 * @param chunkChars - target chunk size in characters.
 * @param overlapChars - overlap between adjacent windows.
 */
function pushOversized(out: Chunk[], heading: string | undefined, text: string, chunkChars: number, overlapChars: number): void {
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + chunkChars, text.length)
    out.push(heading === undefined ? { text: text.slice(start, end) } : { heading, text: text.slice(start, end) })
    if (end >= text.length) break
    start = end - overlapChars
  }
}

/**
 * Split one section's text into chunks of at most `chunkChars`.
 * @param out - accumulator.
 * @param heading - heading context.
 * @param text - section text.
 * @param chunkChars - target chunk size in characters.
 * @param overlapChars - overlap between adjacent chunks of oversize text.
 */
function pushSection(out: Chunk[], heading: string | undefined, text: string, chunkChars: number, overlapChars: number): void {
  if (text.length <= chunkChars) {
    out.push(heading === undefined ? { text } : { heading, text })
    return
  }
  pushOversized(out, heading, text, chunkChars, overlapChars)
}

/**
 * Chunk markdown by headings and paragraphs, keeping each chunk near the target.
 * @param content - document text.
 * @param chunkChars - target chunk size in characters.
 * @param overlapChars - overlap used only when one block exceeds the target.
 * @returns chunks in document order.
 */
export function chunkMarkdown(content: string, chunkChars: number, overlapChars: number): Chunk[] {
  const blocks = content.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(block => block.trim()).filter(block => block !== '')
  const out: Chunk[] = []
  let heading: string | undefined
  let text = ''
  const emit = (): void => {
    if (text !== '') pushSection(out, heading, text, chunkChars, overlapChars)
    text = ''
  }
  for (const block of blocks) {
    const match = HEADING.exec(block)
    if (match !== null) {
      emit()
      heading = (match[2] ?? '').trim()
      continue
    }
    if (text === '') text = block
    else if (text.length + block.length + 2 <= chunkChars) text += `\n\n${block}`
    else {
      emit()
      text = block
    }
  }
  emit()
  return out
}
