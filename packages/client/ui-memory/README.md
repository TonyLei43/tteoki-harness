---
description: "Memory settings section and Knowledge page for the dsh web client: knowledge workspaces, embedding and chat endpoints, indexing, test search, memory notes, and per-result source previews."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-memory

## Summary

Open **Memory** in Settings to point the knowledge base at an embedding endpoint, define **knowledge workspaces**, index your notes and documents, and test search — all in one place. Embedding and graph-extraction endpoints are configurable, so you can embed through a cloud API and extract locally (or run both on LM Studio/Ollama). Index status shows documents, chunks, entities, and relations. The **Knowledge** page searches the indexed bases and keeps memory notes; clicking a search result previews its source file in a pane on the right.

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

Select **Memory** in Settings. The page loads the current settings and index status, then offers:

- **Embedding endpoint** — base URL (with local/cloud presets), embedding model (load the endpoint's advertised models), API key, graph model, and the graph-extraction toggle.
- **Knowledge workspaces** — add, rename, remove, and point each workspace at folders (one path per line), then index a single workspace.
- **Indexing** — **Index all** runs the configured workspaces and refreshes the status counts.
- **Test search** — query the knowledge base and see the matching passages and related entities.

Saving settings persists them through the memory service; a changed document is re-indexed on the next run.

On the **Knowledge** page, search from the spotlight bar and filter with the knowledge-base pills (or **All**); before a search, a card per knowledge base shows its document count and description and filters on click. Each result card shows a file-type tag, its file and section, its knowledge base and folder, a five-cell match meter, and the passage with math rendered; click a result's title to preview its source on the right. **List | Map** switches the results to a map: the query in the center, the folders the matches come from around it, and each matching document on the outer ring, labeled by section; opening a document's source in the map previews it. Clicking a knowledge base's card (or **Browse … files** beside the pills once one is selected) opens its file browser: every indexed file grouped two folders below its source root (collapsible, with counts), a name-or-folder filter that opens every matching group, file-type chips with counts, and per-file type, name, deeper folders, modification day, and indexed passage count; clicking a file previews it on the right (page 1 of a PDF or Notability note, else its text), **Index** re-indexes that knowledge base and reloads the list, and **← Knowledge** returns to search. The preview pane has two tabs: **Notes** lists and edits the selected base's memory notes, and **Preview** renders the selected result as Markdown, preformatted text, or a rendered page image. The whole-document text is read through the current session; without a session, or for a file with no readable text, the pane shows the indexed passage instead.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser half registers the Memory `settings.section`, the Knowledge `main` panel with its sidebar entry, and their locale dictionaries. The Memory section's inject face calls `remote.memory.getSettings`, `status`, `setSettings`, `listModels`, `index`, and `search`; the Knowledge face adds `listDocuments`, `listNotes`, `readNote`, `writeNote`, `previewPage`, and `readDocument` (paged `remote.workspaceFiles.read`). Failures map to thrown errors, except a preview read, which degrades to the indexed passage. Draft settings, status, discovered models, busy phase, error flag, search results, the notes draft, and the selected preview are component-local state; there is no store. The node half is an empty Loader seat.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [memory](../../../packages/memory/memory/README.md) — the service this page configures.
- [ui-settings-models](../ui-settings-models/README.md) — where provider API keys and models are configured.
- [ui-settings](../ui-settings/README.md) — the settings domain base declaring `settings.section`.
- [ui-skills](../ui-skills/README.md) — a sibling Settings section to compare.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Single embedding model per index** — changing the model requires a rebuild, which this page does not automate.
- **No per-file progress** — an index run reports counts and failures when it finishes.
- **Preview is read-only and text-first** — the Knowledge preview renders Markdown, preformatted text, and page images; images, Office documents, and spreadsheets fall back to the indexed passage, and no preview is editable.
- **Whole-document previews need a session** — without a current session the pane shows the indexed passage; the source text is read through the current session's workspace filesystem, which may differ from where the memory service indexed it.
- **Runtime invariant:** No companion is published. The section reads Remote snapshots and owns no independent state relation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
