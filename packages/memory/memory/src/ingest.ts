/**
 * Ingestion pipeline: the extractor protocol, the built-in text, Markdown, and
 * LaTeX extractors, and the source walker that pairs each document with the
 * extractor that claims its suffix.
 */

import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Turns one source document into indexable Markdown text. A file extractor
 * claims file suffixes; a bundle extractor claims directory suffixes (such as a
 * Notability `.nbn` package) and reads the whole directory as one document.
 */
export interface Extractor {
  /** Stable id, part of every document fingerprint this extractor produces. */
  readonly id: string
  /** Output revision; bump it when the produced text changes so stored documents re-index. */
  readonly version: number
  /** Lower-case file suffixes this extractor reads, such as `.pdf`. */
  readonly files: readonly string[]
  /** Lower-case directory suffixes read as one document, such as `.nbn`. */
  readonly bundles: readonly string[]
  /**
   * Cheap change detector; the walker hashes the file bytes when absent. A
   * bundle extractor must provide one because a directory has no bytes.
   * @param path - absolute document path.
   * @returns a string that changes whenever the extracted text may change.
   */
  readonly fingerprint?: (path: string) => Promise<string>
  /**
   * Extract the document text.
   * @param path - absolute document path.
   * @param signal - caller cancellation.
   * @returns Markdown text; headings become chunk context.
   * @throws Error when the document has no extractable text or cannot be read.
   */
  readonly extract: (path: string, signal: AbortSignal) => Promise<string>
  /**
   * Render one page of the document as a PNG, for previews. Extractors whose
   * documents have no pages omit it.
   * @param path - absolute document path.
   * @param page - 1-based page number.
   * @param signal - caller cancellation.
   * @returns PNG bytes.
   * @throws Error when the page does not exist.
   */
  readonly renderPage?: (path: string, page: number, signal: AbortSignal) => Promise<Uint8Array>
}

/** One document found under a source, with the extractor that claims it. */
export interface SourceDocument {
  /** Absolute path of the file or bundle directory. */
  readonly path: string
  /** Extractor that claims the path's suffix. */
  readonly extractor: Extractor
}

/** Directory names skipped by default: dependency trees and build output. */
export const DEFAULT_EXCLUDE_DIRS: readonly string[] = ['node_modules', 'site-packages', 'venv', 'env', '__pycache__', 'build', 'dist', 'target']

/**
 * Hash the bytes of one file.
 * @param path - absolute file path.
 * @returns the hex SHA-256 of the file bytes.
 */
export async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

/**
 * Suffix-indexed view over the registered extractors.
 */
export class ExtractorTable {
  private readonly files = new Map<string, Extractor>()
  private readonly bundles = new Map<string, Extractor>()

  /**
   * Register one extractor for its suffixes.
   * @param extractor - extractor to add.
   * @returns the disposer that removes it.
   * @throws Error when another extractor already claims one of its suffixes.
   */
  register(extractor: Extractor): () => void {
    for (const [table, suffixes] of [[this.files, extractor.files], [this.bundles, extractor.bundles]] as const) {
      for (const suffix of suffixes) {
        const owner = table.get(suffix)
        if (owner !== undefined) throw new Error(`memory extractor "${extractor.id}" claims ${suffix}, already claimed by "${owner.id}"`)
      }
    }
    for (const suffix of extractor.files) this.files.set(suffix, extractor)
    for (const suffix of extractor.bundles) this.bundles.set(suffix, extractor)
    return () => {
      for (const suffix of extractor.files) if (this.files.get(suffix) === extractor) this.files.delete(suffix)
      for (const suffix of extractor.bundles) if (this.bundles.get(suffix) === extractor) this.bundles.delete(suffix)
    }
  }

  /**
   * Recursively collect the documents under one root that some extractor claims.
   * Hidden entries (a leading dot, which covers `.obsidian`, `.git`, and `.venv`)
   * and directories named in `excludeDirs` are skipped.
   * @param root - absolute directory to scan.
   * @param excludeDirs - directory names to skip, compared case-insensitively.
   * @returns claimed documents in discovery order; a missing root yields none.
   */
  async collect(root: string, excludeDirs: readonly string[]): Promise<SourceDocument[]> {
    const excluded = new Set(excludeDirs.map(name => name.toLowerCase()))
    const out: SourceDocument[] = []
    const walk = async (directory: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch {
        // A missing or unreadable source directory contributes nothing.
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const path = join(directory, entry.name)
        const name = entry.name.toLowerCase()
        if (entry.isDirectory()) {
          const bundle = this.claim(this.bundles, name)
          if (bundle !== undefined) out.push({ path, extractor: bundle })
          else if (!excluded.has(name)) await walk(path)
        } else if (entry.isFile()) {
          const extractor = this.claim(this.files, name)
          if (extractor !== undefined) out.push({ path, extractor })
        }
      }
    }
    await walk(root)
    return out
  }

  /**
   * Find the extractor for one path by its file or directory suffix.
   * @param path - a file or bundle directory path.
   * @param directory - whether the path is a directory.
   * @returns the claiming extractor, or undefined.
   */
  claimPath(path: string, directory: boolean): Extractor | undefined {
    const name = path.split('/').pop()?.toLowerCase() ?? ''
    return this.claim(directory ? this.bundles : this.files, name)
  }

  private claim(table: ReadonlyMap<string, Extractor>, name: string): Extractor | undefined {
    for (const [suffix, extractor] of table) if (name.endsWith(suffix)) return extractor
    return undefined
  }
}

/** A leading YAML front-matter block. */
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

/**
 * Normalize Obsidian-flavored Markdown for embedding: drop front matter and
 * `%%comments%%`, and replace `[[target|alias]]` links and `![[embeds]]` by
 * their visible text.
 * @param content - raw Markdown.
 * @returns cleaned Markdown.
 */
export function cleanMarkdown(content: string): string {
  return content
    .replace(FRONT_MATTER, '')
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/!?\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g, (_match, target: string, section: string | undefined, alias: string | undefined) =>
      alias ?? (section === undefined || section === '' ? target : `${target} ${section}`))
}

/** LaTeX sectioning commands mapped to Markdown heading depth. */
const LATEX_HEADINGS: Readonly<Record<string, string>> = { part: '#', chapter: '#', section: '#', subsection: '##', subsubsection: '###', paragraph: '####' }

/**
 * Convert LaTeX source to heading-aware text: keep the document body, drop
 * comments and labels, and turn sectioning commands into Markdown headings so
 * chunks carry their section as context. Math and other commands stay verbatim.
 * @param content - raw LaTeX.
 * @returns Markdown-like text.
 */
export function cleanLatex(content: string): string {
  const uncommented = content.split(/\r?\n/).map(line => line.replace(/(?<!\\)%.*$/, '')).join('\n')
  const begin = uncommented.indexOf('\\begin{document}')
  const end = uncommented.lastIndexOf('\\end{document}')
  const body = begin === -1 ? uncommented : uncommented.slice(begin + '\\begin{document}'.length, end === -1 ? undefined : end)
  return body
    .replace(/\\label\{[^}]*\}/g, '')
    .replace(/^[ \t]*\\(part|chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{([^}]*)\}[ \t]*$/gm, (_match, command: string, title: string) =>
      `\n\n${LATEX_HEADINGS[command] ?? '#'} ${title.trim()}\n\n`)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Read a UTF-8 file.
 * @param path - absolute file path.
 * @returns the file text.
 */
async function readText(path: string): Promise<string> {
  return await readFile(path, 'utf8')
}

/** Built-in extractors shipped with the memory service. */
export const BUILTIN_EXTRACTORS: readonly Extractor[] = [
  { id: 'markdown', version: 1, files: ['.md', '.markdown'], bundles: [], extract: async path => cleanMarkdown(await readText(path)) },
  { id: 'text', version: 1, files: ['.txt', '.bib'], bundles: [], extract: readText },
  { id: 'latex', version: 1, files: ['.tex', '.ltx'], bundles: [], extract: async path => cleanLatex(await readText(path)) },
]
