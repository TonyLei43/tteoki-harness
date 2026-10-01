---
description: "Model-facing agenda tool: the user's upcoming events and assignment deadlines from the connectors service."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-agenda

## Summary

Gives an agent an `agenda` tool over the [connectors](../connectors/README.md) agenda, so it can plan around the user's real classes and deadlines.

## Use this package

Mount it inside an agent preset, next to a Host-plane `@deepseek-ai/dsh-connectors` row. It has no configuration.

## Model Experience

### `agenda`

#### What the model sees

Optional `days` (1–60, default 7) and `kind` (`event` or `assignment`). The result lists overdue assignments from the last 30 days that are not submitted, graded, or excused, then every item in the window, one line each with the time in the user's time zone, course, location, points, status, and link, plus when the agenda last synced. With no sync yet, the result says the user can connect accounts in the Agenda panel.

#### Token effect

One line per item; a busy week is a few hundred tokens.

#### KV Cache effect

The description names the host time zone, fixed for a live agent.

## Known Limitations and Deferred Work

- **Runtime invariant:** No companion is published. The plugin holds no state.
