/**
 * LaTeX for the lecture pipeline: the master document that `\input`s every
 * lecture of a course, the prompt that turns a transcribed lecture into a
 * LaTeX section, and cleanup of the model's reply.
 */

/** Line opening the block of `\input` lines the pipeline owns; a template marks where lectures go with it. */
export const LECTURES_MARKER = '%% tteoki:lectures'

/** Line closing the block of `\input` lines the pipeline owns. */
export const LECTURES_END = '%% tteoki:lectures:end'

/** Values substituted for `{{course}}`, `{{name}}`, `{{quarter}}`, `{{author}}`, and `{{instructor}}`. */
export interface MasterFields {
  readonly course: string
  /** Course title; the code when the course has none. */
  readonly name: string
  readonly quarter: string
  readonly author: string
  readonly instructor: string
}

/** Built-in master document; {@link MasterFields} placeholders are substituted. */
export const DEFAULT_TEMPLATE = String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb,amsthm,mathtools,bm}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{proposition}[theorem]{Proposition}
\newtheorem{corollary}[theorem]{Corollary}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\newtheorem{example}[theorem]{Example}
\theoremstyle{remark}
\newtheorem{remark}[theorem]{Remark}
\title{{{course}}: {{name}}\\[4pt]\large {{quarter}} Lecture Notes}
\author{{{author}}}
\date{}
\begin{document}
\maketitle
\tableofcontents
\newpage
%% tteoki:lectures
%% tteoki:lectures:end
\end{document}
`

/**
 * Escape text for use in LaTeX outside math.
 * @param text - plain text.
 * @returns the text with LaTeX special characters escaped.
 */
export function escapeLatex(text: string): string {
  return text.replace(/[\\{}$&#%_^~]/g, character => {
    switch (character) {
      case '\\': return String.raw`\textbackslash{}`
      case '^': return String.raw`\textasciicircum{}`
      case '~': return String.raw`\textasciitilde{}`
      default: return `\\${character}`
    }
  })
}

/**
 * Make a string safe as a LaTeX file name (no spaces, which `\input` mishandles).
 * @param text - raw name.
 * @returns lower-case words joined by `-`.
 */
export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'lecture'
}

/**
 * Substitute {@link MasterFields} placeholders, LaTeX-escaped.
 * @param text - template or pattern text.
 * @param fields - values.
 * @param escape - whether to escape values for LaTeX.
 * @returns the text with placeholders replaced.
 */
export function fillFields(text: string, fields: MasterFields, escape = true): string {
  return text.replace(/\{\{(course|name|quarter|author|instructor)\}\}/g, (_match, key: keyof MasterFields) => escape ? escapeLatex(fields[key]) : fields[key])
}

/**
 * The owned block of `\input` lines.
 * @param inputs - lecture file paths relative to the master document, in lecture order.
 * @returns the block, markers included.
 */
function lectureBlock(inputs: readonly string[]): string {
  return [LECTURES_MARKER, ...inputs.map(input => `\\input{${input.replace(/\.tex$/, '')}}`), LECTURES_END].join('\n')
}

/**
 * Render a new master document from a template.
 * @param template - the template text; it must contain {@link LECTURES_MARKER} on its own line.
 * @param fields - placeholder values.
 * @param inputs - lecture file paths relative to the master document, in lecture order.
 * @returns the master document.
 * @throws Error when the template has no marker line.
 */
export function renderMaster(template: string, fields: MasterFields, inputs: readonly string[]): string {
  const lines = fillFields(template, fields).split('\n')
  const index = lines.findIndex(line => line.trim() === LECTURES_MARKER)
  if (index < 0) throw new Error(`the LaTeX template needs a line "${LECTURES_MARKER}" where lectures go`)
  const end = lines.findIndex((line, position) => position > index && line.trim() === LECTURES_END)
  lines.splice(index, end < 0 ? 1 : end - index + 1, lectureBlock(inputs))
  return lines.join('\n')
}

/**
 * Replace the owned block of an existing master document, leaving the rest as the user edited it.
 * @param master - the current master document.
 * @param inputs - lecture file paths relative to the master document, in lecture order.
 * @returns the updated document.
 * @throws Error when the document lacks either marker line.
 */
export function updateMaster(master: string, inputs: readonly string[]): string {
  const lines = master.split('\n')
  const start = lines.findIndex(line => line.trim() === LECTURES_MARKER)
  const end = lines.findIndex((line, position) => position > start && line.trim() === LECTURES_END)
  if (start < 0 || end < 0) throw new Error(`the master notes need the lines "${LECTURES_MARKER}" and "${LECTURES_END}" around the lecture inputs`)
  lines.splice(start, end - start + 1, lectureBlock(inputs))
  return lines.join('\n')
}

/**
 * The preamble of a template: everything before `\begin{document}`.
 * @param template - template text.
 * @returns the preamble.
 */
export function preambleOf(template: string): string {
  const index = template.indexOf(String.raw`\begin{document}`)
  return index < 0 ? template : template.slice(0, index)
}

/**
 * System prompt converting one transcribed lecture into a LaTeX section body.
 * @param preamble - the master document preamble, naming the available packages and environments.
 * @returns the prompt.
 */
export function latexPrompt(preamble: string): string {
  return [
    'You turn a transcript of handwritten lecture notes into clean LaTeX for a course notes document.',
    'The transcript is Markdown with $…$ math, transcribed page by page; it may contain transcription slips, crossed-out work, and page markers.',
    'Write the body of one lecture: start with \\subsection headings (never \\section, \\chapter, \\documentclass, \\usepackage, or \\begin{document}).',
    'Keep every definition, theorem, proof, example, derivation, and remark from the notes, in order. Do not add material that is not in the notes; fix obvious transcription slips only.',
    'Use the macros, theorem-like environments, and boxes declared in this preamble where they fit (for example a note or intuition box for side remarks), and no other packages or custom commands:',
    '```latex',
    preamble.trim(),
    '```',
    'Use \\[ … \\] for a single displayed equation and align* for multi-line derivations; number an equation only when the notes refer back to it. Use itemize/enumerate for lists. Reply with the LaTeX only.',
  ].join('\n')
}

/**
 * Clean the model's LaTeX reply.
 * @param reply - raw reply.
 * @returns the body without code fences or document-level commands.
 */
export function cleanLatexReply(reply: string): string {
  return reply
    .replace(/^\s*```(?:latex|tex)?\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .split('\n')
    .filter(line => !/^\s*\\(documentclass|usepackage|begin\{document\}|end\{document\}|maketitle|title\{|author\{|date\{)/.test(line))
    .join('\n')
    .trim()
}

/**
 * Wrap a lecture body in its section heading.
 * @param title - lecture title, such as `Lec 3`.
 * @param date - lecture day, `YYYY-MM-DD`.
 * @param body - the LaTeX body.
 * @returns the lecture file content.
 */
export function lectureFile(title: string, date: string, body: string): string {
  const heading = escapeLatex(title)
  return `% Generated by Tteoki from the Notability note "${title.replace(/\n/g, ' ')}"; edits are overwritten when the note changes.\n\\section[${heading} (${date})]{${heading} \\hfill{\\normalsize\\normalfont ${date}}}\n\n${body.trim()}\n`
}

/**
 * Pick the error lines out of a LaTeX log.
 * @param log - latexmk or pdflatex output.
 * @returns up to 20 lines starting at the first error.
 */
export function latexErrors(log: string): string {
  const lines = log.split('\n')
  const first = lines.findIndex(line => line.startsWith('!') || /:\d+: /.test(line))
  return (first < 0 ? lines.slice(-20) : lines.slice(first, first + 20)).join('\n').trim()
}
