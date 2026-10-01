// @vitest-environment jsdom
/** MindMap: radial layout, tree and cross links, and concept selection. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { layoutMindMap, MindMap } from '../src/index.ts'
import type { MindMapLink, MindMapNode } from '../src/index.ts'

afterEach(cleanup)

const NODES: MindMapNode[] = [
  { id: 'wlln', label: 'Weak law of large numbers' },
  { id: 'cheb', label: 'Chebyshev inequality', detail: 'Markov applied to the square.', sources: ['K1', 'K3'] },
  { id: 'markov', label: 'Markov inequality' },
  { id: 'pairwise', label: 'Pairwise independence' },
  { id: 'lone', label: 'Borel–Cantelli' },
  { id: 'wlln', label: 'duplicate id' },
]

const LINKS: MindMapLink[] = [
  { from: 'wlln', to: 'cheb', label: 'proved with' },
  { from: 'markov', to: 'cheb', label: 'generalizes to' },
  { from: 'wlln', to: 'pairwise', label: 'needs only' },
  { from: 'pairwise', to: 'cheb', label: 'zeroes covariances in' },
  { from: 'cheb', to: 'ghost' },
  { from: 'cheb', to: 'cheb' },
]

describe('layoutMindMap', () => {
  it('builds a spanning tree from the center, keeps other links as cross links, and hangs orphans off the center', () => {
    const layout = layoutMindMap('wlln', NODES, LINKS)
    expect(layout.placed.get('wlln')).toMatchObject({ x: 0, y: 0, depth: 0, branch: -1 })
    expect(layout.placed.get('cheb')?.depth).toBe(1)
    expect(layout.placed.get('markov')?.depth).toBe(2)
    expect(layout.placed.get('markov')?.branch).toBe(layout.placed.get('cheb')?.branch)
    expect(layout.placed.get('lone')?.depth).toBe(1)
    expect(layout.placed.get('wlln')?.node.label).toBe('Weak law of large numbers')
    expect(layout.tree.map(link => `${link.from}>${link.to}`)).toEqual(['wlln>cheb', 'wlln>pairwise', 'cheb>markov', 'wlln>lone'])
    expect(layout.cross).toEqual([{ from: 'pairwise', to: 'cheb', label: 'zeroes covariances in' }])
    expect(layout.bounds.maxX).toBeGreaterThan(0)
  })

  it('widens a crowded ring so its concepts do not overlap', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ id: `n${index}`, label: `Concept ${index}` }))
    const layout = layoutMindMap('hub', [{ id: 'hub', label: 'Hub' }, ...many], many.map(node => ({ from: 'hub', to: node.id })))
    const first = layout.placed.get('n0')!
    expect(Math.hypot(first.x, first.y)).toBeGreaterThan(20 * 200 / (2 * Math.PI) - 1)
  })

  it('shows link labels on a large map only around the focused concept', () => {
    const many = Array.from({ length: 14 }, (_, index) => ({ id: `n${index}`, label: `Concept ${index}` }))
    render(<MindMap center="hub" nodes={[{ id: 'hub', label: 'Hub' }, ...many]} links={many.map(node => ({ from: 'hub', to: node.id, label: `rel ${node.id}` }))} label="big" sourcesLabel="From" />)
    expect(screen.queryByText('rel n3')).toBeNull()
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Concept 3' }))
    expect(screen.getByText('rel n3')).toBeTruthy()
  })

  it('falls back to the first concept as the center and handles an empty map', () => {
    expect(layoutMindMap('missing', NODES.slice(0, 2), []).placed.get('wlln')?.depth).toBe(0)
    expect(layoutMindMap('x', [], []).placed.size).toBe(0)
  })
})

describe('MindMap', () => {
  it('draws every concept and shows a selected concept with its sources', () => {
    const onSource = vi.fn()
    render(<MindMap center="wlln" nodes={NODES} links={LINKS} label="Map of the weak law" sourcesLabel="From" onSource={onSource} renderDetail={node => <em>{`more on ${node.id}`}</em>} />)
    expect(screen.getByRole('img', { name: 'Map of the weak law' })).toBeTruthy()
    expect(screen.getAllByRole('button').map(node => node.getAttribute('aria-label'))).toEqual(expect.arrayContaining(['Chebyshev inequality', 'Borel–Cantelli']))
    expect(screen.getByText('proved with')).toBeTruthy()
    const cheb = screen.getByRole('button', { name: 'Chebyshev inequality' })
    fireEvent.pointerEnter(cheb)
    fireEvent.click(cheb)
    expect(cheb.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Markov applied to the square.')).toBeTruthy()
    expect(screen.getByText('more on cheb')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'K3' }))
    expect(onSource).toHaveBeenCalledWith('K3')
    fireEvent.pointerLeave(cheb)
    fireEvent.keyDown(cheb, { key: 'Enter' })
    expect(screen.queryByText('Markov applied to the square.')).toBeNull()
  })

  it('shows sources as text without a handler and cuts long labels', () => {
    render(<MindMap center="a" nodes={[{ id: 'a', label: 'A very long concept name that keeps going', sources: ['notes.md'] }]} links={[]} label="m" sourcesLabel="From" />)
    const node = screen.getByRole('button', { name: 'A very long concept name that keeps going' })
    expect(node.textContent).toContain('…')
    fireEvent.keyDown(node, { key: ' ' })
    expect(screen.getByText('notes.md').tagName).toBe('SPAN')
  })
})
