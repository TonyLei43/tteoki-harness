---
description: "Profile settings section for the dsh web client: a local display name and round avatar shown in the sidebar banner."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-profile

English

## Summary

Open **Profile** in Settings to set the name and picture shown in the sidebar banner. The values are stored in the browser, so the banner shows a round avatar and your name instead of a generic icon. Pick any image; it is stored as a data URL and rendered round.

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

Select **Profile** in Settings, type a display name, and choose a picture. The sidebar account banner reads the same values and shows the round avatar with the name beside it; with no avatar it shows the name's first letter, and with no name it falls back to the account menu's neutral icon.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser half registers one `settings.section` entry and its locale dictionary. The profile lives in browser `localStorage` under two keys; both this section and the sidebar account banner read the same keys and subscribe to the same `dsh-profile-change` event, so the two plugins stay decoupled. The renderer hook is bound from an `inject` hook compartment over a cached snapshot, so its reference stays stable between writes. The node half is an empty Loader seat.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings-account](../ui-settings-account/README.md) — the account banner that renders the local profile.
- [ui-settings](../ui-settings/README.md) — the settings domain base declaring `settings.section`.
- [ui-skin](../ui-skin/README.md) — the deployment skin that owns brand presentation.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Browser-local** — the profile lives in this browser's `localStorage`, so another browser or device shows its own values.
- **No downscaling** — an oversized image is rejected rather than resized.
- **Runtime invariant:** No companion is published. The section reads and writes one storage record and owns no independent state relation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
