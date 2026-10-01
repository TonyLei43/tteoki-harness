---
description: "Personal data connectors: calendar ICS feeds and Canvas assignments synced into one agenda, an Obsidian agenda note, and the connectors Remote namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-connectors

## Summary

Syncs your calendars and course deadlines into one **agenda** of events and assignments. An `ics` connector reads a calendar's private iCal address (Google Calendar's "secret address in iCal format", an iCloud public calendar link, or a Canvas calendar feed). A `canvas` connector reads the Canvas planner with an access token, including each assignment's submission status and points. The agenda feeds the Web dashboard and Agenda panel ([ui-agenda](../../client/ui-agenda/README.md)), the model's `agenda` tool ([tool-agenda](../tool-agenda/README.md)), and optionally an `Agenda.md` note in an Obsidian vault.

## Use this package

Mount it in the Host plane; add connectors from the Web **Agenda** panel.

| Setting | Default | Meaning |
|---|---|---|
| `connectors` | `[]` | `{ id, kind: 'ics' \| 'canvas', name, enabled, secret, baseUrl? }`; `secret` names the credential holding the ICS address or token. |
| `pastDays` / `horizonDays` | `7` / `60` | Sync window around today. |
| `syncMinutes` | `30` | Automatic sync interval; `0` syncs only on request. |
| `courses` | `[]` | `{ code, name, aliases?, knowledgeBase?, folders }`; items under an alias (a cross-listed code such as `BIOST 583`, or Canvas's `STAT 536/427`) are labeled with `code`. |
| `notesDir` | unset | Folder receiving `Agenda.md`; only the block between `<!-- tteoki:agenda:start -->` and `<!-- tteoki:agenda:end -->` is rewritten. |

Settings and the agenda live in `$DSH_HOME/connectors/` (`config.json`, `agenda.json`). Secrets are stored through `ctx.credentials` under each connector's `secret` name, so an environment variable of that name overrides the stored value and settings never contain the value. Recurring calendar events expand inside the window with moved and cancelled occurrences applied. A connector that fails keeps its previous items and reports why. Canvas pagination is followed only on the Canvas origin, because the token rides every request.

| Method | Behavior |
|---|---|
| `getSettings` / `setSettings` | Read or update settings; invalid ids, secret names, windows, or non-HTTPS Canvas addresses are rejected. |
| `setSecret({ connector, value })` | Store the connector's secret in the credential store. |
| `sync()` | Sync every enabled connector now; concurrent calls share one sync. |
| `status()` | Per-connector last sync, item count, error, and whether the secret is set. |
| `agenda({ from?, to?, kinds? })` | Items overlapping the window (default: today plus 14 days). |

## Model Experience

None directly; [tool-agenda](../tool-agenda/README.md) exposes the agenda to agents.

## Known Limitations and Deferred Work

- Gradescope has no API and is not read; course deadlines posted only there are missing.
- Syllabus deadlines are not extracted from course documents yet.
- **Runtime invariant:** No companion is published. The settings and agenda files are the only state.
