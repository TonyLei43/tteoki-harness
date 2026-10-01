---
description: "Orca-style workbench chrome for the dsh web client: a tab strip of Home and open Sessions with status dots, and a status bar with running Sessions, the next deadline, the knowledge index, and the last sync."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

## Summary

Adds IDE-style chrome around the centre column. The **tab strip** across the top starts with **Home** and lists the Sessions you have opened, each with a status dot (running, needs your input, finished, idle); click to switch, × to close the tab (the Session is kept), + to start a new Session. The **status bar** along the bottom shows how many Sessions are running, the next unfinished deadline, the knowledge index size, and when the agenda last synced.

## Use this package

Mount it in the Web client roster with [ui-layout](../ui-layout/README.md), which declares the `shell.tabs` and `shell.status` rows. Home comes from [ui-dashboard](../ui-dashboard/README.md); the deadline and sync facts from the `connectors` namespace; the index size from `memory`. Open tabs persist in the browser's local storage; at most 10 Session tabs stay open, dropping the oldest.

## Model Experience

None.

## Known Limitations and Deferred Work

- Tabs cannot be reordered by dragging yet.
- English only.
- **Runtime invariant:** No companion is published. Tabs are view state; the status facts are read every minute.
