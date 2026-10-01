---
description: "The mind_map tool: the model shows the user a visual map of how ideas connect, drawn by the Web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-mind-map

## Summary

Registers `mind_map`, which the model calls to show how ideas connect: a `title`, a `center` concept id, `concepts` (`id`, `label`, optional one-to-two sentence `detail`, optional `sources` such as `K2` or file names), and `links` (`from`, `to`, optional relation `label`). The tool checks the map (2 to `maxConcepts` concepts, unique non-empty ids and labels, a known center, links between known distinct concepts, at most twice as many links as concepts) and returns the counts; the map itself stays in the call's arguments, which the [Knowledge Sources](../../client/ui-knowledge-sources/README.md) client package draws as an interactive radial map.

## Use this package

Add it to an agent preset. With [knowledge-context](../knowledge-context/README.md) `mindMap: true`, grounded turns tell the model to use it when the user is studying.

| Config | Default | Meaning |
|---|---|---|
| `maxConcepts` | `40` | Most concepts in one map. |

## Model Experience

The tool schema (about 350 tokens) joins every request of the agent. A call's arguments hold the whole map; the result is one line, `Showed the mind map "<title>" to the user: N concepts, M links.` An invalid map fails with the first problem, so the model can correct and call again.

## Known Limitations and Deferred Work

- Maps are not saved to the vault; they live in the session.
