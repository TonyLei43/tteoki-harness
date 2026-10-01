/** End-of-lecture quizzes: the prompt, reply parsing, and the vault note. */

import type { Quiz, QuizKind, QuizQuestion } from './types.ts'

const KINDS: readonly QuizKind[] = ['proof', 'concept', 'computation', 'definition']

/** System prompt asking for a quiz on one lecture. */
export const QUIZ_PROMPT = [
  'You write a short end-of-lecture quiz for a graduate statistics student from their own lecture notes.',
  'Test the most important parts of the lecture only: 4 to 6 questions.',
  'Include at least one "proof" question asking the student to reproduce a proof or derivation from the lecture, when the lecture has one;',
  '"concept" questions about why a result holds, when an assumption matters, or how ideas relate; and "computation" or "definition" questions where the lecture supports them.',
  'Each answer is complete and follows the lecture: a full proof for proof questions.',
  'Use Markdown with $…$ and $$…$$ math. Reply with JSON only: {"questions":[{"kind":"proof|concept|computation|definition","prompt":"…","answer":"…"}]}',
].join('\n')

/**
 * Parse the model's quiz reply.
 * @param reply - raw reply, possibly fenced.
 * @returns the questions.
 * @throws Error when the reply has no valid questions.
 */
export function parseQuiz(reply: string): QuizQuestion[] {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('the quiz reply is not JSON')
  const value = JSON.parse(reply.slice(start, end + 1)) as { questions?: unknown }
  if (!Array.isArray(value.questions)) throw new Error('the quiz reply has no questions')
  const entries: readonly unknown[] = value.questions
  const questions: QuizQuestion[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const { kind, prompt, answer } = entry as Record<string, unknown>
    if (typeof prompt !== 'string' || typeof answer !== 'string' || prompt.trim() === '') continue
    questions.push({ kind: KINDS.find(known => known === kind) ?? 'concept', prompt: prompt.trim(), answer: answer.trim() })
  }
  if (questions.length === 0) throw new Error('the quiz reply has no valid questions')
  return questions
}

/**
 * Render a quiz as an Obsidian note with folded answers.
 * @param quiz - the quiz.
 * @param noteLink - vault-relative link target of the lecture note.
 * @returns the note text.
 */
export function quizMarkdown(quiz: Omit<Quiz, 'quizPath'>, noteLink: string): string {
  const quote = (text: string): string => text.split('\n').map(line => `> ${line}`.trimEnd()).join('\n')
  return [
    '---',
    `course: "${quiz.course}"`,
    `lecture: "[[${noteLink}]]"`,
    `date: ${quiz.date}`,
    'type: quiz',
    '---',
    '',
    `# Quiz: ${quiz.courseLabel} — ${quiz.title}`,
    '',
    ...quiz.questions.flatMap((question, index) => [
      `> [!question] ${index + 1}. ${question.kind[0]?.toUpperCase() ?? ''}${question.kind.slice(1)}`,
      quote(question.prompt),
      '',
      '> [!success]- Answer',
      quote(question.answer),
      '',
    ]),
  ].join('\n')
}
