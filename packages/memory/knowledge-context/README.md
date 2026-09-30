---
description: "Knowledge-first grounding: every user message is searched in the knowledge bases and the best passages reach the model as cited context, with outside-source verification."
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-context

## Summary

Makes an agent answer from the user's own notes first. On the first step of every turn the user opens with a message, the plugin searches the configured knowledge bases ([memory](../memory/README.md)) with that message and appends one context message to the request: the passages above `minScore`, numbered `[K1]`, `[K2]`, …, each with its file and heading, and the instruction to answer from them first, cite them inline, and, with `verify`, confirm the key facts with web search cited as `[W1]`, `[W2]`, …, saying where the notes and outside sources disagree. When nothing matches, or the search fails, the message says so, so the model tells the user instead of guessing.

## Use this package

Add it to an agent preset beside `tool-memory` (the `memory` service must be mounted); with `verify`, the preset also needs `tool-web`.

| Config | Default | Meaning |
|---|---|---|
| `knowledgeBases` | required | Knowledge base ids searched; `*` searches every one. |
| `topK` | `6` | Passages retrieved per turn. |
| `minScore` | `0.35` | Minimum cosine similarity of an included passage. |
| `maxPassageChars` | `900` | Characters of each passage given to the model. |
| `verify` | `true` | Whether the model is told to confirm with outside sources. |
| `mindMap` | `false` | Whether the model is told, when the user is studying, to connect the answer to related ideas in the notes and show them with `mind_map` ([tool-mind-map](../tool-mind-map/README.md)). |

The message is logged as a `user/message` with source kind `knowledge-context` and form `notice`; the source records the query, the searched knowledge bases, the passages (label, collection, file, heading, page, text, score), and any error. The [Sources card](../../client/ui-knowledge-sources/README.md) renders it under the answer.

## Model Experience

One user-role context message per grounded turn, after the user's message: an instruction paragraph, then each passage as `[K<n>] <path> — <heading>` followed by its text. It adds roughly `topK × maxPassageChars` characters (about 1,500 tokens at the defaults) to every grounded turn. The message becomes part of the history, so later requests reuse it from the KV cache; later steps of the same turn add nothing.

## Known Limitations and Deferred Work

- The search uses only the text of the latest user message; a follow-up like "and the proof?" retrieves by its own words, not the conversation.
- Passages are sent to whichever model the agent uses; a preset over private notes should run a local model or leave `verify` off so questions are not sent to web search.
