/**
 * Skills settings section, node half.
 *
 * The section is browser presentation only: it reads the host skill inventory
 * through the generated `skills` Remote namespace. Host Loader needs an inert
 * entry, so the node half registers nothing.
 */

/** Host plugin body — the skills list is a browser half. */
export function apply(): void {}
