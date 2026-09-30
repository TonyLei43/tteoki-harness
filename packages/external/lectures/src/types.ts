/** Wire vocabulary for the `lectures` Remote namespace: pipeline settings, lecture status, and quizzes. */

/** A hosted OpenAI-compatible chat endpoint; the key is read from the named credential. */
export interface WriterEndpoint {
  readonly baseUrl: string
  readonly model: string
  /** Credential (environment-variable) name holding the API key, such as `OPENAI_API_KEY`. */
  readonly apiKeyEnv: string
}

/** Lecture pipeline settings. */
export interface LectureSettings {
  /** Whether the watcher runs. */
  readonly enabled: boolean
  /** Notability's iCloud `Documents` folder holding `.nbn` packages. */
  readonly notabilityDir: string
  /** Vault folder receiving `<school>/<course>/…`, such as the vault's `Academic` folder. */
  readonly vaultDir: string
  /** School folder under `vaultDir`, such as `UW`. */
  readonly school: string
  /** Quarter name used in the master document title, such as `Autumn 2026`. */
  readonly quarter: string
  /** First day of the quarter, `YYYY-MM-DD`; notes created earlier are ignored. */
  readonly since: string
  /** Course codes to follow, such as `STAT 536/427`; empty follows every course in the connectors settings. */
  readonly courses: readonly string[]
  /** Seconds between scans of `notabilityDir`. */
  readonly pollSeconds: number
  /** Minutes without edits before a lecture is transcribed. */
  readonly settleMinutes: number
  /** Minutes without edits before a transcribed lecture gets its quiz. */
  readonly quizAfterMinutes: number
  /** Minutes around a calendar event of a followed course within which an untitled note belongs to that course. */
  readonly calendarSlackMinutes: number
  /** Endpoint writing LaTeX and quizzes; the local memory chat model when absent. */
  readonly writer?: WriterEndpoint
  /** LaTeX template for each course's master document; the built-in article preamble when absent. */
  readonly template?: string
  /**
   * Folder holding each course's master notes and its `lectures/` files; `{{course}}`, `{{name}}`, and
   * `{{quarter}}` are substituted. Empty uses `LaTeX` inside the course's vault folder.
   */
  readonly texDir: string
  /** Master notes file name without `.tex`, with the same placeholders, such as `{{course}} - {{name}}`. */
  readonly masterName: string
  /** Notes author, the template's `{{author}}`. */
  readonly author: string
  /** Instructor per course code, the template's `{{instructor}}`. */
  readonly instructors: Readonly<Record<string, string>>
  /** `latexmk` executable; compiling is off when empty. */
  readonly latexmk: string
  /** Knowledge base re-indexed after a lecture is exported; none when absent. */
  readonly knowledgeBase?: string
}

/** Partial settings update; `writer`, `template`, or `knowledgeBase` set to `null` clears it. */
export type LectureSettingsUpdate = { readonly [K in keyof LectureSettings]?: LectureSettings[K] | (K extends 'writer' | 'template' | 'knowledgeBase' ? null : never) }

/** Where one lecture is in the pipeline. */
export type LectureStage = 'waiting' | 'transcribing' | 'ready' | 'quizzing' | 'quizzed' | 'failed'

/** One followed lecture note. */
export interface Lecture {
  /** Notability note id. */
  readonly id: string
  /** Absolute `.nbn` package path. */
  readonly bundle: string
  readonly title: string
  /** Followed course code, such as `STAT 536/427`. */
  readonly course: string
  /** Note creation time, ISO 8601. */
  readonly created: string
  readonly stage: LectureStage
  /** Last observed edit, epoch milliseconds. */
  readonly changedAt: number
  /** Exported vault note. */
  readonly notePath?: string
  /** Lecture LaTeX file. */
  readonly texPath?: string
  /** Master notes PDF, when the last compile succeeded. */
  readonly pdfPath?: string
  /** Quiz id, once generated. */
  readonly quizId?: string
  /** Last failure of transcription, LaTeX, compile, or quiz. */
  readonly error?: string
}

/** One followed course's master notes. */
export interface CourseNotes {
  /** Course code, such as `STAT 581`. */
  readonly course: string
  readonly name: string
  /** Master notes `.tex` file. */
  readonly master: string
  /** Compiled PDF, when it exists. */
  readonly pdf?: string
  /** Lectures included. */
  readonly lectures: number
  /** Last failure creating or compiling the master notes. */
  readonly error?: string
}

/** Pipeline status. */
export interface LecturesStatus {
  readonly enabled: boolean
  /** Last completed scan, epoch milliseconds. */
  readonly scannedAt?: number
  /** Scan failure, such as an unreadable Notability folder. */
  readonly error?: string
  /** Followed lectures, newest first. */
  readonly lectures: readonly Lecture[]
  /** Master notes of every configured course. */
  readonly courses: readonly CourseNotes[]
}

/** What a quiz question asks for. */
export type QuizKind = 'proof' | 'concept' | 'computation' | 'definition'

/** One quiz question with its model answer. */
export interface QuizQuestion {
  readonly kind: QuizKind
  /** The question, Markdown with `$…$` math. */
  readonly prompt: string
  /** A complete answer, Markdown with `$…$` math. */
  readonly answer: string
}

/** The end-of-lecture quiz for one lecture. */
export interface Quiz {
  /** Equals the lecture id. */
  readonly id: string
  readonly course: string
  /** Course display label, such as `STAT 536/427: Analysis of Categorical and Count Data`. */
  readonly courseLabel: string
  readonly title: string
  /** Lecture day, `YYYY-MM-DD`. */
  readonly date: string
  /** Generation time, epoch milliseconds. */
  readonly createdAt: number
  /** Vault note of the lecture. */
  readonly notePath: string
  /** Vault note of the quiz. */
  readonly quizPath: string
  readonly questions: readonly QuizQuestion[]
}

/** Lists recent quizzes. */
export interface QuizListRequest {
  /** Most recent first; defaults to 10. */
  readonly limit?: number
}

/** Names one lecture. */
export interface LectureRef {
  readonly id: string
}
