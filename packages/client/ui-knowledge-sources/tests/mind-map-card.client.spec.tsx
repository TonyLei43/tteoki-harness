// @vitest-environment jsdom
/** mind_map Tool card: reading arguments, call phases, sources, and the expanded view. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MindMapCard, MindMapTail, mindMapTurnDefinition, readMindMap } from '../src/client/index.ts'
import type { MindMapCardProps, MindMapTailProps } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const ARGS = {
  title: 'Weak law of large numbers',
  center: 'wlln',
  concepts: [
    { id: 'wlln', label: 'Weak law', detail: 'Sample means converge in probability.' },
    { id: 'cheb', label: 'Chebyshev', sources: ['K1', '/vault/UW/STAT 559/Lec 17.md', 7] },
    { label: 'no id' },
  ],
  links: [{ from: 'wlln', to: 'cheb', label: 'proved with' }, { to: 'x' }],
}

const props = (block: unknown, phase = 'settled', openFile = vi.fn()): MindMapCardProps =>
  ({ phase, block, openFile, t: (key: keyof typeof en) => en[key] }) as never

describe('readMindMap', () => {
  it('reads concepts and links, dropping malformed entries', () => {
    const map = readMindMap(JSON.stringify(ARGS))
    expect(map?.nodes.map(node => node.id)).toEqual(['wlln', 'cheb'])
    expect(map?.nodes[1]?.sources).toEqual(['K1', '/vault/UW/STAT 559/Lec 17.md'])
    expect(map?.links).toEqual([{ from: 'wlln', to: 'cheb', label: 'proved with' }])
    expect(readMindMap('{"title":"Laws &amp; Modes","center":"a","concepts":[{"id":"a","label":"x &lt; y"}]}')).toMatchObject({ title: 'Laws & Modes', nodes: [{ label: 'x < y' }] })
    expect(readMindMap('{"center": "a", "conc')).toBeUndefined()
    expect(readMindMap('[]')).toBeUndefined()
    expect(readMindMap('{"center": 1}')).toBeUndefined()
  })
})

const tail = (argsRaw: string | undefined, openFile = vi.fn()): MindMapTailProps =>
  ({ turn: { data: { get: () => argsRaw === undefined ? undefined : { maps: [{ callId: 'c1', argsRaw }] } } }, seq: 1, openFile, t: (key: keyof typeof en) => en[key] }) as never

describe('MindMapTail', () => {
  it('draws the Turn\'s maps under the answer, opens file sources, and expands to a full view', () => {
    const openFile = vi.fn()
    render(<MindMapTail {...tail(JSON.stringify(ARGS), openFile)} />)
    expect(screen.getByRole('img', { name: 'Weak law of large numbers' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Chebyshev' }))
    fireEvent.click(screen.getByRole('button', { name: 'K1' }))
    expect(openFile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '/vault/UW/STAT 559/Lec 17.md' }))
    expect(openFile).toHaveBeenCalledWith('/vault/UW/STAT 559/Lec 17.md')
    fireEvent.click(screen.getByText(en.expandMap))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByText(en.expandMap))
    fireEvent.click(screen.getByText(en.closeMap))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders nothing for a Turn without maps or with an unreadable one', () => {
    expect(render(<MindMapTail {...tail(undefined)} />).container.textContent).toBe('')
    cleanup()
    expect(render(<MindMapTail {...tail('{"center":')} />).container.textContent).toBe('')
  })
})

describe('mind map Turn projection', () => {
  it('publishes successful mind_map calls against their Turn', () => {
    const start = { type: 'turn/start', seq: 1, data: { turn: 4 } }
    const call = { type: 'tool/call', seq: 2, data: { turn: 4, step: 1, callId: 'c1', name: 'mind_map', arguments: '{"center":"a"}' } }
    const other = { type: 'tool/call', seq: 3, data: { turn: 4, step: 1, callId: 'c2', name: 'web_search', arguments: '{}' } }
    const result = { type: 'tool/result', seq: 4, surfaceOp: 'append', data: { turn: 4, message: { source: { callId: 'c1' }, isError: false } } }
    const failed = { ...result, data: { turn: 4, message: { source: { callId: 'c3' }, isError: true } } }
    expect(mindMapTurnDefinition.match(start as never)).toEqual({ id: '4', role: 'start' })
    expect(mindMapTurnDefinition.match(other as never)).toBeNull()
    let state = mindMapTurnDefinition.start({} as never, { event: start } as never, {} as never)
    for (const event of [call, result, failed]) state = mindMapTurnDefinition.update({ state } as never, { event } as never)
    expect(state.maps).toEqual([{ callId: 'c1', argsRaw: '{"center":"a"}' }])
    const published = mindMapTurnDefinition.buildLocationData?.({ state } as never, 'turn', null)
    expect(published).toMatchObject({ kind: 'turn', turn: 4, key: 'mind-maps' })
    expect(mindMapTurnDefinition.buildLocationData?.({ state } as never, 'turn', published ?? null)).toBe(published)
    expect(mindMapTurnDefinition.buildLocationData?.({ state: { ...state, maps: [] } } as never, 'turn', null)).toBeNull()
  })
})

describe('MindMapCard', () => {
  it('reads as one line in the work details', () => {
    render(<MindMapCard {...props({ kind: 'tool-result', call: { argsRaw: JSON.stringify(ARGS) }, content: [], isError: false })} />)
    expect(screen.getByText('Mind map “Weak law of large numbers” — shown under the answer')).toBeTruthy()
  })

  it('shows progress while preparing or streaming and the reason for a failed map', () => {
    render(<MindMapCard {...props({}, 'preparing')} />)
    expect(screen.getByText(en.drawingMap)).toBeTruthy()
    cleanup()
    render(<MindMapCard {...props({ argsRaw: '{"center":"wl' }, 'running')} />)
    expect(screen.getByText(en.drawingMap)).toBeTruthy()
    cleanup()
    render(<MindMapCard {...props({ kind: 'tool-result', call: { argsRaw: '{}' }, content: [{ type: 'text', text: 'center "x" is not a concept id' }], isError: true })} />)
    expect(screen.getByText('The mind map could not be drawn: center "x" is not a concept id')).toBeTruthy()
  })
})
