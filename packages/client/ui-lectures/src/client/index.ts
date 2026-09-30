/**
 * Lecture quiz, browser half: one home-dashboard widget showing lectures in
 * the pipeline and the latest end-of-lecture quiz over the `lectures` Remote
 * namespace, and a Study section on each class page. Quiz me starts an
 * Academic session that asks the quiz's questions; Plan what to study starts one
 * that plans the week from the class's deadlines and notes.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the slot registry merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the dashboard's SlotMap merge (the 'dashboard.widget' list).
import type {} from '@deepseek-ai/dsh-client-ui-dashboard/client'
// Type-only: the global session hooks (ctx.sessions).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: the cross-Controller Workspace navigation merge (ctx.uiWorkspace).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: the ctx.remote merge and the lectures wire vocabulary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the class page's SlotMap merge (the 'course.section' list).
import type {} from '@deepseek-ai/dsh-client-ui-agenda/client'
// Type-only: the agentPresets Remote namespace.
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { en } from './locales.ts'
import { quizPrompt, QuizWidget } from './QuizWidget.tsx'
import { StudySection, studyPrompt } from './StudySection.tsx'
import type { StudyInjected } from './StudySection.tsx'

export { quizPrompt, QuizWidget } from './QuizWidget.tsx'
export type { LecturesInjected, QuizWidgetProps } from './QuizWidget.tsx'
export { StudySection, studyPrompt } from './StudySection.tsx'
export type { StudyInjected, StudySectionProps } from './StudySection.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'lectures'

/** Required services. */
export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'remote', 'remote.lectures', 'remote.session']

/** Agent preset Quiz me and study-plan sessions start with. */
const QUIZ_PRESET = 'academic'

/**
 * Unwrap a Remote result.
 * @param method - method name for the failure message.
 * @param result - the Remote call result.
 * @returns the success value.
 * @throws Error carrying the Remote error's message on failure.
 */
function unwrap<T>(method: string, result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${method}: ${result.error.message}`)
  return result.value
}

/**
 * Mount the lecture quiz widget.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, 'en', en), 'ui-lectures: dictionary')
  const startChat = async (text: string): Promise<void> => {
    const sessionId = await ctx.sessions.create()
    // The Academic preset carries the course knowledge tools; without it the session uses the default agent.
    await ctx.get('remote')?.agentPresets?.select(sessionId, QUIZ_PRESET)
    unwrap('session/prompt', await ctx.remote.session.prompt({
      requestId: brandString<SessionRequestId>(randomUUID()),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
    }))
    ctx.uiWorkspace.openSession(sessionId)
  }
  const face: StudyInjected = {
    status: async () => unwrap('lectures/status', await ctx.remote.lectures.status()),
    quizzes: async () => unwrap('lectures/quizzes', await ctx.remote.lectures.quizzes({ limit: 20 })).quizzes,
    process: async id => unwrap('lectures/process', await ctx.remote.lectures.process({ id })),
    quizMe: async (quiz) => { await startChat(quizPrompt(quiz)) },
    studyPlan: async (course, lectures) => { await startChat(studyPrompt(course, lectures)) },
  }
  ctx.slots.inject('dashboard.widget', () => ctx.slots.register({
    name: 'dashboard.widget',
    id: 'lectures.quiz',
    order: 15,
    locale: NS,
    label: () => t('widget'),
    inject: () => face,
  }, QuizWidget))
  ctx.slots.inject('course.section', () => ctx.slots.register({
    name: 'course.section',
    id: 'lectures.study',
    order: 10,
    locale: NS,
    label: () => t('study'),
    inject: () => face,
  }, StudySection))
}
