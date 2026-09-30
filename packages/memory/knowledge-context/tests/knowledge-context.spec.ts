/** Knowledge-first grounding: query extraction, passage labeling, model text, and the pre-step injection. */

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as knowledgeContext from '../src/index.ts'
import { distinctHits, groundingText, searchText, toPassages, userQuery } from '../src/index.ts'
import type { Config } from '../src/index.ts'

const user = (text: string): UserMessage => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

const HITS = [
  { source: '/v/UW/STAT 559/2026-05-31 Lec 17.md', collection: 'academic', heading: 'Page 2', text: 'Markov inequality bounds the tail.', score: 0.712 },
  { source: '/v/UW/STAT 513/Lec 4.md', collection: 'academic', heading: 'Sufficiency', text: 'x'.repeat(50), score: 0.5 },
  { source: '/v/other.md', collection: 'academic', text: 'unrelated', score: 0.1 },
]

describe('grounding helpers', () => {
  it('searches only what the user typed', () => {
    const injected = createUserMessage({ content: [{ type: 'text', text: 'Time sampled…' }], source: { kind: 'time-context-test' } as never })
    expect(userQuery([user('What is  a sufficient statistic?'), injected])).toBe('What is  a sufficient statistic?')
    expect(userQuery([injected])).toBe('')
    expect(userQuery([user('x'.repeat(1500))])).toHaveLength(1000)
  })

  it('labels passages above the floor, reads pages from headings, and trims long text', () => {
    expect(toPassages(HITS, 0.35, 20)).toEqual([
      { label: 'K1', collection: 'academic', source: HITS[0]!.source, heading: 'Page 2', page: 2, text: 'Markov inequality bo …', score: 0.71 },
      { label: 'K2', collection: 'academic', source: HITS[1]!.source, heading: 'Sufficiency', text: `${'x'.repeat(20)} …`, score: 0.5 },
    ])
  })

  it('drops copies of a passage and repeated chunks of one section', () => {
    const copy = { ...HITS[0]!, source: '/v/Other Notes/Lec 17.md', score: 0.7 }
    const sameSection = { ...HITS[0]!, text: 'Another chunk of page 2.', score: 0.6 }
    expect(distinctHits([HITS[0]!, copy, sameSection, HITS[1]!])).toEqual([HITS[0], HITS[1]])
    expect(toPassages([HITS[0]!, HITS[1]!], 0, 900, 1).map(passage => passage.label)).toEqual(['K1'])
  })

  it('searches a short follow-up together with the earlier questions', () => {
    expect(searchText('and the proof?', ['What is the weak law?'])).toBe('What is the weak law?\nand the proof?')
    expect(searchText('and the proof?', [])).toBe('and the proof?')
    const long = 'Explain how the strong law differs from the weak law of large numbers for pairwise independent variables'
    expect(searchText(long, ['earlier'])).toBe(long)
  })

  it('tells the model to answer from the notes first and verify outside', () => {
    const passages = toPassages(HITS, 0.35, 900)
    const text = groundingText(passages, 'Academic', true)
    expect(text).toContain('Answer from these first and cite them inline as [K1], [K2]')
    expect(text).toContain('cite those as [W1], [W2]')
    expect(text).toContain(`[K1] ${HITS[0]!.source} — Page 2\nMarkov inequality bounds the tail.`)
    expect(groundingText(passages, 'Academic', false)).not.toContain('web search')
    expect(groundingText(passages, 'Academic', true)).not.toContain('mind_map')
    expect(groundingText(passages, 'Academic', true, undefined, true)).toContain('call mind_map to show those connections')
    expect(groundingText([], 'Academic', true)).toContain('No passage in the user\'s knowledge base (Academic) matched this message.')
    expect(groundingText([], 'Personal', false)).not.toContain('web search')
    expect(groundingText([], 'Academic', true, 'embedding server down')).toContain('failed: embedding server down')
  })
})

describe('knowledge-context plugin', () => {
  async function bench(config: Config, search = vi.fn(async () => ({ hits: HITS, entities: [] }))) {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(AgentRegistry)
    ctx.provide('memory', {
      getSettings: () => ({ collections: [{ id: 'academic', name: 'Academic', sources: [] }, { id: 'personal', name: 'Personal', sources: [] }] }),
      search,
    } as never)
    await ctx.plugin(knowledgeContext, config)
    const history: { type: string; data: UserMessage }[] = []
    const session = { get seq() { return history.length }, eventAt: (seq: number) => history[seq] }
    const agent: Agent = { id: SessionId('a'), ctx: new Context(), session } as never
    const ask = (text: string) => { history.push({ type: 'user/message', data: user(text) }) }
    const fire = async (messages: UserMessage[], step = 1, signal = new AbortController().signal) =>
      await agentEvents(ctx, agent).waterfall('agent/pre-step', { messages, turn: 1, step, signal }, () => Promise.resolve({ kind: 'enter' as const, messages }))
    return { ctx, search, fire, ask }
  }

  it('appends one logged grounding message on the first step of a user turn', async () => {
    const subject = await bench({ knowledgeBases: ['academic'] })
    const question = user('Explain Markov inequality')
    const decision = await subject.fire([question])
    expect(subject.search).toHaveBeenCalledWith({ query: 'Explain Markov inequality', topK: 12, collections: ['academic'] }, expect.any(AbortSignal))
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages[0]).toBe(question)
    const grounding = decision.messages[1]!
    expect(grounding.source).toMatchObject({ kind: 'knowledge-context', form: 'notice', summary: 'Searched Academic: 2 passages', query: 'Explain Markov inequality', knowledgeBases: ['academic'] })
    expect(grounding.source).toHaveProperty('passages.length', 2)
    expect(grounding.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('[K1]') })
  })

  it('searches a follow-up with the earlier questions from the session log', async () => {
    const subject = await bench({ knowledgeBases: ['academic'] })
    subject.ask('What is the weak law of large numbers?')
    subject.ask('Who proved it first?')
    subject.ask('Explain Chebyshev')
    const decision = await subject.fire([user('and the proof?')])
    expect(subject.search).toHaveBeenCalledWith(expect.objectContaining({ query: 'Who proved it first?\nExplain Chebyshev\nand the proof?' }), expect.any(AbortSignal))
    if (decision.kind !== 'enter') throw new Error('expected enter')
    expect(decision.messages[1]?.source).toMatchObject({ query: 'and the proof?', searched: 'Who proved it first?\nExplain Chebyshev\nand the proof?' })
  })

  it('leaves later steps and turns without user text alone', async () => {
    const subject = await bench({ knowledgeBases: ['*'] })
    const later = await subject.fire([user('hi')], 2)
    expect(later.kind === 'enter' && later.messages).toHaveLength(1)
    const injected = createUserMessage({ content: [{ type: 'text', text: 'wake' }], source: { kind: 'time-context-test' } as never })
    const noUser = await subject.fire([injected])
    expect(noUser.kind === 'enter' && noUser.messages).toHaveLength(1)
    expect(subject.search).not.toHaveBeenCalled()
  })

  it('searches every knowledge base for `*` and reports a failed search to the model', async () => {
    const failing = vi.fn(async () => { throw new Error('embedding server down') })
    const subject = await bench({ knowledgeBases: ['*'], verify: false }, failing)
    const decision = await subject.fire([user('anything')])
    expect(failing).toHaveBeenCalledWith({ query: 'anything', topK: 12 }, expect.any(AbortSignal))
    if (decision.kind !== 'enter') throw new Error('expected enter')
    expect(decision.messages[1]?.source).toMatchObject({ summary: 'Knowledge search failed', error: 'embedding server down', knowledgeBases: [] })
    expect(decision.messages[1]?.content[0]).toMatchObject({ text: expect.stringContaining('Academic, Personal') })
  })

  it('adds nothing when the turn is cancelled during the search', async () => {
    const controller = new AbortController()
    const search = vi.fn(async () => { controller.abort(); throw new Error('aborted') })
    const subject = await bench({ knowledgeBases: ['academic'] }, search)
    const decision = await subject.fire([user('q')], 1, controller.signal)
    expect(decision.kind === 'enter' && decision.messages).toHaveLength(1)
  })
})
