---
description: "Prices page for the dsh web client: the DeepSeek off-peak clock, the DeepSeek token price table, and a searchable OpenRouter model catalog."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-prices

## Summary

Open **Prices** to see DeepSeek's off-peak clock and token rates beside the OpenRouter catalog. The off-peak clock shows **Off-peak — 50% off** or **Peak**, a live countdown to the next transition, the UTC peak windows, and the host timezone. The DeepSeek table lists flash and pro with cache-hit input, cache-miss input, and output at off-peak and peak. The OpenRouter list is searchable by id or name, sorted by name, and shows input and output (plus cache read/write when present); a refresh re-reads it.

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

Select **Prices** in Settings for the summary and a jump to the panel, or open the **Prices** sidebar entry. The panel renders:

- **Off-peak clock** — the current DeepSeek state, a countdown ticking locally from the host's next-transition instant, the UTC peak windows, and the host timezone.
- **DeepSeek token prices** — flash and pro, each cell showing the off-peak and peak USD per 1M tokens.
- **OpenRouter models** — a case-insensitive search over id and name, each row showing input and output plus cache read/write when present, and a refresh action. A failed fetch shows an unavailable notice.

The clock recomputes its countdown from `changeAt`, so it is correct in the user's timezone; the fixed UTC windows are labeled as UTC.

-----


<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser half registers one `settings.section` entry, one `main` keyed panel, and one `sidebar.panellist` entry, all under the `prices` locale namespace. Its inject face calls `remote.prices.deepseek`, `status`, and `openRouterModels`, mapping failures to thrown errors. The panel keeps the loaded card, catalog, search text, refreshing flag, and a one-second ticker in component-local state; there is no store. `clock.ts` owns the countdown and price formatting, and `catalog.ts` owns the search sort. The node half is an empty Loader seat.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [prices](../../../packages/external/prices/README.md) — the service this page renders.
- [ui-memory](../ui-memory/README.md) — a sibling settings section.
- [ui-settings](../ui-settings/README.md) — the settings domain base declaring `settings.section`.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side prices surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Countdown ticks a second** — the remaining time updates once per second, so the displayed second can lag a boundary by up to one tick.
- **Whole-catalog search** — the OpenRouter list is filtered client-side; a very large catalog is re-sorted on every keystroke.
- **Runtime invariant:** No companion is published. The section and panel read Remote snapshots and own no independent state relation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
