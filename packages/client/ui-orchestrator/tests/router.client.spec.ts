/** Pure intent-router ranking: target selection, tie-breaks, and no-match. */

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  directoryBasename, rankPresets, rankSessions, routeIntent, tokenize,
  type RoutePreset, type RouteSession,
} from '../src/client/router.ts'

/**
 * Brand one fixture session id at the test boundary.
 * @param value - the raw id text.
 * @returns the branded id.
 */
function sid(value: string): SessionId {
  return brandString<SessionId>(value)
}

/**
 * One session candidate with the listed overrides.
 * @param id - raw session id.
 * @param overrides - field overrides.
 * @returns the candidate.
 */
function session(id: string, overrides: Partial<Omit<RouteSession, 'id'>> = {}): RouteSession {
  return { id: sid(id), title: id, cwd: undefined, agentPreset: undefined, updatedAt: 1, ...overrides }
}

/**
 * One preset candidate with the listed overrides.
 * @param id - preset id.
 * @param overrides - field overrides.
 * @returns the candidate.
 */
function preset(id: string, overrides: Partial<Omit<RoutePreset, 'id'>> = {}): RoutePreset {
  return { id, name: undefined, description: undefined, ...overrides }
}

describe('tokenize', () => {
  it('lowercases and splits on every non-alphanumeric run', () => {
    expect(tokenize('Fix-login /w/Alpha_2')).toEqual(['fix', 'login', 'w', 'alpha', '2'])
    expect(tokenize('   ')).toEqual([])
  })
})

describe('directoryBasename', () => {
  it('reads both separators and trailing slashes', () => {
    expect(directoryBasename('/home/t/project')).toBe('project')
    expect(directoryBasename('C:\\repo\\pkg')).toBe('pkg')
    expect(directoryBasename('/home/repo/')).toBe('repo')
    expect(directoryBasename('')).toBe('')
  })
})

describe('rankSessions', () => {
  it('ranks by token overlap across title, project basename, and preset', () => {
    const sessions = [
      session('ses_alpha', { title: 'Fix login', cwd: '/w/alpha', agentPreset: 'build' }),
      session('ses_beta', { title: 'Alpha work', cwd: '/w/beta' }),
      session('ses_gamma', { title: 'Docs', cwd: '/w/gamma' }),
    ]
    expect(rankSessions('alpha fix', sessions).map(entry => entry.id))
      .toEqual([sid('ses_alpha'), sid('ses_beta'), sid('ses_gamma')])
    expect(rankSessions('build', sessions)[0]?.id).toBe(sid('ses_alpha'))
  })

  it('prefers the more recently active session on an equal score', () => {
    const sessions = [session('ses_old', { updatedAt: 1 }), session('ses_new', { updatedAt: 9 })]
    expect(rankSessions('', sessions).map(entry => entry.id)).toEqual([sid('ses_new'), sid('ses_old')])
  })

  it('breaks exact ties by id and leaves the input order untouched', () => {
    const sessions = [session('ses_b'), session('ses_a')]
    expect(rankSessions('', sessions).map(entry => entry.id)).toEqual([sid('ses_a'), sid('ses_b')])
    expect(sessions.map(entry => entry.id)).toEqual([sid('ses_b'), sid('ses_a')])
  })
})

describe('rankPresets', () => {
  it('ranks by overlap across name, description, and id, then by id', () => {
    const presets = [
      preset('plan', { name: 'Planner', description: 'Break work into steps' }),
      preset('build', { name: 'Builder' }),
      preset('research', { name: 'Researcher', description: 'Investigate a codebase' }),
    ]
    expect(rankPresets('investigate', presets)[0]?.id).toBe('research')
    expect(rankPresets('', presets).map(entry => entry.id)).toEqual(['build', 'plan', 'research'])
  })
})

describe('routeIntent', () => {
  it('returns undefined for blank input and for no token overlap', () => {
    const options = { sessions: [session('ses_a', { title: 'Deploy' })], presets: [preset('build')] }
    expect(routeIntent('   ', options)).toBeUndefined()
    expect(routeIntent('unrelated words', options)).toBeUndefined()
  })

  it('returns undefined when there are no candidates', () => {
    expect(routeIntent('anything', { sessions: [], presets: [] })).toBeUndefined()
  })

  it('selects the best-overlapping session', () => {
    const options = {
      sessions: [
        session('ses_a', { title: 'Deploy pipeline' }),
        session('ses_b', { title: 'Design docs' }),
      ],
      presets: [],
    }
    const target = routeIntent('deploy pipeline now', options)
    expect(target).toMatchObject({ kind: 'session', session: { id: sid('ses_a') } })
  })

  it('prefers an existing session over a preset at equal score', () => {
    const options = {
      sessions: [session('ses_a', { title: 'Research' })],
      presets: [preset('research', { name: 'Research' })],
    }
    expect(routeIntent('research', options)).toMatchObject({ kind: 'session', session: { id: sid('ses_a') } })
  })

  it('selects a preset when no session matches', () => {
    const options = {
      sessions: [session('ses_a', { title: 'Deploy' })],
      presets: [preset('research', { name: 'Research', description: 'Investigate a codebase' })],
    }
    expect(routeIntent('investigate codebase', options)).toMatchObject({ kind: 'preset', preset: { id: 'research' } })
  })

  it('uses session recency as the tie-break', () => {
    const options = {
      sessions: [
        session('ses_old', { title: 'Same topic', updatedAt: 1 }),
        session('ses_new', { title: 'Same topic', updatedAt: 9 }),
      ],
      presets: [],
    }
    expect(routeIntent('same topic', options)).toMatchObject({ kind: 'session', session: { id: sid('ses_new') } })
  })
})