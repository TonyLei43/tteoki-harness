---
description: "Knowledge Sources card for the dsh web client: under every grounded answer, the notes the model was given, with passages, page previews, and file opening."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-knowledge-sources

## Summary

Shows where a grounded answer came from. For each Turn in which the [knowledge-context](../../memory/knowledge-context/README.md) plugin logged a grounding message, a **From your notes** card renders in the Chat Turn tail (`conversation.chat.turnTail`, order 5): one chip per passage with its citation label (`K1`, …), file name, page, and folder. Opening a chip shows the passage with its math rendered, the match percentage, **Show page** (a rendered page image from `memory/previewPage`) for PDFs and Notability notes, and **Open file**. An empty search reads "Your notes had nothing on this"; a failed one shows the error.

It also draws the `mind_map` tool's maps ([tool-mind-map](../../memory/tool-mind-map/README.md)): each map a Turn made renders in the Turn tail (order 4, above the Sources card), where the Chat does not fold it into the work details, as an interactive radial map with **Expand** for a full-window view; clicking a concept shows its detail and sources, and file-path sources open the file. Inside the work details the call reads as one line.

## Use this package

Mount it in the Client plane with ui-chat and the `memory` Host service. The card reads the logged `knowledge-context` source through a Turn-scoped Conversation Definition, so reloads and replays show the same card with no Host call; every source field is validated because the log may come from any version.

## Model Experience

None. The card only presents what the grounding message already gave the model.

## Known Limitations and Deferred Work

- Web sources the model cites as `[W1]` appear in the web search tool cards, not in this card.
