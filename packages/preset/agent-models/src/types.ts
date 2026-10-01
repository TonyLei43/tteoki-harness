/** Wire vocabulary for the per-agent model binding store. */

/** One preset's bound model route. */
export interface AgentModelBinding {
  /** Registered provider route the preset's agents use. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Adapter-owned reasoning effort, when the preset pins one. */
  readonly reasoningEffort?: string
}

/** Every preset binding, keyed by preset id. */
export interface AgentModelsValue {
  readonly bindings: Readonly<Record<string, AgentModelBinding>>
}

/** Bind or clear one preset's model route. */
export interface AgentModelSetRequest {
  /** Preset identity the binding applies to. */
  readonly preset: string
  /** Binding to store, or null to clear the preset's binding. */
  readonly selection: AgentModelBinding | null
}
