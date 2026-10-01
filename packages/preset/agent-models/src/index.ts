/**
 * Per-preset model bindings. Users bind a provider/model route to an agent
 * preset; agent creation consults the binding before the process-wide default.
 * Bindings live in the harness home, so agent identity never rewrites preset
 * YAML and survives upgrades.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import type { AgentModelBinding, AgentModelSetRequest, AgentModelsValue } from './types.ts'

export type * from './types.ts'

/** Persisted file shape. */
interface AgentModelsFile {
  readonly version: 1
  readonly bindings: Record<string, AgentModelBinding>
}

/** Installer deployment policy. */
export interface Config {
  /** Harness home override; defaults to the resolved DSH home. */
  readonly home?: string
}

/**
 * Read the persisted bindings synchronously so agent creation can resolve a
 * preset without awaiting I/O on the request path.
 * @param file - absolute binding-store path.
 * @returns stored bindings, or an empty map when absent or unreadable.
 */
function readBindings(file: string): Record<string, AgentModelBinding> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as AgentModelsFile
    return { ...parsed.bindings }
  } catch {
    // A missing or unreadable store is empty state, not a request failure.
    return {}
  }
}

/**
 * Normalize one submitted binding.
 * @param selection - submitted provider/model/effort.
 * @returns the stored binding.
 * @throws RemoteError when the route is incomplete.
 */
function normalize(selection: AgentModelBinding): AgentModelBinding {
  const provider = selection.provider.trim()
  const model = selection.model.trim()
  if (provider === '' || model === '') {
    throw new RemoteError('gateway/bad-request', 'a provider and model are required', {})
  }
  const effort = selection.reasoningEffort?.trim()
  return { provider, model, ...effort === undefined || effort === '' ? {} : { reasoningEffort: effort } }
}

/** Remote service owning per-preset model bindings. */
export class AgentModels extends TypertRemoteService {
  static Config: z<Config> = z.object({ home: z.string() })

  private readonly file: string
  private bindings: Record<string, AgentModelBinding>

  /** @param ctx - Host context. @param config - harness home override. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'agentModels')
    this.file = join(config.home ?? resolveDshHome(), 'agent-models.json')
    this.bindings = readBindings(this.file)
  }

  /**
   * List every stored binding.
   * @returns bindings keyed by preset id.
   */
  @Remote('list')
  async list(): Promise<AgentModelsValue> {
    return { bindings: { ...this.bindings } }
  }

  /**
   * Bind or clear one preset's model route.
   * @param request - preset identity and the binding to store, or null to clear.
   * @returns the updated binding map.
   * @throws RemoteError when the preset id or route is invalid.
   */
  @Remote('setPreset')
  async setPreset(request: AgentModelSetRequest): Promise<AgentModelsValue> {
    const preset = request.preset.trim()
    if (preset === '') {
      throw new RemoteError('gateway/bad-request', 'a non-empty preset id is required', {})
    }
    const next = { ...this.bindings }
    if (request.selection === null) delete next[preset]
    else next[preset] = normalize(request.selection)
    this.bindings = next
    await writeFile(
      this.file,
      `${JSON.stringify({ version: 1, bindings: next } satisfies AgentModelsFile, null, 2)}\n`,
      'utf8',
    )
    return { bindings: { ...next } }
  }

  /**
   * Resolve a preset's bound route, for agent creation.
   * @param preset - preset identity, or undefined when none applies.
   * @returns the bound route, or undefined to fall through to the default.
   */
  resolveFor(preset: string | undefined): AgentModelBinding | undefined {
    return preset === undefined ? undefined : this.bindings[preset]
  }
}

export default AgentModels
