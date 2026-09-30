/**
 * Status pill: one capsule naming a session's live state. The vocabulary is
 * `running` (pulses), `retrying`, `needs-feedback`, `idle`, `done`, and `error`
 * (solid danger fill); colors ride theme tokens only. Labels arrive already
 * localized, so a host that owns its own state names can render the pill.
 *
 * Feature plugins cannot import another feature plugin's values, so a second
 * consumer promotes this component into ui-primitives. See the package README.
 */

import css from './StatusPill.module.css'

/** The pill's state vocabulary; each state selects one palette. */
export type StatusPillState = 'running' | 'retrying' | 'needs-feedback' | 'idle' | 'done' | 'error'

/** Props of the status pill; the render site owns every word. */
export interface StatusPillProps {
  /** The state; selects the palette and the running animation. */
  readonly state: StatusPillState
  /** Already-localized state name. */
  readonly label: string
  /** Already-localized trailing detail, e.g. a retry attempt or message. */
  readonly detail?: string | undefined
}

/**
 * Render one status pill: a state-colored dot plus the given label, with an
 * optional trailing detail fragment.
 * @param props - the state and the localized label/detail words.
 * @returns the pill.
 */
export function StatusPill({ state, label, detail }: StatusPillProps) {
  return (
    <span className={css.pill} data-state={state}>
      <span className={css.dot} aria-hidden={true} />
      <span className={css.label}>{label}</span>
      {detail === undefined ? null : <span className={css.detail}>{detail}</span>}
    </span>
  )
}