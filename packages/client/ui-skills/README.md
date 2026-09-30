---
description: "Skills settings section for the dsh web client: lists every skill the host composition can load."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skills

## Summary

Open **Skills** in Settings to see every skill the host composition can load, sorted by name with its routing description, discovery source, and whether the model, the user, or both may invoke it. The list reads the `skills` Remote namespace, so it works without an open Session and never touches the filesystem from the browser. Choose it when users need one place to inspect the installed skills.

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

Select **Skills** in Settings. The section loads the inventory once through the `skills` Remote namespace's `inventory` method and offers a search field that filters the loaded rows by name and description locally. A composition that mounts no skill registry reports a load failure rather than an empty catalog.

### What the list shows

Each row carries the kebab-case skill name, its description, the discovery source and owning provider, and a **Model** or **User** badge for each surface the skill is invocable from. The list is sorted by name; the source label is prompt-visible discovery metadata, not precedence.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser half registers one `settings.section` entry and its locale dictionary. Its inject face exposes a single `load` callback that calls `ctx.remote.skills.inventory()` and maps a failed `RemoteResult` to a thrown error; the component keeps the rows, phase, and search query as component-local state, so no store or subscription machinery is involved. The node half is an empty Loader seat.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [skills subsystem](../../../docs/subsystems/skills.md) — the registry, providers, and local discovery priority.
- [ui-skill](../ui-skill/README.md) — the `/` slash-command skill references over the session catalog.
- [ui-settings](../ui-settings/README.md) — the settings domain base declaring `settings.section`.
- [ui-settings-plugins](../ui-settings-plugins/README.md) — another `settings.section` registrant to compare.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Read-only** — the section lists skills but neither installs nor removes them; skill sets arrive through the filesystem roots the skill provider scans.
- **Host layer only** — the inventory is the registry's global layer, so skills that exist only inside a Session's project or preset scope are not listed.
- **Runtime invariant:** No companion is published. The section reads one Remote snapshot and owns no independent state relation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
