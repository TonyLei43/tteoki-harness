/** mind_map: map checks and the registered tool. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as mindMap from '../src/index.ts'
import { checkMap } from '../src/index.ts'

const CONCEPTS = [{ id: 'wlln', label: 'Weak law' }, { id: 'cheb', label: 'Chebyshev', sources: ['K1'] }, { id: 'markov', label: 'Markov' }]
const LINKS = [{ from: 'wlln', to: 'cheb', label: 'proved with' }, { from: 'markov', to: 'cheb' }]

describe('checkMap', () => {
  it('accepts a well-formed map and names the first problem otherwise', () => {
    expect(checkMap('wlln', CONCEPTS, LINKS, 40)).toBeUndefined()
    expect(checkMap('wlln', CONCEPTS.slice(0, 1), [], 40)).toContain('at least 2')
    expect(checkMap('wlln', CONCEPTS, LINKS, 2)).toContain('at most 2 concepts')
    expect(checkMap('wlln', [...CONCEPTS, { id: 'cheb', label: 'again' }], LINKS, 40)).toContain('duplicate concept id "cheb"')
    expect(checkMap('wlln', [...CONCEPTS, { id: ' ', label: 'x' }], LINKS, 40)).toContain('non-empty id and label')
    expect(checkMap('nope', CONCEPTS, LINKS, 40)).toContain('center "nope"')
    expect(checkMap('wlln', CONCEPTS, [{ from: 'wlln', to: 'ghost' }], 40)).toContain('unknown concept')
    expect(checkMap('wlln', CONCEPTS, [{ from: 'cheb', to: 'cheb' }], 40)).toContain('to itself')
    expect(checkMap('wlln', CONCEPTS, Array.from({ length: 7 }, () => LINKS[0]!), 3)).toContain('at most 6 links')
  })
})

describe('mind_map tool', () => {
  it('registers, confirms a valid map, and rejects an invalid one', async () => {
    interface Registered { name: string; execute: (args: unknown) => Promise<{ concepts: number; links: number }>; output: { render: (args: unknown, value: unknown) => { text: string }[] } }
    const register = vi.fn((_tool: Registered) => () => {})
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    ctx.provide('tools', { register } as never)
    await ctx.plugin(mindMap, {})
    const tool = register.mock.calls[0]![0]
    expect(tool.name).toBe('mind_map')
    const args = { title: 'Weak law', center: 'wlln', concepts: CONCEPTS, links: LINKS }
    const value = await tool.execute(args)
    expect(value).toEqual({ concepts: 3, links: 2 })
    expect(tool.output.render(args, value)[0]?.text).toBe('Showed the mind map "Weak law" to the user: 3 concepts, 2 links.')
    await expect(tool.execute({ ...args, center: 'x' })).rejects.toThrow('center "x"')
  })
})
