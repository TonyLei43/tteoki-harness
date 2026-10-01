---
description: "The external group map: host services that project outside data sources into the harness over typed Remote namespaces."
kind: "package-group"
---

# external/ — external service bridges

## Summary

The external group connects the harness to outside services running beside it. `dsh-prices` serves DeepSeek's static rate card with its off-peak clock and a cached normalized OpenRouter model list; `dsh-client-ui-prices` renders both as the Web Prices page. Each bridge keeps the peer service's own API at the wire edge: the bridge adapts, it does not proxy.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`prices/`](prices/README.md) | Serves the DeepSeek rate card with its off-peak clock and a cached OpenRouter catalog over the `prices` Remote namespace | `ctx.prices` |
| [`../../client/ui-prices/`](../client/ui-prices/README.md) | Web Prices page: off-peak clock, DeepSeek token table, and searchable OpenRouter list | — |

<a id="related-documentation"></a>
## Related documentation

- [Prices package](prices/README.md) — the rate card, off-peak clock, and OpenRouter catalog contract.
- [Prices page package](../client/ui-prices/README.md) — the Web surface over the namespace.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The group has no `docs/subsystems/` page: each bridge's contract stays with the peer service's own API, and the package README owns the seam. A second bridge joins as a sibling package with its own Remote namespace, types, and Web board package.

</details>