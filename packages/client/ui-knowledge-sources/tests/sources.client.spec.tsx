// @vitest-environment jsdom
/** Knowledge Sources: reading the logged grounding, the Turn projection, and the card. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileLabel, readSources, SourcesCard, sourcesTurnDefinition } from '../src/client/index.ts'
import type { KnowledgeSourcesData, SourcesCardProps } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(cleanup)

const LOGGED = {
  kind: 'knowledge-context',
  form: 'notice',
  summary: 'Searched Academic: 2 passages',
  query: 'Explain Markov inequality',
  knowledgeBases: ['academic'],
  passages: [
    { label: 'K1', collection: 'academic', source: '/UW/STAT 559/Lecture Notes/STAT 559 - Measure Theory.pdf', heading: 'Page 12', page: 12, text: 'For $X \\ge 0$, $P(X \\ge a) \\le E[X]/a$.', score: 0.71 },
    { label: 'K2', collection: 'academic', source: '/vault/UW/STAT 559/2026-05-31 Lec 17.md', heading: 'Step 3', text: 'By Markov inequality the tail is bounded.', score: 0.52 },
    { label: 3, source: 'bad' },
  ],
}

describe('reading the logged grounding', () => {
  it('keeps well-formed passages and rejects other sources', () => {
    const data = readSources(LOGGED)
    expect(data?.query).toBe('Explain Markov inequality')
    expect(data?.passages.map(passage => passage.label)).toEqual(['K1', 'K2'])
    expect(data?.passages[0]?.page).toBe(12)
    expect(readSources({ kind: 'user' })).toBeUndefined()
    expect(readSources(null)).toBeUndefined()
    expect(readSources({ kind: 'knowledge-context', query: 'q', passages: 'no' })).toBeUndefined()
    expect(readSources({ kind: 'knowledge-context', query: 'q', passages: [], error: 'down' })).toEqual({ query: 'q', passages: [], summary: '', error: 'down' })
  })

  it('names files without extensions, with their folder', () => {
    expect(fileLabel('/vault/UW/STAT 559/2026-05-31 Lec 17.md')).toEqual({ name: '2026-05-31 Lec 17', folder: 'STAT 559' })
    expect(fileLabel('notes.pdf')).toEqual({ name: 'notes', folder: '' })
  })

  it('publishes the grounding against the Turn it was logged in', () => {
    const event = { type: 'user/message', seq: 5, time: 1, surfaceOp: 'append', data: { id: 'm1', content: [], source: LOGGED } }
    expect(sourcesTurnDefinition.match(event as never)).toEqual({ id: 'm1', role: 'start' })
    expect(sourcesTurnDefinition.match({ ...event, data: { ...event.data, source: { kind: 'user' } } } as never)).toBeNull()
    const state = sourcesTurnDefinition.start({} as never, { event, location: { kind: 'step', turn: { turn: 3 } } } as never, {} as never)
    expect(state?.turn).toBe(3)
    const published = sourcesTurnDefinition.buildLocationData?.({ state } as never, 'turn', null)
    expect(published).toMatchObject({ kind: 'turn', turn: 3, key: 'knowledge-sources' })
    expect(sourcesTurnDefinition.buildLocationData?.({ state } as never, 'turn', published ?? null)).toBe(published)
    expect(sourcesTurnDefinition.buildLocationData?.({ state } as never, 'step', null)).toBeNull()
    expect(sourcesTurnDefinition.start({} as never, { event, location: { kind: 'session' } } as never, {} as never)).toBeNull()
  })
})

describe('SourcesCard', () => {
  const props = (data: KnowledgeSourcesData | undefined, overrides: Partial<SourcesCardProps> = {}): SourcesCardProps => ({
    turn: { data: { get: () => data } },
    seq: 1,
    openFile: vi.fn(),
    previewPage: vi.fn(async () => 'data:image/png;base64,AAAA'),
    t: (key: keyof typeof en) => en[key],
    ...overrides,
  }) as never

  it('lists passages as chips and opens one with its text, page preview, and file', async () => {
    const card = props(readSources(LOGGED))
    render(<SourcesCard {...card} />)
    expect(screen.getByText('From your notes')).toBeTruthy()
    const chip = screen.getByRole('button', { name: /K1.*STAT 559 - Measure Theory.*p\. 12/ })
    fireEvent.click(chip)
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('71% match')).toBeTruthy()
    fireEvent.click(screen.getByText('Show page'))
    await waitFor(() => { expect(screen.getByRole('img')).toBeTruthy() })
    expect(card.previewPage).toHaveBeenCalledWith(LOGGED.passages[0]!.source, 12)
    fireEvent.click(screen.getByText('Hide page'))
    expect(screen.queryByRole('img')).toBeNull()
    fireEvent.click(screen.getByText('Open file'))
    expect(card.openFile).toHaveBeenCalledWith(LOGGED.passages[0]!.source)
    // A Markdown note has no page preview.
    fireEvent.click(screen.getByRole('button', { name: /K2/ }))
    expect(screen.queryByText('Show page')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /K2/ }))
    expect(screen.queryByText('Open file')).toBeNull()
  })

  it('reports an empty or failed search, a failed preview, and renders nothing for ungrounded turns', async () => {
    const { container } = render(<SourcesCard {...props(undefined)} />)
    expect(container.textContent).toBe('')
    cleanup()
    render(<SourcesCard {...props({ query: 'q', passages: [], summary: '' })} />)
    expect(screen.getByText(en.none)).toBeTruthy()
    cleanup()
    render(<SourcesCard {...props({ query: 'q', passages: [], summary: '', error: 'down' })} />)
    expect(screen.getByText('Your notes could not be searched: down')).toBeTruthy()
    cleanup()
    render(<SourcesCard {...props(readSources(LOGGED), { previewPage: vi.fn(async () => { throw new Error('no') }) })} />)
    fireEvent.click(screen.getByRole('button', { name: /K1/ }))
    fireEvent.click(screen.getByText('Show page'))
    expect(await screen.findByText(en.pageFailed)).toBeTruthy()
  })

  it('keeps the host entry inert', () => {
    expect(hostApply).not.toThrow()
  })
})
