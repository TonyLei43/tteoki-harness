---
description: "Home dashboard for the dsh web client: the first sidebar panel and the view the app opens on, a greeting and widget cards filled through the dashboard.widget slot."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-dashboard

## Summary

**Home** is the first entry in the sidebar and the view the app opens on: a time-of-day greeting, today's date, and one card per registered widget. The widget with the lowest `order` takes the full-width first row; the remaining widgets tile below it. Opening a session switches to the conversation as usual; Home is one click away.

## Use this package

Mount it in the Web client roster. It registers the `home` main panel, its sidebar entry (order `-10`, above every shipped panel), and declares the `dashboard.widget` list and the `dashboard.hero` seat, an optional banner below the greeting that receives the same `{ now }` (the [skin](../ui-skin/README.md) fills it with its pixel scene). To add a widget, register an entry with an `id`, an `order`, and a `label` (the card title); the widget receives `{ now }`, the render time shared by every widget:

```ts
ctx.slots.inject('dashboard.widget', () => ctx.slots.register({
  name: 'dashboard.widget', id: 'my.widget', order: 30, label: () => t('title'), inject: () => face,
}, MyWidget))
```

## Model Experience

None.

## Known Limitations and Deferred Work

- Widgets cannot yet be hidden or reordered by the user.
- English only.
- **Runtime invariant:** No companion is published. The widget roster is derived from slot entries.
