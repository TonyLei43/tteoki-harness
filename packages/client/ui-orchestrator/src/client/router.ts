/**
 * Pure intent router for the orchestrator's auto-router.
 *
 * `routeIntent` is the default token-free classifier: it scores every candidate
 * target by case-insensitive token overlap between the free-form input and the
 * target's own words, then falls back to recency (sessions) and stable ids. The
 * board may instead inject a model classifier through the same
 * {@link RouteIntentOptions} contract; nothing here performs I/O, so both paths
 * share one deterministic ranking and one set of tests.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One session candidate as the router reads it. */
export interface RouteSession {
  /** Session identity the board navigates to and prompts. */
  readonly id: SessionId
  /** Display title the board shows for the session. */
  readonly title: string
  /** Project directory, or undefined when the session has none. */
  readonly cwd: string | undefined
  /** Agent preset the session runs, or undefined when none is recorded. */
  readonly agentPreset: string | undefined
  /** Durable last-activity timestamp in epoch ms; the recency tie-break. */
  readonly updatedAt: number
}

/** One agent-preset candidate as the router reads it. */
export interface RoutePreset {
  /** Stable preset identity. */
  readonly id: string
  /** Display name the preset published, or undefined. */
  readonly name: string | undefined
  /** One sentence on what the preset is for, or undefined. */
  readonly description: string | undefined
}

/** Candidate sets the router ranks, shared by the built-in and model classifiers. */
export interface RouteIntentOptions {
  /** Loaded sessions, in any order. */
  readonly sessions: readonly RouteSession[]
  /** Selectable agent presets, in any order. */
  readonly presets: readonly RoutePreset[]
}

/** One ranked candidate: the target plus the token-overlap score that chose it. */
export type RouteTarget =
  | { readonly kind: 'session'; readonly session: RouteSession; readonly score: number }
  | { readonly kind: 'preset'; readonly preset: RoutePreset; readonly score: number }

/**
 * Stable display label for a preset: its name, else its id.
 * @param preset - the preset candidate.
 * @returns the display label.
 */
export function presetLabel(preset: RoutePreset): string {
  return preset.name ?? preset.id
}

/**
 * Split free text into lowercased alphanumeric tokens. Punctuation, path
 * separators, and whitespace all delimit, so `/w/alpha` and `Fix-login` read
 * as their words.
 * @param text - text to tokenize.
 * @returns the non-empty tokens.
 */
export function tokenize(text: string): readonly string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/u).filter(token => token !== '')
}

/**
 * Final path segment of a directory, handling both separators; a trailing
 * separator still names its last segment.
 * @param directory - directory path.
 * @returns the last segment, or the trimmed input when it has none.
 */
export function directoryBasename(directory: string): string {
  const trimmed = directory.replace(/[\\/]+$/u, '')
  const start = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1
  return trimmed.slice(start)
}

/**
 * Token-overlap score of one session: how many of the query tokens appear in
 * its title, project basename, or agent-preset name.
 * @param session - the session candidate.
 * @param queryTokens - lowercased tokens of the routed input.
 * @returns the number of matching tokens.
 */
export function scoreSession(session: RouteSession, queryTokens: ReadonlySet<string>): number {
  const haystack = new Set(tokenize(
    `${session.title} ${session.cwd === undefined ? '' : directoryBasename(session.cwd)} ${session.agentPreset ?? ''}`,
  ))
  let score = 0
  for (const token of queryTokens) if (haystack.has(token)) score += 1
  return score
}

/**
 * Token-overlap score of one preset: how many of the query tokens appear in its
 * name, description, or id.
 * @param preset - the preset candidate.
 * @param queryTokens - lowercased tokens of the routed input.
 * @returns the number of matching tokens.
 */
export function scorePreset(preset: RoutePreset, queryTokens: ReadonlySet<string>): number {
  const haystack = new Set(tokenize(`${preset.name ?? ''} ${preset.description ?? ''} ${preset.id}`))
  let score = 0
  for (const token of queryTokens) if (haystack.has(token)) score += 1
  return score
}

/**
 * Rank sessions for one query. Higher token overlap wins; ties go to the more
 * recently active session, then to the lexicographically smaller id. The input
 * is never mutated.
 * @param input - the text to route.
 * @param sessions - candidate sessions.
 * @returns the candidates, best match first.
 */
export function rankSessions(input: string, sessions: readonly RouteSession[]): readonly RouteSession[] {
  const queryTokens = new Set(tokenize(input))
  return sessions
    .map(session => ({ session, score: scoreSession(session, queryTokens) }))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      const byTime = right.session.updatedAt - left.session.updatedAt
      if (byTime !== 0) return byTime
      return left.session.id < right.session.id ? -1 : left.session.id > right.session.id ? 1 : 0
    })
    .map(entry => entry.session)
}

/**
 * Rank presets for one query by token overlap; ties break on the
 * lexicographically smaller id. The input is never mutated.
 * @param input - the text to route.
 * @param presets - candidate presets.
 * @returns the candidates, best match first.
 */
export function rankPresets(input: string, presets: readonly RoutePreset[]): readonly RoutePreset[] {
  const queryTokens = new Set(tokenize(input))
  return presets
    .map(preset => ({ preset, score: scorePreset(preset, queryTokens) }))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      return left.preset.id < right.preset.id ? -1 : left.preset.id > right.preset.id ? 1 : 0
    })
    .map(entry => entry.preset)
}

/**
 * Choose the best target for one free-form input. A session wins when its
 * overlap score is at least a preset's, so an existing context is preferred
 * over composing a new one at equal evidence. No token overlap with any
 * candidate is a no-match (`undefined`), which the board reports rather than
 * dispatching to an arbitrary target.
 * @param input - the text to route.
 * @param options - the loaded sessions and selectable presets.
 * @returns the winning target with its score, or undefined when nothing matches.
 */
export function routeIntent(input: string, options: RouteIntentOptions): RouteTarget | undefined {
  const queryTokens = new Set(tokenize(input))
  if (queryTokens.size === 0) return undefined
  const session = rankSessions(input, options.sessions)[0]
  const preset = rankPresets(input, options.presets)[0]
  const sessionScore = session === undefined ? 0 : scoreSession(session, queryTokens)
  const presetScore = preset === undefined ? 0 : scorePreset(preset, queryTokens)
  if (session !== undefined && sessionScore > 0 && sessionScore >= presetScore) {
    return { kind: 'session', session, score: sessionScore }
  }
  if (preset !== undefined && presetScore > 0) return { kind: 'preset', preset, score: presetScore }
  return undefined
}