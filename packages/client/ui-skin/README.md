---
description: "Deployment skin for the Web client: pixel-art brand, cozy palettes with a sidebar picker, a pixel display font, and a Home pixel scene with a WebGPU particle layer."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skin

## Summary

This package gives a deployment its own product identity: a pixel bunny mark and a pixel-font wordmark in the sidebar and conversation hero brand slots; four palettes (Mochi, Matcha, Starlight, Classic), each a light/dark token layer over the active theme; a **Theme** picker in `sidebar.footer.action`; the embedded Pixelify Sans display font (SIL OFL 1.1) exposed as `--tteoki-font-display`; and a Home banner in `dashboard.hero`: a pixel scene whose sky follows the time of day, with a bobbing, blinking bunny and a WebGPU layer of fireflies at night and falling petals by day. The chosen palette is its only durable state, saved in the `ui-skin` settings section. It does not affect model requests.

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

Mount this plugin in the browser roster of the Web profile. The node half publishes the `palette` setting (`mochi`, `matcha`, `starlight`, or `classic`; default `mochi`) to the browser through the Host settings service; the picker writes it, and an unknown id falls back to Mochi.

### Rename the product

`PRODUCT_NAME` in `src/client/product.ts` is the single rename point. The sidebar brand name renders it verbatim in the pixel font; the mark is the pixel bunny in the palette's `--tteoki-fur`, `--tteoki-blush`, and `--tteoki-ink` colors.

### Change the palette

`src/client/palette.ts` defines each palette's colors; `skinTokens(palette)` maps them to `{ light, dark }` pairs for surfaces, labels, borders, the accent, and the `--tteoki-*` tokens (display font, card radius, border, and offset shadow, button shadow, the Home dot pattern, and the pixel-art colors). Components outside the skin read `--tteoki-*` tokens with fallbacks, so they render unchanged without it. Every label and link keeps at least 4.5:1 contrast against every surface in every palette and scheme, and a test enforces it. Regenerate the embedded font with `pnpm --filter @deepseek-ai/dsh-client-ui-skin generate-fonts`.

### Pixel art and WebGPU

Sprites are character maps in `src/client/pixel.tsx`, rendered as crisp SVG runs. `PixelSky` renders the particle shader at a quarter of the banner's resolution and scales it up without smoothing. It renders nothing without `navigator.gpu` or a device, one still frame under `prefers-reduced-motion`, and pauses while the page is hidden.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The browser half installs two independent effects.

- `ctx.theme.overrideTokens` layers the accent palette over the active theme; the layer is keyed by the package id and withdraws with the plugin fiber.
- Declaration-aware `ctx.slots.inject` calls fill `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark`. The sidebar pair installs as one registration set; the hero occupant registers independently because `ui-conversation` declares its slot.

The node half is an inert Loader seat.

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the skin surface is not enough.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark`.
- [ui-theme](../ui-theme/README.md) — owns the `--dsw-*` token stylesheets and the theme service.
- [Web UI style reference](../../../docs/web-styling.md) — styling ownership and component rules.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Brand copy is not localized** — the product name is deployment identity rather than translatable UI copy, so it does not route through the locale dictionaries.
- **The default preference stays `system`** — the skin recolors both palettes but does not choose one; a deployment that wants dark out of the box changes the theme default in `ui-theme`.
- **The browser title is a build concern** — `DSH_CLIENT_TITLE` sets the document title at build time, outside the slot system.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package retains no mutable state, and its brand occupants and accent layer install and leave through the plugin fiber.
