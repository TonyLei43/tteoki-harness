# Agent Note: Native DSH orchestration board

Status: proposed

English | [中文](2026-09-25-native-orchestration-board.zh.md)

## Problem

DSH ships sessions, agents, presets, and per-session status, but no single surface shows them together or routes a free-form request to the right one. A user who wants "just handle this" must open the workspace list, pick a session, or start a new one and choose a preset by hand.

The native facts already exist. The client Session model owns the catalog, running state, and per-session projections; the unified Session status snapshot carries pending interactions such as approvals; the `session` and `agentPresets` Remote namespaces create, prompt, and compose sessions; `resolveAgentSelection` already resolves a preset's bound model through the `agent-models` service at agent creation. What is missing is one composition that reads those facts and one classifier that chooses a target.

## Proposal

Add `@deepseek-ai/dsh-client-ui-orchestrator`, a browser plugin that contributes one `main` keyed panel (key `orchestrator`) and one `sidebar.panellist` entry. The panel is a board of native DSH sessions grouped by project directory, plus one prominent auto-router input.

The board reads the client Session model through the framework's `useSessions` hook and the unified status facts through `useSessionStatus`; it makes no ad-hoc list Remote call and keeps no store. Rows group by `SessionSummary.cwd` with the directory-less group last. Inside a group, status precedence leads (`needs-feedback`, then `error`, `retrying`, `running`, `done`, `idle`) and rows tie-break by most recent activity then id.

Each row's status derives from client facts alone: a pending interaction is `needs-feedback`, a running session is `running`, an unacknowledged completion is `done`, and everything else is `idle`. The list and status snapshots do not carry a per-session agent failure or retry cycle, so the board does not derive `error` or `retrying`; the shared pill still renders the full vocabulary for callers that have those facts. Selecting a row opens the session through `ctx.uiWorkspace.openSession`.

## Router classification

`src/client/router.ts` owns one pure function, `routeIntent(input, { sessions, presets })`. It is the default, token-free classifier:

1. Tokenize the input and each candidate's own words case-insensitively, splitting on non-alphanumerics.
2. A session's score is how many input tokens appear in its title, project-directory basename, and agent-preset name.
3. A preset's score is how many input tokens appear in its name, description, and id.
4. Rank sessions by score, then most recent `updatedAt`, then id; rank presets by score, then id.
5. The higher score wins; a session wins ties, preferring an existing context over composing a new one. Zero overlap with every candidate is a no-match, reported rather than dispatched.

The scorer is a documented pure seam, not a hardcoded policy: the panel's injected face accepts an optional `classify(input, options)` callback that replaces `routeIntent` and returns the same `RouteTarget`. A future local model, such as one served by LM Studio, can implement that callback. Version 1 requires no model call.

## Dispatch and model binding

The injected face maps each decision onto existing APIs:

- **Existing session** — prompt it through `ctx.remote.session.prompt` with a freshly minted request id, then open it.
- **Agent preset with no matching session** — create a blank session through the client Session model, select the preset through `ctx.remote.agentPresets.select`, then prompt the new session. Selecting the preset before the first turn is the existing binding path; the Host resolves the preset's bound model through the `agent-models` service when it composes the agent. No new model store is introduced, and the fork does not need to read bindings on the client.
- **No target or a send failure** — show a clear notice and do not navigate.

## Alternatives considered

**Ad-hoc `session.list` Remote calls instead of `useSessions`.** Rejected because the framework hook already owns the live catalog, status, and change propagation; a parallel read would duplicate the object layer and miss forwarded events.

**Read the preset's bound model on the client and call `session.selectModel`.** Rejected because the Host already resolves the binding through `agent-models` at composition; a client read would add a second source of truth for the same decision.

**Dispatch to the most recent session when nothing matches.** Rejected because a silent misroute is worse than a no-targets notice; the input stays in the box.

## Acceptance criteria

- The panel registers into `main` under key `orchestrator` and one `sidebar.panellist` entry opens it; disposing the plugin removes both.
- The board renders every non-subagent session grouped by project directory with a status pill derived from `SessionListState` and `SessionStatusSnapshot`; selecting a row calls `ctx.uiWorkspace.openSession`.
- `routeIntent` is pure and unit-tested for target selection, tie-breaks, and no-match; an injected `classify` callback replaces it without changing the dispatch contract.
- Submitting routes to the best session and prompts it through the session Remote, or creates and prompts a preset session through `agentPresets.select`; both paths report "routed to" and a failure or no-match shows a notice.
- No target or a failed send leaves the current view unchanged apart from the notice.

## Risks

Token overlap can misroute when two sessions share vocabulary; the recency tie-break favors the session most recently used, which is usually right but can be wrong for a stale topic. A model classifier can improve this only through the optional seam.

The board's row status misses agent failures and retry cycles, so an `error` session reads as `idle`. Closing that gap needs a per-session error fact on the list or status snapshot, or an injected per-session read.

Opening the chosen session selects the conversation panel, so the board unmounts and its "routed to" line is not visible afterward. The visible outcome is the opened conversation with the prompt sent; a durable routed notice would need the frame-wide overlay.

Rows build from the live catalog on every render. A very large catalog could make the board heavy; grouping and ordering are linear today, and virtualization is deferred until measured.