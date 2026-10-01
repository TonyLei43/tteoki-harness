---
description: "Per-preset model bindings: bind a provider/model route to an agent preset, consulted when an agent is created."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-models

## Summary

Bind a model route to an agent preset so each of your agents runs the model you choose, instead of the single process-wide default. Bindings live in the harness home, so agent identity never rewrites preset YAML and survives upgrades. Agent creation consults the binding first and falls back to the default, so a deployment without this package behaves exactly as before.

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

Mount the plugin in a profile that composes agent presets. The Web **Agents** settings section drives it through the `agentModels` Remote namespace. A consumer resolves a preset's route through the in-process `resolveFor`, wrapped in `ctx.get` so the dependency stays optional.

| Field | Default | Meaning |
|---|---|---|
| `home` | `$DSH_HOME` | Harness home override; the binding store resolves under it. |

The store is `agent-models.json` under the harness home: `{ version, bindings }`, where each binding is a `{ provider, model, reasoningEffort? }` route keyed by preset id.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The service reads the store synchronously at construction so agent creation resolves a preset without awaiting I/O on the request path. `setPreset` normalizes the route, updates the in-memory map, and writes the file; an empty preset id or an incomplete route is refused with a bad-request Remote error. `agent-session-controller` consults the binding through a structural resolver, so this package registers no contract on the session path.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [agent-preset](../agent-preset/README.md) — the agent identity the binding is keyed by.
- [agent-preset-registry](../agent-preset-registry/README.md) — the preset roster the Agents page lists.
- [agent-default-model](../../core/agent-default-model/README.md) — the process-wide default a binding overrides.
- [ui-agents](../../client/ui-agents/README.md) — the Web section that edits bindings.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package stores bindings a consumer reads; it assembles no request and registers no model surface.

#### KV Cache effect

Changing a binding affects only agents created afterwards; an existing session whose request log already names a route keeps it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Bindings are not validated against the catalog** — an unknown route is stored and surfaces when the provider rejects the request.
- **One route per preset** — a preset cannot vary its model per session; per-session selection still overrides it where the entry point supports one.
- **Runtime invariant:** No companion is published. The binding map is the only state, and resolution reads it directly.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
