---
description: "Local knowledge bases: extract notes and documents, index each knowledge base into SQLite vectors and a knowledge graph through an OpenAI-compatible endpoint, and keep agent memory notes."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

## Summary

Turn your local notes and documents into a knowledge base your agents can query. The service indexes configured **knowledge bases** (named sets of folders, each with its own index and agent memory notes), chunks the text, embeds it through any **OpenAI-compatible** endpoint (LM Studio, Ollama, or a cloud API), and optionally extracts a **knowledge graph** of entities and relations. Search answers with the most relevant passages plus the entities they mention, so the model can connect facts across documents. Everything is stored locally in SQLite under the harness home.

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

Mount the service once in the host; it owns the `memory` Remote namespace the Web **Memory** page drives and the `ctx.memory` service. Model-facing tools come from [`@deepseek-ai/dsh-tool-memory`](../tool-memory/README.md), which each agent preset mounts with the knowledge bases its agent may reach.

### Knowledge bases, embedding, and the graph

A **knowledge base** (a `collections` entry) is a named set of folders with its own index and its own agent memory notes, stored under `$DSH_HOME/memory/kb/<id>/` (`index.db`, `memories/*.md`). The `memories/` folder is indexed with the sources, so saved notes are searchable. Removing a knowledge base from the settings stops indexing and searching it but keeps its directory. Embeddings always use `baseUrl` and `model`. Graph extraction uses `chatModel` on `baseUrl`, or `remoteChat` for knowledge bases whose `chat` is `remote`, so private knowledge bases can stay on a local server while others use a hosted API. Set `graphEnabled: false` to index vectors alone.

| Field | Default | Meaning |
|---|---|---|
| `baseUrl` | OpenAI | OpenAI-compatible endpoint (LM Studio `http://127.0.0.1:1234/v1`, Ollama `http://127.0.0.1:11434/v1`, …). |
| `model` | `text-embedding-3-small` | Embedding model. |
| `chatModel` | `gpt-4o-mini` | Chat model on `baseUrl` for `local` graph extraction. |
| `apiKey` / `apiKeyEnv` | — / `OPENAI_API_KEY` | Stored key, else the named environment variable; empty for a local server. |
| `remoteChat` | unset | `{ baseUrl, model, apiKeyEnv }` of a hosted chat endpoint; the key is read from the environment and never stored. |
| `graphEnabled` | `true` | Extract entities and relations while indexing. |
| `collections` | `[]` | Knowledge bases: `{ id, name, sources[], description?, chat? }`. `id` uses letters, digits, `-`, `_`; `description` is shown to agents that reach several; `chat` is `local` (default) or `remote`, which requires `remoteChat`. |
| `chunkChars` / `overlapChars` | `1200` / `200` | Chunk size and oversize-block overlap. |
| `topK` | `6` | Default result count. |
| `excludeDirs` | `node_modules`, `site-packages`, `venv`, `env`, `__pycache__`, `build`, `dist`, `target` | Directory names never scanned; hidden entries (`.obsidian`, `.venv`, `.git`) are always skipped. |
| `maxDocumentChars` | `2000000` | A document whose extracted text is longer fails instead of indexing; also the largest memory note. |

Settings live in `$DSH_HOME/memory/config.json`. Indexing a `remote` knowledge base with the graph enabled fails before reading any document when the `remoteChat.apiKeyEnv` variable is unset.

`listDocuments({ collection })` lists one knowledge base's indexed documents (path, source modification time, chunk count, by path) with its roots: its source folders and its memory-notes folder.

### Ingestion pipeline

Each document is read by the **extractor** that claims its suffix. Built in: Markdown (`.md`, `.markdown`; Obsidian front matter, `%%comments%%`, and `[[links]]` are reduced to visible text), plain text (`.txt`, `.bib`), and LaTeX (`.tex`, `.ltx`; the document body with sections as headings). Other plugins add extractors with `ctx.memory.registerExtractor(extractor)`, which returns the disposer; a file extractor claims file suffixes and a bundle extractor claims directory suffixes read as one document. Two extractors claiming one suffix fail at registration. A document re-indexes when its extractor's id, version, or fingerprint (the file bytes by default) changes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Indexing walks each knowledge base's folders and `memories/`, chunks markdown by heading and paragraph, embeds in batches, and upserts the document, its chunks, vectors, and graph contributions in one transaction. Each knowledge base has its own SQLite database; entities are unique by name within it; chunks link to entities through `mentions`, and relations connect entity names. Search embeds the query once, ranks each selected knowledge base's vectors by cosine similarity (a personal-scale index needs no vector extension), merges the hits by score, then expands the top chunks through each database's `mentions` and one-hop `relations`. Scores are comparable across knowledge bases because every one uses the same embedding model. A schema-version bump recreates the disposable local index.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-memory](../../client/ui-memory/README.md) — the Web page that configures and indexes this service.
- [mcp-memory guide](../../../docs/user/guide/mcp-memory.md) — the alternative path of an external memory MCP server.
- [tool-skill](../../skill/tool-skill/README.md) — the sibling pattern of a durable session catalog.
- [home-paths](../../util/home-paths/README.md) — how the harness home resolves.

-----

<a id="model-experience"></a>
## Model Experience

None directly: the service registers no tools and no prompt text. [`dsh-tool-memory`](../tool-memory/README.md) documents the model-facing tools built on it.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Brute-force cosine search** — every vector is scored per query; a very large index trades latency for zero dependencies.
- **Graph extraction is best-effort** — a failed or non-JSON chat reply indexes the document's vectors without its graph, and extraction cost scales with document length.
- **One embedding model for every knowledge base** — switching models changes vector dimensions, so every index must be rebuilt; cross-knowledge-base ranking relies on the shared model.
- **The pre-knowledge-base `index.db`** directly under `$DSH_HOME/memory` is no longer read; delete it once the per-knowledge-base indexes are built.
- **Runtime invariant:** No companion is published. The settings store, the per-knowledge-base SQLite indexes, and the memory-note files are the only state, and reads re-derive them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
