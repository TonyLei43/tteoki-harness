---
description: "The memory group map: a local knowledge base that indexes notes and documents into vectors and a knowledge graph, plus the Web surface that manages it."
kind: "package-group"
---

# memory/ — local knowledge base

## Summary

The memory group turns local notes and documents into a knowledge base agents can query. Use `dsh-memory` to index configured knowledge workspaces into local SQLite vectors and an extracted knowledge graph, and to expose the `knowledge_search` and `memory_index` tools; `dsh-client-ui-memory` is the Web settings surface that configures the endpoint, manages workspaces, runs indexing, and tests search.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Indexes workspaces into local vectors and a knowledge graph and exposes the search tools | `ctx.memory` |
| [`../../client/ui-memory/`](../client/ui-memory/README.md) | Web settings section for the endpoint, workspaces, indexing, and search | — |

<a id="related-documentation"></a>
## Related documentation

- [Memory package](memory/README.md) — the service contract, configuration, and Model Experience.
- [Third-party memory MCP guide](../../docs/user/guide/mcp-memory.md) — the alternative path of an external memory MCP server.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
