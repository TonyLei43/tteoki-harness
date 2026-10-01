/**
 * Native DSH orchestration surface, node half.
 *
 * The surface is browser presentation only: it reads the client Session model
 * and the `session`/`agentPresets` Remote namespaces. Host Loader needs an inert
 * entry, so the node half registers nothing.
 */

/** Host plugin body — the orchestrator is a browser half. */
export function apply(): void {}