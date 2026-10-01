/** The OpenRouter catalog search: id/name matching, sorting, and the empty query. */

import { describe, expect, it } from 'vitest'
import type { OpenRouterModel } from '@deepseek-ai/dsh-api-remotes/client'
import { searchModels } from '../src/client/catalog.ts'

/** One catalog row with the listed overrides. */
function model(overrides: Partial<OpenRouterModel> & { id: string }): OpenRouterModel {
  return { name: overrides.id, promptPerM: 1, completionPerM: 2, ...overrides }
}

const MODELS: readonly OpenRouterModel[] = [
  model({ id: 'zeta/model', name: 'Zeta' }),
  model({ id: 'openai/gpt-4o', name: 'GPT-4o' }),
  model({ id: 'alpha/chat', name: 'Alpha' }),
]

describe('searchModels', () => {
  it('sorts by name for an empty query', () => {
    expect(searchModels(MODELS, '').map(row => row.id)).toEqual(['alpha/chat', 'openai/gpt-4o', 'zeta/model'])
    expect(searchModels(MODELS, '   ').map(row => row.id)).toEqual(['alpha/chat', 'openai/gpt-4o', 'zeta/model'])
  })

  it('matches id and name case-insensitively', () => {
    expect(searchModels(MODELS, 'GPT').map(row => row.id)).toEqual(['openai/gpt-4o'])
    expect(searchModels(MODELS, 'zeta').map(row => row.id)).toEqual(['zeta/model'])
    expect(searchModels(MODELS, 'ALPHA').map(row => row.id)).toEqual(['alpha/chat'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(searchModels(MODELS, 'missing')).toEqual([])
  })

  it('breaks name ties by id', () => {
    const tied = [model({ id: 'b/id', name: 'Same' }), model({ id: 'a/id', name: 'Same' })]
    expect(searchModels(tied, '').map(row => row.id)).toEqual(['a/id', 'b/id'])
  })
})
