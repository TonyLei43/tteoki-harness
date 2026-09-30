---
description: "Agents settings section for the dsh web client: lists agent presets and binds each one's model route."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agents

## Summary

Open **Agents** in Settings to see every composed agent preset and choose which model each one runs. A preset with no binding uses the process-wide default, so the page shows **Default** until you pick a route. The picker is fed by the live model catalog, so any configured provider's models are selectable.

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

Select **Agents** in Settings. The section loads the preset roster, the live model catalog, and the current bindings, then renders one row per preset: its name, id or description, and a route picker. Choosing a route stores the binding; choosing **Default** clears it. The Host applies the binding when it creates an agent for that preset, so a change affects agents created afterwards.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser half registers one `settings.section` entry and its locale dictionary. Its inject face loads the roster through `remote.agentPresets.list`, the catalog through `remote.session.modelCatalog`, and bindings through `remote.agentModels.list`, mapping them to presentational rows and a flattened provider/model option list; saving calls `remote.agentModels.setPreset`. Rows, options, bindings, and the busy and error flags are component-local state. The node half is an empty Loader seat.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [agent-models](../../../packages/preset/agent-models/README.md) — the binding store this page writes.
- [agent-preset-registry](../../../packages/preset/agent-preset-registry/README.md) — the preset roster.
- [ui-settings-models](../ui-settings-models/README.md) — where providers and API keys are configured.
- [ui-settings](../ui-settings/README.md) — the settings domain base declaring `settings.section`.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Route picker only** — the page sets provider and model; a per-preset reasoning effort is not offered here.
- **No custom-agent authoring** — presets are defined in the profile; the page binds a model to existing presets.
- **Runtime invariant:** No companion is published. The section reads Remote snapshots and owns no independent state relation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
