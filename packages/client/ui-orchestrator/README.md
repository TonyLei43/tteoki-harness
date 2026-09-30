---
description: "Native orchestrator board for the dsh web client: every DSH session grouped by project with status pills, plus one auto-router input that sends free-form text to the best native session or agent preset."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-orchestrator

## Summary

Open **Orchestrator** in the sidebar to see every DSH session on one board, grouped by project directory. Each row carries a **status pill** — `running` pulses, `needs-feedback` flags a pending approval or question, `done` marks an unacknowledged completion, and `idle` settles in between — and one prominent input **Ask anything — routes to the best agent** sends free-form text to the best native session or agent preset.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The package mounts one `main` keyed panel (key `orchestrator`), one `sidebar.panellist` entry that opens it, and one `orchestrator` locale dictionary. The board reads the client Session model through the framework's `useSessions` hook and the unified status facts through `useSessionStatus`; it makes no ad-hoc list Remote call and keeps no store.

Rows group by project directory with the directory-less group last. Inside a group, attention states lead (`needs-feedback`, then `error`, `retrying`, `running`, `done`, `idle`) and rows tie-break by most recent activity then id. Selecting a row opens that session's conversation through `ctx.uiWorkspace.openSession`.

The **auto-router** ranks every loaded session and agent preset against the input and dispatches to the winner:

- An existing session is prompted through `ctx.remote.session.prompt` and then opened.
- A preset with no matching session creates a new session through the client Session model, selects the preset through `ctx.remote.agentPresets.select`, then prompts it. The Host resolves the preset's bound model through the existing `agent-models` service at composition, so no model store is introduced here.
- No token overlap with any candidate shows a no-targets notice; a prompt or creation failure shows an error notice.

The **status pill** is a standalone component (`StatusPill`) local to this package: it takes a state, an already-localized label, and optional detail, and renders one of the six palettes with theme tokens only.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/client/router.ts` holds the pure, token-free classifier `routeIntent(input, { sessions, presets })` and its ranking helpers. `src/client/board.ts` folds the `SessionListState` and `SessionStatusSnapshot` snapshots into rows, groups them, and derives each row's pill state. Both modules are React-free, so the panel and its tests read the same functions.

The browser half registers the `main` keyed panel and the `sidebar.panellist` entry through `ctx.slots.inject`, after the layout and sidebar declare those slots. Its inject face maps `remote.agentPresets.list`, `sessions.create`, `remote.agentPresets.select`, `remote.session.prompt`, and `ctx.uiWorkspace.openSession` into the board actions; a failed Remote result becomes a thrown error that the board reports as a notice. Rows, the input draft, the routing phase, the routed target, and the notice are component-local state; there is no store. The node half is an empty Loader seat.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-workspace](../ui-workspace/README.md) — the session browser whose navigation (`ctx.uiWorkspace.openSession`) this board uses.
- [ui-session](../ui-session/README.md) — the adapter that binds `useSessions`/`useSessionStatus` and the unified status facts.
- [api/session-controller](../../api/session-controller/README.md) — the client Session model and the `session` Remote namespace this board drives.
- [Web client architecture](../../../docs/subsystems/web-client.md) — the layering this package follows.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side board that registers no model surface. It sends the user's free-form text verbatim as one prompt to a chosen session through the existing session Remote; it adds no system prompt, tool, or request field.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The built-in classifier is token overlap, not understanding** — `routeIntent` matches case-insensitive alphanumeric tokens against a session's title, project basename, and preset, then falls back to recency and id. A model-based classifier can be injected through the board's optional `classify` seam, but v1 requires no model call.
- **`error` and `retrying` are not derived by the board** — the list and unified status snapshots do not carry a per-session agent failure or retry cycle, so the board derives `running`, `needs-feedback`, `done`, and `idle` only; the pill supports the full vocabulary for callers that do have those facts.
- **Navigating away hides the routed notice** — opening the chosen session selects the conversation panel, so the board's "Routed to …" status line is only visible while the board stays mounted. The visible outcome in production is the opened conversation with the prompt sent.
- **Preset routing uses the Host default workspace** — a preset target with no matching session creates its session without inheriting a project directory.
- **The status pill is package-local** — feature plugins cannot import another feature plugin's values, so a second board that needs the pill promotes it into `ui-primitives`; see the Dev Note.
- **Runtime invariant:** No companion is published. The board owns only viewing and routing state; rows derive from the client Session model and the Remote answers.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The pill vocabulary (`running`, `retrying`, `needs-feedback`, `idle`, `done`, `error`) uses theme-token palettes and a reduced-motion guard. `ui-primitives` is the only sanctioned shared home for a control two feature plugins render, so a second consumer promotes the component there.

</details>