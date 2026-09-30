/** Knowledge-graph extraction through an OpenAI-compatible chat endpoint. */

import type { MemoryEntity } from './types.ts'

/** Extraction result for one document. */
export interface ExtractedGraph {
  readonly entities: readonly MemoryEntity[]
  readonly relations: readonly { readonly source: string; readonly target: string; readonly description: string }[]
}

/** System prompt: request strict JSON and keep extracted text tight. */
const SYSTEM = 'You extract a knowledge graph from text. Reply with JSON only: '
  + '{"entities":[{"name":string,"type":string,"description":string}],"relations":[{"source":string,"target":string,"description":string}]}. '
  + 'Entities are people, places, projects, concepts, or things; relations connect two entity names. Keep names as they appear, descriptions under 20 words. No prose.'

/** Chat completion response envelope. */
interface ChatResponse {
  readonly choices: readonly { readonly message?: { readonly content?: string } }[]
}

/** One empty graph, reused when extraction is disabled or fails. */
export const EMPTY_GRAPH: ExtractedGraph = { entities: [], relations: [] }

/**
 * Parse a JSON graph out of a model reply, tolerating markdown fences.
 * @param content - raw reply text.
 * @returns the parsed graph, or undefined when the reply is not a usable graph.
 */
export function parseGraph(content: string): ExtractedGraph | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content)
  const body = (fenced?.[1] ?? content).trim()
  try {
    const parsed = JSON.parse(body) as { entities?: unknown; relations?: unknown }
    if (!Array.isArray(parsed.entities) || !Array.isArray(parsed.relations)) return undefined
    const entities: MemoryEntity[] = []
    for (const raw of parsed.entities) {
      const entity = raw as { name?: unknown; type?: unknown; description?: unknown }
      if (typeof entity.name !== 'string' || entity.name.trim() === '') continue
      entities.push({
        name: entity.name.trim(),
        type: typeof entity.type === 'string' ? entity.type.trim() : 'thing',
        description: typeof entity.description === 'string' ? entity.description.trim() : '',
      })
    }
    const relations: { source: string; target: string; description: string }[] = []
    for (const raw of parsed.relations) {
      const relation = raw as { source?: unknown; target?: unknown; description?: unknown }
      if (typeof relation.source !== 'string' || typeof relation.target !== 'string') continue
      if (relation.source.trim() === '' || relation.target.trim() === '') continue
      relations.push({
        source: relation.source.trim(),
        target: relation.target.trim(),
        description: typeof relation.description === 'string' ? relation.description.trim() : '',
      })
    }
    return { entities, relations }
  } catch {
    // A non-JSON reply contributes no graph.
    return undefined
  }
}

/** One resolved OpenAI-compatible chat endpoint. */
export interface ChatEndpoint {
  /** Endpoint base URL without a trailing slash. */
  readonly baseUrl: string
  /** Chat model id. */
  readonly model: string
  /** API key, or empty for a keyless local server. */
  readonly apiKey: string
}

/**
 * Extract entities and relations from one document through a chat model.
 * @param endpoint - chat endpoint, model, and key.
 * @param text - document text; only the first 8000 characters are sent.
 * @param signal - caller cancellation.
 * @returns the extracted graph; an empty graph on any failure.
 */
export async function extractGraph(endpoint: ChatEndpoint, text: string, signal: AbortSignal): Promise<ExtractedGraph> {
  const apiKey = endpoint.apiKey
  const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...apiKey === '' ? {} : { authorization: `Bearer ${apiKey}` },
    },
    body: JSON.stringify({
      model: endpoint.model,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text.slice(0, 8000) },
      ],
    }),
    signal,
  })
  if (!response.ok) return EMPTY_GRAPH
  const payload = await response.json() as ChatResponse
  const content = payload.choices[0]?.message?.content
  return content === undefined ? EMPTY_GRAPH : parseGraph(content) ?? EMPTY_GRAPH
}

/** One chat message. */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant'
  /** Text, or text and image parts for a vision model. */
  readonly content: string | readonly ({ readonly type: 'text'; readonly text: string } | { readonly type: 'image_url'; readonly image_url: { readonly url: string } })[]
}

/** HTTP statuses a chat request is retried on: rate limited or temporarily unavailable. */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504])

/** Waits before each retry when the server sends no `Retry-After`. */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000]

/**
 * Wait, ending early on cancellation.
 * @param ms - milliseconds.
 * @param signal - caller cancellation.
 */
async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    const abort = (): void => { clearTimeout(timer); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
  })
}

/**
 * Run one chat completion, streamed so a slow local model cannot hit the
 * response-headers timeout; reasoning deltas are dropped and only answer text is kept.
 * HTTP 429 and 5xx responses are retried up to five times, honoring `Retry-After`.
 * @param endpoint - chat endpoint, model, and key.
 * @param messages - the conversation.
 * @param signal - caller cancellation.
 * @returns the reply text.
 * @throws Error naming the HTTP status, or when the reply has no text.
 */
export async function chatComplete(endpoint: ChatEndpoint, messages: readonly ChatMessage[], signal: AbortSignal): Promise<string> {
  let response: Response
  for (let attempt = 0; ; attempt += 1) {
    response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...endpoint.apiKey === '' ? {} : { authorization: `Bearer ${endpoint.apiKey}` } },
      body: JSON.stringify({ model: endpoint.model, temperature: 0, stream: true, messages }),
      signal,
    })
    // Rate limits and overloaded servers are retried; hosted OCR runs pages concurrently and hits per-minute limits.
    if (!RETRY_STATUSES.has(response.status) || attempt >= RETRY_DELAYS_MS.length) break
    await response.body?.cancel()
    const retryAfter = Number(response.headers.get('retry-after'))
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : RETRY_DELAYS_MS[attempt] ?? 0, signal)
  }
  if (!response.ok || response.body === null) throw new Error(`chat model returned HTTP ${response.status}`)
  let text = ''
  let pending = ''
  const decoder = new TextDecoder()
  const consume = (line: string): void => {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (data === '' || data === '[DONE]') return
    try {
      const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string | null }; message?: { content?: string | null } }[] }
      text += chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? ''
    } catch {
      // A malformed event line carries no answer text.
    }
  }
  for await (const bytes of response.body) {
    pending += decoder.decode(bytes, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) consume(line)
  }
  consume(pending)
  if (text.trim() === '') throw new Error('the chat model returned no text')
  return text
}
