/**
 * Agents settings section, node half.
 *
 * The section is browser presentation only: it reads presets and the model
 * catalog, and writes per-preset model bindings, through generated Remote
 * namespaces. Host Loader needs an inert entry, so the node half registers nothing.
 */

/** Host plugin body — the agents list is a browser half. */
export function apply(): void {}
