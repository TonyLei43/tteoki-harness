/** English copy for the lecture quiz widget. */

/** Locale keys the widget renders. */
export type LecturesLocaleKey =
  | 'widget' | 'off' | 'noQuiz' | 'loadFailed'
  | 'stage.waiting' | 'stage.transcribing' | 'stage.ready' | 'stage.quizzing' | 'stage.quizzed' | 'stage.failed'
  | 'kind.proof' | 'kind.concept' | 'kind.computation' | 'kind.definition'
  | 'showAnswer' | 'hideAnswer' | 'quizMe' | 'starting' | 'quizNow' | 'working' | 'older' | 'newer' | 'masterNotes' | 'lectureCount' | 'study' | 'noLectures' | 'latestQuiz' | 'questionCount' | 'studyPlan'
  | 'copy' | 'copied' | 'codeBlock' | 'wrap' | 'unwrap' | 'footnotes'

/** English copy. */
export const en: Record<LecturesLocaleKey, string> = {
  widget: 'Lecture quiz',
  off: 'The lecture pipeline is off. Turn it on in ~/.dsh/lectures/config.json.',
  noQuiz: 'No quiz yet. After class, your notes are transcribed and a quiz appears here.',
  loadFailed: 'Could not load lectures.',
  'stage.waiting': 'Waiting for edits to stop',
  'stage.transcribing': 'Transcribing',
  'stage.ready': 'Transcribed',
  'stage.quizzing': 'Writing the quiz',
  'stage.quizzed': 'Quiz ready',
  'stage.failed': 'Failed',
  'kind.proof': 'Proof',
  'kind.concept': 'Concept',
  'kind.computation': 'Computation',
  'kind.definition': 'Definition',
  showAnswer: 'Show answer',
  hideAnswer: 'Hide answer',
  quizMe: 'Quiz me',
  starting: 'Starting…',
  quizNow: 'Make quiz now',
  working: 'Working…',
  older: 'Older',
  newer: 'Newer',
  masterNotes: 'Master notes',
  lectureCount: '{count} lectures',
  study: 'Study',
  noLectures: 'No lectures transcribed for this class yet. Notes you take in Notability appear here after class.',
  latestQuiz: 'Latest quiz',
  questionCount: '{count} questions',
  studyPlan: 'Plan what to study →',
  copy: 'Copy',
  copied: 'Copied',
  codeBlock: 'Code',
  wrap: 'Wrap',
  unwrap: 'Unwrap',
  footnotes: 'Footnotes',
}
