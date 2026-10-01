---
description: "Agenda for the dsh web client: a day/week/month calendar plus upcoming-events and assignments-due dashboard widgets, and an Agenda panel for connectors, over the connectors Remote namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agenda

## Summary

Shows your synced [connectors](../../external/connectors/README.md) agenda: a **Calendar** dashboard widget (a Day/Week/Month switch over a period heading and navigation, with an hour grid and an all-day row in the day and week views), an **Upcoming** dashboard widget (the next seven days of events), an **Assignments due** widget (overdue work first, then deadlines with course, points, and status), and an **Agenda** sidebar panel.

A calendar item or assignment that belongs to a configured class opens that class's **class page** (main panel `course`, no sidebar entry): the class code, title, and aliases; the next meeting with its time and room and the weekly schedule of the next two weeks; exams; open assignments (overdue first) with points and Canvas links; the class's folders and knowledge base; and the cards other plugins add to the root-scoped `course.section` list, which receive the class's `CourseConfig` and the current time. Chips switch between classes, and **← Home** returns to Home.

## Use this package

Mount it in the Web client roster with [ui-dashboard](../ui-dashboard/README.md). The **Calendar** widget registers at the lowest order, so Home gives it the full-width first row — the width the week and day grids need. It opens on the month grid; **Day**, **Week**, and **Month** switch the view, the chevrons step one period, and **Today** returns to the current period. Every configured connector's events and assignment deadlines appear, all-day items in their own row, and each item links to its source when the connector reports a URL.

In the **Agenda** panel:

- **Add calendar** takes a name and the calendar's private iCal address (Google Calendar → Settings → your calendar → "Secret address in iCal format"; iCloud → share → Public Calendar).
- **Add Canvas** takes the Canvas address (default `https://canvas.uw.edu`) and an access token (Canvas → Account → Settings → New access token).
- Secrets go straight to the credential store; each connector can be disabled, given a new secret, or removed, and shows its last sync or error.
- **Obsidian agenda note** sets the folder that receives `Agenda.md`.
- **Sync now** syncs every enabled connector; the widgets refresh after any sync.

## Model Experience

None.

## Known Limitations and Deferred Work

- English only.
- Week and month grids start on Sunday, and the month grid always shows six weeks; locale-aware first-day and a responsive week count are unbuilt.
- **Runtime invariant:** No companion is published. The panel holds only view state.
