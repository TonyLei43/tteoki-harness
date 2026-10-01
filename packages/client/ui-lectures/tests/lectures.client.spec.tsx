// @vitest-environment jsdom
/** Lecture quiz widget: rendering, actions, the Quiz me prompt, and plugin wiring. */

import { Context, Service } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { LecturesStatus, Quiz } from '@deepseek-ai/dsh-api-remotes/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject, quizPrompt, QuizWidget, StudySection, studyPrompt } from '../src/client/index.ts'
import type { LecturesInjected, QuizWidgetProps, StudyInjected, StudySectionProps } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(cleanup)

const QUIZ: Quiz = {
  id: 'q1',
  course: 'STAT 536/427',
  courseLabel: 'STAT 536/427: Analysis of Categorical and Count Data',
  title: 'Lec 3',
  date: '2026-09-30',
  createdAt: 1,
  notePath: '/vault/UW/STAT 536/2026-09-30 Lec 3.md',
  quizPath: '/vault/UW/STAT 536/Quizzes/2026-09-30 Lec 3 Quiz.md',
  questions: [
    { kind: 'proof', prompt: 'Show the deviance is nonnegative.', answer: 'By Jensen.' },
    { kind: 'concept', prompt: 'Why use a log link?', answer: 'Rates are positive.' },
  ],
}

const STATUS: LecturesStatus = {
  enabled: true,
  scannedAt: 1,
  lectures: [
    { id: 'l2', bundle: '/n/b.nbn', title: 'Lec 4', course: 'BIOST 583', created: '2026-10-01T17:00:00Z', stage: 'waiting', changedAt: 1 },
    { id: 'q1', bundle: '/n/a.nbn', title: 'Lec 3', course: 'STAT 536/427', created: '2026-09-30T17:00:00Z', stage: 'quizzed', changedAt: 1 },
  ],
  courses: [
    { course: 'STAT 581', name: 'Advanced Theory of Statistical Inference I', master: '/n/STAT 581 - A.tex', pdf: '/n/STAT 581 - A.pdf', lectures: 2 },
    { course: 'STAT 516', name: '', master: '/n/STAT 516.tex', lectures: 0, error: 'LaTeX: ! Undefined control sequence.' },
  ],
}

function face(overrides: Partial<LecturesInjected> = {}): LecturesInjected {
  return {
    status: vi.fn(async () => STATUS),
    quizzes: vi.fn(async () => [QUIZ, { ...QUIZ, id: 'q0', title: 'Lec 2', date: '2026-09-28' }]),
    process: vi.fn(async () => QUIZ),
    quizMe: vi.fn(async () => {}),
    ...overrides,
  }
}

function props(injected: LecturesInjected): QuizWidgetProps {
  return { ...injected, t: (key: keyof typeof en) => en[key], now: 0 } as never
}

describe('quizPrompt', () => {
  it('lists every question with its reference answer', () => {
    const text = quizPrompt({ ...QUIZ, questions: [{ kind: 'proof', prompt: 'Prove A.', answer: 'Step 1\nStep 2' }] })
    expect(text).toContain('Quiz me on STAT 536/427: Analysis of Categorical and Count Data, lecture "Lec 3" (2026-09-30).')
    expect(text).toContain('Do not show a reference answer before I answer.')
    expect(text).toContain('1. [proof] Prove A.\n   Reference answer: Step 1\n   Step 2')
  })
})

describe('QuizWidget', () => {
  it('shows lectures in progress and the latest quiz with folded answers', async () => {
    const injected = face()
    render(<QuizWidget {...props(injected)} />)
    expect(await screen.findByText('STAT 536/427: Analysis of Categorical and Count Data')).toBeTruthy()
    expect(screen.getByText('BIOST 583 · Lec 4')).toBeTruthy()
    expect(screen.getByText('Waiting for edits to stop')).toBeTruthy()
    expect(screen.getByText('STAT 581: Advanced Theory of Statistical Inference I')).toBeTruthy()
    expect(screen.getByText('2 lectures')).toBeTruthy()
    expect(screen.getByText('STAT 516')).toBeTruthy()
    expect(screen.getByTitle('LaTeX: ! Undefined control sequence.').textContent).toBe('Failed')
    expect(screen.queryByText('By Jensen.')).toBeNull()
    fireEvent.click(screen.getAllByText('Show answer')[0]!)
    expect(await screen.findByText('By Jensen.')).toBeTruthy()
    fireEvent.click(screen.getByText('Hide answer'))
    expect(screen.queryByText('By Jensen.')).toBeNull()

    fireEvent.click(screen.getByText('Older'))
    expect(screen.getByText('Lec 2 · 2026-09-28')).toBeTruthy()
    fireEvent.click(screen.getByText('Newer'))
    expect(screen.getByText('Lec 3 · 2026-09-30')).toBeTruthy()

    fireEvent.click(screen.getByText('Quiz me'))
    await waitFor(() => { expect(injected.quizMe).toHaveBeenCalledWith(QUIZ) })
    fireEvent.click(screen.getByText('Make quiz now'))
    await waitFor(() => { expect(injected.process).toHaveBeenCalledWith('l2') })
  })

  it('reports an off pipeline, an empty quiz list, and failures', async () => {
    render(<QuizWidget {...props(face({ status: async () => ({ enabled: false, lectures: [], courses: [] }), quizzes: async () => [] }))} />)
    expect(await screen.findByText(en.off)).toBeTruthy()
    cleanup()
    render(<QuizWidget {...props(face({ status: async () => ({ enabled: true, lectures: [], courses: [], error: 'ENOENT' }), quizzes: async () => [] }))} />)
    expect(await screen.findByText(en.noQuiz)).toBeTruthy()
    expect(screen.getByText('ENOENT')).toBeTruthy()
    cleanup()
    render(<QuizWidget {...props(face({ status: async () => { throw new Error('down') } }))} />)
    expect(await screen.findByText(en.loadFailed)).toBeTruthy()
    cleanup()
    render(<QuizWidget {...props(face({ quizMe: async () => { throw new Error('session/prompt: busy') } }))} />)
    fireEvent.click(await screen.findByText('Quiz me'))
    expect(await screen.findByText('session/prompt: busy')).toBeTruthy()
  })
})

describe('StudySection', () => {
  const course = { code: 'STAT 581', name: 'Advanced Theory of Statistical Inference I', folders: [] }
  const study = (overrides: Partial<StudyInjected> = {}): StudyInjected => ({
    ...face({
      status: async () => ({
        enabled: true,
        lectures: [
          { id: 'l1', bundle: '/n/a.nbn', title: 'Lec 2', course: 'STAT 581', created: '2026-10-02T17:00:00Z', stage: 'quizzed', changedAt: 1, notePath: '/v/Lec 2.md' },
          { id: 'l0', bundle: '/n/b.nbn', title: 'Lec 1', course: 'STAT 516', created: '2026-09-30T17:00:00Z', stage: 'quizzed', changedAt: 1 },
        ],
        courses: [{ course: 'STAT 581', name: course.name, master: '/m.tex', lectures: 2 }],
      }),
      quizzes: async () => [{ ...QUIZ, course: 'STAT 581', title: 'Lec 2' }],
    }),
    studyPlan: vi.fn(async () => {}),
    ...overrides,
  })
  const props = (injected: StudyInjected): StudySectionProps => ({ ...injected, course, now: 0, t: (key: keyof typeof en) => en[key] }) as never

  it('lists the class\'s lectures, master notes, and latest quiz, and starts chats', async () => {
    const injected = study()
    render(<StudySection {...props(injected)} />)
    expect(await screen.findByText('Lec 2 · 2026-10-02')).toBeTruthy()
    expect(screen.queryByText(/Lec 1/)).toBeNull()
    expect(screen.getByText('Master notes: 2 lectures')).toBeTruthy()
    expect(screen.getByText('Lec 2 · 2026-09-30 · 2 questions')).toBeTruthy()
    fireEvent.click(screen.getByText('Quiz me'))
    await waitFor(() => { expect(injected.quizMe).toHaveBeenCalled() })
    fireEvent.click(screen.getByText(en.studyPlan))
    await waitFor(() => { expect(injected.studyPlan).toHaveBeenCalledWith({ code: 'STAT 581', name: course.name }, ['Lec 2 (2026-10-02)']) })
  })

  it('reports a class without lectures, a failed load, and a failed chat', async () => {
    render(<StudySection {...props(study({ status: async () => ({ enabled: true, lectures: [], courses: [] }), quizzes: async () => [] }))} />)
    expect(await screen.findByText(en.noLectures)).toBeTruthy()
    cleanup()
    render(<StudySection {...props(study({ status: async () => { throw new Error('down') } }))} />)
    expect(await screen.findByText(en.loadFailed)).toBeTruthy()
    cleanup()
    render(<StudySection {...props(study({ studyPlan: async () => { throw new Error('session/prompt: busy') } }))} />)
    fireEvent.click(await screen.findByText(en.studyPlan))
    expect(await screen.findByText('session/prompt: busy')).toBeTruthy()
  })

  it('writes a study-plan prompt that names the course tool and recent lectures', () => {
    const text = studyPrompt({ code: 'STAT 581', name: '' }, ['Lec 2 (2026-10-02)'])
    expect(text).toContain('Help me decide what to study for STAT 581.')
    expect(text).toContain('Use the course tool for "STAT 581"')
    expect(text).toContain('My most recent lectures:\n- Lec 2 (2026-10-02)')
    expect(studyPrompt({ code: 'STAT 581', name: 'Inference' }, [])).not.toContain('recent lectures')
  })
})

describe('ui-lectures browser plugin', () => {
  it('registers the widget and starts a Quiz me session with the Academic preset', async () => {
    expect(hostApply).not.toThrow()
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    class RemoteService extends Service {
      constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
    }
    new RemoteService(ctx)
    const ok = <T,>(value: T) => ({ ok: true as const, value })
    const lectures = {
      status: vi.fn(async () => ok(STATUS)),
      quizzes: vi.fn(async () => ok({ quizzes: [QUIZ] })),
      process: vi.fn(async () => ({ ok: false as const, error: { code: 'gateway/bad-request', message: 'unknown lecture "x"' } })),
    }
    const session = { prompt: vi.fn(async () => ok({})) }
    const select = vi.fn(async () => ok({}))
    const opened: string[] = []
    ctx.provide('remote.lectures', lectures)
    ctx.provide('remote.session', session)
    ctx.provide('remote.agentPresets', { select })
    ctx.provide('sessions', { create: async () => 's1' })
    ctx.provide('uiWorkspace', { openSession: (id: string) => { opened.push(id) } })
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'dashboard.widget': { kind: 'list', scope: 'root' }, 'course.section': { kind: 'list', scope: 'root' } } } as never, () => null)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const [entry] = slots.entries('dashboard.widget')
    expect(resolveSlotLabel(entry!.options.label)).toBe('Lecture quiz')
    const injected = (entry!.inject as never as () => LecturesInjected)()
    await expect(injected.status()).resolves.toEqual(STATUS)
    await expect(injected.quizzes()).resolves.toEqual([QUIZ])
    expect(lectures.quizzes).toHaveBeenCalledWith({ limit: 20 })
    await expect(injected.process('x')).rejects.toThrow('lectures/process: unknown lecture "x"')
    await injected.quizMe(QUIZ)
    expect(select).toHaveBeenCalledWith('s1', 'academic')
    expect(session.prompt).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', mode: 'queue', content: [{ type: 'text', text: quizPrompt(QUIZ) }] }))
    expect(opened).toEqual(['s1'])

    const [section] = slots.entries('course.section')
    expect(resolveSlotLabel(section!.options.label)).toBe('Study')
    const studyFace = (section!.inject as never as () => StudyInjected)()
    await studyFace.studyPlan({ code: 'STAT 581', name: '' }, [])
    expect(session.prompt).toHaveBeenLastCalledWith(expect.objectContaining({ content: [{ type: 'text', text: studyPrompt({ code: 'STAT 581', name: '' }, []) }] }))

    await fiber.dispose()
    expect(slots.entries('dashboard.widget')).toEqual([])
    expect(slots.entries('course.section')).toEqual([])
  })
})
