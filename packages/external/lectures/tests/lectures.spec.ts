/** Lecture pipeline: course matching, LaTeX rendering, quiz parsing, and the watcher service. */

import { Context } from '@deepseek-ai/cordis'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  cleanLatexReply, courseCodes, DEFAULT_TEMPLATE, escapeLatex, fillFields, latexErrors, Lectures, LECTURES_END, LECTURES_MARKER, matchCourse, parseQuiz, quizMarkdown, renderMaster, slug, updateMaster, validateSettings,
} from '../src/index.ts'
import type { LectureSettings } from '../src/index.ts'

const FIXTURE = join(import.meta.dirname, '../../../memory/memory-notability/tests/fixtures/Lec 1.nbn')

const courses = [
  { code: 'STAT 536/427', codes: ['STAT 536', 'STAT 427'], name: 'Analysis of Categorical and Count Data', configured: true },
  { code: 'BIOST 583', codes: ['BIOST 583'], name: 'Advanced Theory of Statistical Inference I', configured: true },
]

describe('course matching', () => {
  it('splits cross-listed codes', () => {
    expect(courseCodes('STAT 536/427')).toEqual(['STAT 536', 'STAT 427'])
    expect(courseCodes('BIOST 583')).toEqual(['BIOST 583'])
  })

  it('matches by title, then subject, then a class on the calendar', () => {
    const created = new Date('2026-09-30T17:40:00Z')
    expect(matchCourse({ title: 'STAT 427 Lec 3', subject: '', created }, courses, [], 0)).toEqual({ course: courses[0], title: 'Lec 3' })
    expect(matchCourse({ title: 'Poisson GLMs', subject: 'BIOST 583 notes', created }, courses, [], 0)).toEqual({ course: courses[1], title: 'Poisson GLMs' })
    const events = [{ title: 'Office hour', courseCode: 'BIOST 583', start: '2026-09-30T17:30:00Z', end: '2026-09-30T18:20:00Z' }]
    expect(matchCourse({ title: 'Note Sep 30, 2026', subject: 'unsortedNotesKey', created }, courses, events, 0)?.course.code).toBe('BIOST 583')
    expect(matchCourse({ title: 'Note Sep 30, 2026', subject: '', created: new Date('2026-09-30T18:30:00Z') }, courses, events, 0)).toBeUndefined()
    expect(matchCourse({ title: 'Note Sep 30, 2026', subject: '', created: new Date('2026-09-30T18:30:00Z') }, courses, events, 15 * 60_000)?.course.code).toBe('BIOST 583')
    expect(matchCourse({ title: 'STAT 538 Lec 1', subject: '', created }, courses, [], 0)).toBeUndefined()
    const titled = [{ title: 'STAT 427 B', start: '2026-09-30T21:30:00Z', end: '2026-09-30T22:20:00Z' }]
    expect(matchCourse({ title: 'Note Sep 30, 2026', subject: '', created: new Date('2026-09-30T21:35:00Z') }, courses, titled, 0)?.course.code).toBe('STAT 536/427')
  })
})

describe('LaTeX', () => {
  const fields = { course: 'STAT 536', name: 'Count Data & GLMs', quarter: 'Autumn 2026', author: 'Tony Lei', instructor: '' }

  it('renders the master document with one input per lecture', () => {
    const master = renderMaster(DEFAULT_TEMPLATE, fields, ['lectures/2026-09-24-lec-1.tex', 'lectures/2026-09-26-lec-2.tex'])
    expect(master).toContain(String.raw`\title{STAT 536: Count Data \& GLMs\\[4pt]\large Autumn 2026 Lecture Notes}`)
    expect(master).toContain(String.raw`\author{Tony Lei}`)
    expect(master).toContain(`${LECTURES_MARKER}\n\\input{lectures/2026-09-24-lec-1}\n\\input{lectures/2026-09-26-lec-2}\n${LECTURES_END}\n\\end{document}`)
    expect(renderMaster(`a\n${LECTURES_MARKER}\nb`, fields, [])).toBe(`a\n${LECTURES_MARKER}\n${LECTURES_END}\nb`)
    expect(() => renderMaster('\\begin{document}\\end{document}', fields, [])).toThrow(LECTURES_MARKER)
  })

  it('updates only the lecture block of existing master notes', () => {
    const edited = `preamble\n\\section{My summary}\n${LECTURES_MARKER}\n\\input{lectures/old}\n${LECTURES_END}\n\\section{Exam prep}\n\\end{document}`
    expect(updateMaster(edited, ['lectures/a.tex', 'lectures/b.tex'])).toBe(`preamble\n\\section{My summary}\n${LECTURES_MARKER}\n\\input{lectures/a}\n\\input{lectures/b}\n${LECTURES_END}\n\\section{Exam prep}\n\\end{document}`)
    expect(() => updateMaster(`${LECTURES_MARKER}\n\\end{document}`, [])).toThrow(LECTURES_END)
  })

  it('fills template fields, escaped or raw', () => {
    expect(fillFields('{{course}} - {{name}} ({{quarter}}, {{instructor}})', fields)).toBe('STAT 536 - Count Data \\& GLMs (Autumn 2026, )')
    expect(fillFields('{{name}}', fields, false)).toBe('Count Data & GLMs')
  })

  it('escapes text, makes file names, and cleans model replies', () => {
    expect(escapeLatex('50% of a_b & {c} ~ ^ \\')).toBe(String.raw`50\% of a\_b \& \{c\} \textasciitilde{} \textasciicircum{} \textbackslash{}`)
    expect(slug('Lec 3: MLE & Fisher')).toBe('lec-3-mle-fisher')
    expect(cleanLatexReply('```latex\n\\documentclass{article}\n\\usepackage{x}\n\\subsection{A}\nText\n```')).toBe('\\subsection{A}\nText')
    expect(latexErrors('noise\n./lectures/a.tex:4: Undefined control sequence.\nl.4 \\foo\nmore')).toBe('./lectures/a.tex:4: Undefined control sequence.\nl.4 \\foo\nmore')
  })
})

describe('quizzes', () => {
  it('parses fenced JSON and drops invalid questions', () => {
    const reply = '```json\n{"questions":[{"kind":"proof","prompt":"Prove it.","answer":"Because."},{"kind":"odd","prompt":"Why?","answer":"So."},{"prompt":3}]}\n```'
    expect(parseQuiz(reply)).toEqual([{ kind: 'proof', prompt: 'Prove it.', answer: 'Because.' }, { kind: 'concept', prompt: 'Why?', answer: 'So.' }])
    expect(() => parseQuiz('no json')).toThrow('not JSON')
    expect(() => parseQuiz('{"questions":[]}')).toThrow('no valid questions')
  })

  it('renders an Obsidian note with folded answers', () => {
    const text = quizMarkdown({ id: 'x', course: 'STAT 536/427', courseLabel: 'STAT 536/427: Count Data', title: 'Lec 3', date: '2026-09-30', createdAt: 0, notePath: '/v/n.md', questions: [{ kind: 'proof', prompt: 'Show $a$.', answer: 'Line 1\nLine 2' }] }, 'UW/STAT 536/2026-09-30 Lec 3')
    expect(text).toContain('lecture: "[[UW/STAT 536/2026-09-30 Lec 3]]"')
    expect(text).toContain('> [!question] 1. Proof\n> Show $a$.\n\n> [!success]- Answer\n> Line 1\n> Line 2')
  })
})

describe('settings', () => {
  const base: LectureSettings = {
    enabled: false, notabilityDir: '', vaultDir: '', school: 'UW', quarter: '', since: '', courses: [], pollSeconds: 60, settleMinutes: 3, quizAfterMinutes: 15, calendarSlackMinutes: 15, texDir: '', masterName: '{{course}} - {{name}}', author: '', instructors: {}, latexmk: 'latexmk',
  }

  it('requires folders and the quarter before the pipeline turns on', () => {
    expect(() => validateSettings({ ...base, enabled: true })).toThrow('notabilityDir is required')
    expect(() => validateSettings({ ...base, pollSeconds: 1 })).toThrow('pollSeconds must be an integer from 10 to 3600')
    expect(() => validateSettings({ ...base, since: '9/24' })).toThrow('since must be a date')
    expect(() => validateSettings({ ...base, courses: ['stats'] })).toThrow('course code "STATS"')
    expect(() => validateSettings({ ...base, masterName: 'a/b' })).toThrow('masterName must be one file name')
    expect(validateSettings({ ...base, instructors: { ' stat  581 ': ' Chen ' } }).instructors).toEqual({ 'STAT 581': 'Chen' })
    expect(() => validateSettings({ ...base, writer: { baseUrl: 'https://api.openai.com/v1', model: 'm', apiKeyEnv: 'lower' } })).toThrow('writer.apiKeyEnv')
    expect(validateSettings({ ...base, courses: [' stat  536/427 '], template: ' ', knowledgeBase: '' })).toEqual({ ...base, courses: ['STAT 536/427'] })
  })
})

describe('Lectures service', () => {
  function bench() {
    const root = mkdtempSync(join(tmpdir(), 'dsh-lectures-'))
    onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
    const notability = join(root, 'Notability')
    mkdirSync(notability)
    cpSync(FIXTURE, join(notability, 'Lec 1.nbn'), { recursive: true })
    cpSync(join(FIXTURE, '..', 'Blank.nbn'), join(notability, 'Blank.nbn'), { recursive: true })
    // Fails once naming the lecture file, then writes the PDF.
    const latexmk = join(root, 'latexmk')
    writeFileSync(latexmk, [
      '#!/bin/sh',
      'name=$(basename "$6" .tex)',
      'if grep -q badmacro lectures/*.tex 2>/dev/null; then echo "./lectures/2026-02-02-lec-1.tex:3: Undefined control sequence."; exit 12; fi',
      'mkdir -p .build && echo pdf > ".build/$name.pdf"',
    ].join('\n'))
    chmodSync(latexmk, 0o755)
    const prompts: string[] = []
    const indexed: string[][] = []
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    ctx.provide('memory', {
      ocrEnabled: () => true,
      ocrConcurrency: () => 1,
      ocrImage: async () => 'page',
      index: async (request: { collections: string[] }) => { indexed.push(request.collections); return { failures: [] } },
      complete: async (messages: { role: string; content: string }[]) => {
        const system = messages[0]?.content ?? ''
        prompts.push(system)
        if (system.includes('quiz')) return '{"questions":[{"kind":"proof","prompt":"Show the MLE is consistent.","answer":"By the LLN."}]}'
        if (system.includes('fixing')) return '% Generated by Tteoki\n\\section{Lec 1}\n\\subsection{Fixed}'
        return '```latex\n\\subsection{Consistency}\n\\badmacro\n```'
      },
    } as never)
    const home = join(root, 'home')
    return { root, ctx, notability, latexmk, prompts, indexed, service: new Lectures(ctx, { home }), home, vault: join(root, 'vault'), signal: new AbortController().signal }
  }

  it('transcribes a settled lecture into the vault and LaTeX, repairs a compile error, and writes its quiz', async () => {
    const subject = bench()
    await subject.service.setSettings({
      enabled: true,
      notabilityDir: subject.notability,
      vaultDir: subject.vault,
      quarter: 'Winter 2026',
      since: '2026-01-05',
      courses: ['STAT 538'],
      settleMinutes: 0,
      quizAfterMinutes: 0,
      latexmk: subject.latexmk,
      knowledgeBase: 'academic',
    })
    const status = await subject.service.scan({}, subject.signal)
    expect(status.error).toBeUndefined()
    expect(status.lectures).toHaveLength(1)
    const lecture = status.lectures[0]!
    expect(lecture).toMatchObject({ id: 'F501223E-0000-0000-0000-000000000001', title: 'Lec 1', course: 'STAT 538', stage: 'quizzed', quizId: 'F501223E-0000-0000-0000-000000000001' })
    expect(lecture.error).toBeUndefined()
    const courseDir = join(subject.vault, 'UW', 'STAT 538')
    expect(readFileSync(join(courseDir, '2026-02-02 Lec 1.md'), 'utf8')).toContain('Fisher information')
    const texDir = join(courseDir, 'LaTeX')
    expect(readFileSync(join(texDir, 'STAT 538.tex'), 'utf8')).toContain('\\input{lectures/2026-02-02-lec-1}')
    expect(readFileSync(join(texDir, 'lectures', '2026-02-02-lec-1.tex'), 'utf8')).toContain('\\subsection{Fixed}')
    expect(lecture.pdfPath).toBe(join(texDir, 'STAT 538.pdf'))
    expect(status.courses).toEqual([{ course: 'STAT 538', name: '', master: join(texDir, 'STAT 538.tex'), pdf: join(texDir, 'STAT 538.pdf'), lectures: 1 }])
    expect(existsSync(lecture.pdfPath!)).toBe(true)
    expect(subject.indexed).toEqual([['academic']])
    const { quizzes } = await subject.service.quizzes({})
    expect(quizzes.map(quiz => [quiz.courseLabel, quiz.title, quiz.questions.length])).toEqual([['STAT 538', 'Lec 1', 1]])
    expect(readFileSync(quizzes[0]!.quizPath, 'utf8')).toContain('Show the MLE is consistent.')

    // An unchanged note is not transcribed or quizzed again.
    const calls = subject.prompts.length
    await subject.service.scan({}, subject.signal)
    expect(subject.prompts.length).toBe(calls)
  })

  it('waits for the note to settle and follows only the configured courses', async () => {
    const subject = bench()
    await subject.service.setSettings({ enabled: true, notabilityDir: subject.notability, vaultDir: subject.vault, quarter: 'Winter 2026', since: '2026-01-05', courses: ['STAT 538'], settleMinutes: 240, latexmk: '' })
    const waiting = await subject.service.scan({}, subject.signal)
    expect(waiting.lectures.map(entry => entry.stage)).toEqual(['waiting'])
    await expect(subject.service.process({ id: 'nope' }, subject.signal)).rejects.toThrow('unknown lecture "nope"')
    const quiz = await subject.service.process({ id: waiting.lectures[0]!.id }, subject.signal)
    expect(quiz.questions[0]?.kind).toBe('proof')

    await subject.service.setSettings({ courses: ['BIOST 583'] })
    const other = mkdtempSync(join(tmpdir(), 'dsh-lectures-other-'))
    onTestFinished(() => { rmSync(other, { recursive: true, force: true }) })
    await subject.service.setSettings({ notabilityDir: other })
    expect((await subject.service.scan({}, subject.signal)).lectures).toHaveLength(1)
    await subject.service.setSettings({ notabilityDir: join(other, 'missing') })
    expect((await subject.service.scan({}, subject.signal)).error).toContain('ENOENT')
  })

  it('follows courses found on the calendar when no course list is set', async () => {
    const subject = bench()
    const agenda = vi.fn(async () => ({ items: [{ title: 'STAT 538 A', start: '2026-02-02T16:30:00Z', end: '2026-02-02T17:20:00Z' }] }))
    subject.ctx.provide('connectors', { getSettings: async () => ({ courses: [] }), agenda } as never)
    await subject.service.setSettings({ enabled: true, notabilityDir: subject.notability, vaultDir: subject.vault, quarter: 'Winter 2026', since: '2026-01-05', settleMinutes: 240, latexmk: '' })
    expect((await subject.service.scan({}, subject.signal)).lectures.map(entry => [entry.course, entry.title])).toEqual([['STAT 538', 'Lec 1']])
    expect(agenda).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['event'] }))
  })

  it('creates master notes for every configured course and keeps edits outside the lecture block', async () => {
    const subject = bench()
    const courses = [
      { code: 'STAT 581', name: 'Advanced Theory of Statistical Inference I', aliases: ['BIOST 583'], folders: [] },
      { code: 'STAT 538', name: 'Asymptotics', folders: [] },
    ]
    subject.ctx.provide('connectors', { getSettings: async () => ({ courses }), agenda: async () => ({ items: [] }) } as never)
    const texDir = join(subject.root, 'UW - Graduate', '{{quarter}}', '{{course}}', 'Lecture Notes')
    await subject.service.setSettings({ enabled: true, notabilityDir: join(subject.root, 'none'), vaultDir: subject.vault, quarter: 'Winter 2026', since: '2026-01-05', settleMinutes: 240, latexmk: '', texDir, author: 'Tony Lei', instructors: { 'STAT 538': 'Wellner' } })
    const created = await subject.service.scan({}, subject.signal)
    const master = join(subject.root, 'UW - Graduate', 'Winter 2026', 'STAT 538', 'Lecture Notes', 'STAT 538 - Asymptotics.tex')
    expect(created.courses.map(course => [course.course, course.master, course.lectures])).toEqual([
      ['STAT 581', join(subject.root, 'UW - Graduate', 'Winter 2026', 'STAT 581', 'Lecture Notes', 'STAT 581 - Advanced Theory of Statistical Inference I.tex'), 0],
      ['STAT 538', master, 0],
    ])
    expect(created.error).toContain('ENOENT')
    expect(readFileSync(master, 'utf8')).toContain('\\title{STAT 538: Asymptotics')
    writeFileSync(master, readFileSync(master, 'utf8').replace(LECTURES_MARKER, `\\section{My overview}\n${LECTURES_MARKER}`))

    await subject.service.setSettings({ notabilityDir: subject.notability, settleMinutes: 0 })
    await subject.service.scan({}, subject.signal)
    const text = readFileSync(master, 'utf8')
    expect(text).toContain(`\\section{My overview}\n${LECTURES_MARKER}\n\\input{lectures/2026-02-02-lec-1}\n${LECTURES_END}`)
    expect((await subject.service.status()).courses[1]?.lectures).toBe(1)
  })

  it('reports a missing template marker on the lecture', async () => {
    const subject = bench()
    const template = join(subject.root, 'template.tex')
    writeFileSync(template, '\\documentclass{article}\\begin{document}\\end{document}')
    await subject.service.setSettings({ enabled: true, notabilityDir: subject.notability, vaultDir: subject.vault, quarter: 'Winter 2026', since: '2026-01-05', courses: ['STAT 538'], settleMinutes: 0, quizAfterMinutes: 240, latexmk: '', template })
    const status = await subject.service.scan({}, subject.signal)
    expect(status.lectures[0]).toMatchObject({ stage: 'failed' })
    expect(status.lectures[0]?.error).toContain(LECTURES_MARKER)
    expect((await subject.service.getSettings()).template).toBe(template)
    expect((await subject.service.setSettings({ template: null })).template).toBeUndefined()
  })
})
