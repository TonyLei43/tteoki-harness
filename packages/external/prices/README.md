---
description: "DeepSeek and OpenRouter token price catalog: the static DeepSeek rate card with its off-peak clock plus a cached normalized OpenRouter model list, over the generated prices Remote namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-prices

## Summary

Serve token prices to the Web client. The service carries DeepSeek's static rate card in USD per 1M tokens and computes its **off-peak clock**: peak hours are 01:00-04:00 and 06:00-10:00 UTC on weekdays, weekends are off-peak all day, and off-peak prices are half the peak prices. It also fetches OpenRouter's public `/models` catalog, normalizes each row to USD per 1M tokens, and caches the result. Browsers read both through the generated `prices` Remote namespace; the [Prices page](../../client/ui-prices/README.md) is the shipped consumer. The service holds no filesystem state.

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

Insert the plugin row (`@deepseek-ai/dsh-prices`) into a bundle to serve the `prices` Remote namespace. Methods: `deepseek` returns the rate card, the off-peak windows, and the current state; `status` returns the off-peak flag, the next transition instant, and the host timezone; `openRouterModels` returns the normalized OpenRouter catalog. Failures surface as `RemoteError` with the codes `prices/unavailable`, `prices/request-failed`, and `prices/bad-response`.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `openRouterBaseUrl` | `https://openrouter.ai/api/v1` | OpenRouter API base; the service appends `/models`. The endpoint is public and needs no key. |
| `requestTimeoutMs` | `20000` | Caller-facing timeout for one OpenRouter request. |
| `refreshMs` | `3600000` | Cache TTL for the OpenRouter list. |

### Off-peak clock

Peak pricing applies inside the two UTC windows on weekdays only; every other instant is off-peak, and off-peak prices are half the peak prices. The weekday is read on the UTC calendar because both windows close before 16:00 UTC, so no local calendar shift can move them. `deepseekOffPeak` is the one pure transition function: it classifies an epoch-ms instant and returns the next peak/off-peak edge.

-----


<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`Prices` extends `TypertRemoteService` and holds three resolved config values plus one OpenRouter cache entry `{ at, models }`. `schedule.ts` owns the peak windows and `deepseekOffPeak`; `rates.ts` owns the static card; `openrouter.ts` validates the `/models` payload with Zod and scales each per-token decimal to USD per 1M tokens. A transport, HTTP, JSON, or schema failure throws the matching named `RemoteError`. The generated artifacts (`./typert`, `./remote`) come from the Typert build step.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-prices](../../client/ui-prices/README.md) — the Web page that renders this namespace.
- [typert-protocol](../../typert/protocol/README.md) — the `@Remote` service contract this class extends.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package serves a browser price catalog and registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Static DeepSeek card** — the rate card is compiled in; a vendor price change needs a code change and a rebuild.
- **Whole-catalog cache** — one TTL covers every OpenRouter row; there is no per-model refresh.
- **Runtime invariant:** No companion is published. The OpenRouter cache is derived from the public endpoint and re-read on expiry, and the DeepSeek card is a constant.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
