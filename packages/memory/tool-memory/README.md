---
description: "Model-facing knowledge-base search and memory-note tools, scoped to the knowledge bases one agent preset may reach."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-memory

## Summary

Gives an agent tools over the [memory](../memory/README.md) service: passage search, re-indexing, and named memory notes. Each mount is scoped to a list of knowledge bases, so a preset for one knowledge base cannot read or write another, and an orchestrator preset can reach all of them.

## Use this package

Mount it inside an agent preset, next to a host-plane `@deepseek-ai/dsh-memory` row.

```yaml
- id: tool-memory
  name: '@deepseek-ai/dsh-tool-memory'
  config:
    knowledgeBases: [academic]   # or ['*'] for every configured knowledge base
```

| Field | Default | Meaning |
|---|---|---|
| `knowledgeBases` | required | Knowledge-base ids this agent reaches; `'*'` reaches every configured one, including ones added later. |

Loading fails when the list is empty or names a knowledge base that is not configured. Every call checks its `knowledge_base` argument against the scope, so the schema is not the only enforcement.

## Model Experience

### `knowledge_search`, `knowledge_index`

#### What the model sees

`knowledge_search` takes a query and an optional result cap (clamped to 1–20) and returns ranked passages (source path, knowledge base, heading, text, score) plus related entities. `knowledge_index` re-indexes and returns document and skipped counts with each failure's path and reason. With one knowledge base in scope, the description names it and no `knowledge_base` parameter exists; with several, the description lists each knowledge base's id, name, and description, and an optional `knowledge_base` narrows the call.

### `memory_list`, `memory_read`, `memory_write`

#### What the model sees

Named Markdown notes in a knowledge base's memory. `memory_write` replaces the whole note, so the description tells the model to read an existing note and write merged content. With several knowledge bases in scope, `knowledge_base` is required and a call without it fails, naming the choices.

#### Token effect

The descriptions add five tool definitions; a multi-knowledge-base scope adds one catalog line per knowledge base to each. Results add the returned passages or note text.

#### KV Cache effect

The catalog is read from the memory settings when the preset loads, so the tool definitions stay fixed for a live agent; knowledge bases added later appear in agents created afterwards.

## Known Limitations and Deferred Work

- Subagents inherit their parent preset's tools, so an orchestrator cannot yet delegate to an agent confined to one knowledge base.
- **Runtime invariant:** No companion is published. The plugin holds no state beyond its configured scope; every call reads through the memory service.
