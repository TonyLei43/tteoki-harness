/** OpenAI-compatible embeddings client (LM Studio, Ollama, OpenAI, …). */

import type { MemorySettings } from './types.ts'

/** Maximum texts submitted in one embeddings request. */
const BATCH_SIZE = 64

/** Embedding response envelope. */
interface EmbeddingsResponse {
  readonly data: readonly { readonly embedding: readonly number[]; readonly index?: number }[]
}

/** Models response envelope. */
interface ModelsResponse {
  readonly data: readonly { readonly id: string }[]
}

/**
 * Build request headers, adding a bearer token only when a key is configured.
 * @param apiKey - stored API key, or empty for keyless local servers.
 * @returns headers for the embeddings endpoint.
 */
function headers(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...apiKey === '' ? {} : { authorization: `Bearer ${apiKey}` },
  }
}

/**
 * Read the failure body for one response.
 * @param response - failed response.
 * @returns a short diagnostic.
 */
async function failure(response: Response): Promise<Error> {
  let detail = ''
  try {
    detail = (await response.text()).slice(0, 500)
  } catch {
    // A body that cannot be read leaves the status as the whole diagnostic.
  }
  return new Error(`embeddings endpoint returned ${response.status}${detail === '' ? '' : `: ${detail}`}`)
}

/**
 * Embed a batch of texts through one OpenAI-compatible endpoint.
 * @param settings - endpoint and model.
 * @param apiKey - resolved API key, or empty for a keyless server.
 * @param texts - texts to embed.
 * @param signal - caller cancellation.
 * @returns one vector per input, in input order.
 */
export async function embedTexts(
  settings: Pick<MemorySettings, 'baseUrl' | 'model'>,
  apiKey: string,
  texts: readonly string[],
  signal: AbortSignal,
): Promise<Float32Array[]> {
  if (texts.length === 0) return []
  const response = await fetch(`${settings.baseUrl}/embeddings`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ model: settings.model, input: texts }),
    signal,
  })
  if (!response.ok) throw await failure(response)
  const payload = await response.json() as EmbeddingsResponse
  const vectors = [...payload.data]
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map(entry => Float32Array.from(entry.embedding))
  if (vectors.length !== texts.length) {
    throw new Error(`embeddings endpoint returned ${vectors.length} vectors for ${texts.length} inputs`)
  }
  return vectors
}

/**
 * Embed any number of texts, batched to bound one request.
 * @param settings - endpoint and model.
 * @param apiKey - resolved API key.
 * @param texts - texts to embed.
 * @param signal - caller cancellation.
 * @returns one vector per input, in input order.
 */
export async function embedAll(
  settings: Pick<MemorySettings, 'baseUrl' | 'model'>,
  apiKey: string,
  texts: readonly string[],
  signal: AbortSignal,
): Promise<Float32Array[]> {
  const out: Float32Array[] = []
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    signal.throwIfAborted()
    out.push(...await embedTexts(settings, apiKey, texts.slice(start, start + BATCH_SIZE), signal))
  }
  return out
}

/**
 * List the model ids one endpoint advertises.
 * @param settings - endpoint.
 * @param apiKey - resolved API key.
 * @param signal - caller cancellation.
 * @returns advertised model ids.
 */
export async function listModels(
  settings: Pick<MemorySettings, 'baseUrl'>,
  apiKey: string,
  signal: AbortSignal,
): Promise<string[]> {
  const response = await fetch(`${settings.baseUrl}/models`, { headers: headers(apiKey), signal })
  if (!response.ok) throw await failure(response)
  const payload = await response.json() as ModelsResponse
  return payload.data.map(entry => entry.id).sort()
}
