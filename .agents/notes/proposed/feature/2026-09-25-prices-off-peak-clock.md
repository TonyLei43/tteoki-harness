# Agent Note: Prices catalog and DeepSeek off-peak clock

Status: proposed

English | [中文](2026-09-25-prices-off-peak-clock.zh.md)

## Problem

Users cannot see current token prices inside the harness. DeepSeek discounts off-peak hours, so the effective price depends on a vendor schedule measured in UTC; OpenRouter publishes a large catalog that changes without warning. Recomputing both in each browser tab would duplicate fetch, validation, and the schedule rule, and would hide the schedule behind tab-local state.

## Proposal

Add a host package `@deepseek-ai/dsh-prices` that serves the generated `prices` Remote namespace and holds no filesystem state. It carries the static DeepSeek rate card in USD per 1M tokens, computes the off-peak clock through one pure function, and fetches the public OpenRouter `/models` endpoint with a zod-validated normalization and a `refreshMs` cache. Transport, HTTP, JSON, and schema failures throw named RemoteErrors.

Add a client package `@deepseek-ai/dsh-client-ui-prices` that registers a settings section and a sidebar panel. The panel shows the off-peak clock with a live countdown recomputed locally from the returned transition instant, the DeepSeek table, and the searchable OpenRouter list.

The off-peak rule is fixed: peak windows are 01:00-04:00 and 06:00-10:00 UTC, Monday-Friday on the UTC calendar, weekends are off-peak all day, and off-peak prices are half the peak prices. `deepseekOffPeak(now)` is the one pure transition function and returns the current flag and the next edge.

## Alternatives considered

- **Fetch OpenRouter from the browser** — rejected: it hits CORS, has no shared cache, and would duplicate validation in every tab.
- **Bake the OpenRouter list into the build** — rejected: the catalog changes far more often than a release.
- **Compute off-peak in the client from local time** — rejected: the vendor windows are UTC and the batch boundary is vendor-defined, so the client must not reinterpret them.

## Acceptance criteria

- Pure-function tests cover window edges, the exact closing edge, the UTC weekday boundary, and the weekend rule.
- The rate card is asserted value-for-value and the OpenRouter normalization is asserted for scaling, optional cache prices, and rejected payloads.
- The service returns named RemoteErrors for transport, HTTP, JSON, and schema failures, and serves the cached list inside the TTL.
- UI tests cover the clock state, the DeepSeek table, catalog search, refresh failure, and the settings section jump.

## Risks

The DeepSeek card is compiled in, so a vendor price change needs a code change and a rebuild. One TTL covers the whole OpenRouter catalog, and the client filters and re-sorts it on each keystroke. The countdown ticks once per second, so a displayed second can lag a boundary by up to one tick.
