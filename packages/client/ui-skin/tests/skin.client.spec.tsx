// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SkinBrandMark, SkinBrandName, SkinHeroMark } from '../src/client/Brand.tsx'
import { apply, colorChannels, inject, isDaytime, PARTICLE_SHADER, pixelFontCss, PixelScene, PixelSky, spriteRuns, ThemePicker } from '../src/client/index.ts'
import type { ThemePickerInjected, ThemePickerProps } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'
import { DEFAULT_PALETTE_ID, paletteById, PALETTES, skinTokens } from '../src/client/palette.ts'
import { PRODUCT_NAME } from '../src/client/product.ts'
import { apply as hostApply, Config as HostConfig } from '../src/index.ts'

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
  'dashboard.hero',
] as const

afterEach(() => {
  cleanup()
  document.head.querySelectorAll('style[data-source]').forEach(style => { style.remove() })
})

async function bench(options: { declare?: boolean; stored?: string } = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  ctx.provide('locale', new LocaleRuntime(ctx))
  const releases: ReturnType<typeof vi.fn>[] = []
  const overrideTokens = vi.fn(() => {
    const release = vi.fn()
    releases.push(release)
    return release
  })
  ctx.provide('theme', { overrideTokens } as never)
  let listener = (): void => {}
  const set = vi.fn(async () => true)
  let stored = options.stored
  ctx.provide('configForms', {
    get: (namespace: string) => {
      expect(namespace).toBe('ui-skin')
      return { getSnapshot: () => ({ value: stored === undefined ? undefined : { palette: stored } }), subscribe: (next: () => void) => { listener = next; return () => {} }, set }
    },
  } as never)
  const declareHoles = () => slots.register({
    name: 'root',
    children: {
      ...Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  if (options.declare !== false) declareHoles()
  const store = (value: string | undefined) => { stored = value; listener() }
  return { ctx, slots, overrideTokens, releases, declareHoles, set, store }
}

describe('deployment skin browser plugin', () => {
  it('publishes the palette setting through the Host settings service', async () => {
    expect(() => HostConfig({ palette: 'matcha' })).not.toThrow()
    const ctx = new Context()
    const configure = vi.fn(() => () => {})
    ctx.provide('settings', { configure } as never)
    const fiber = ctx.plugin({ apply: hostApply })
    await fiber.await()
    await vi.waitFor(() => { expect(configure).toHaveBeenCalledWith({ auto: false }, expect.anything()) })
    await fiber.dispose()
  })

  it('declares exactly the services it reads', () => {
    expect(inject).toEqual(['slots', 'theme', 'locale'])
  })

  it('applies the stored palette, the font, every brand hole, the picker, and the Home scene', async () => {
    const subject = await bench({ stored: 'matcha' })
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(subject.overrideTokens).toHaveBeenLastCalledWith(expect.any(String), skinTokens(paletteById('matcha')))
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)
    expect(subject.slots.entries('sidebar.footer.action')).toHaveLength(1)
    expect(document.head.querySelector('style[data-source]')?.textContent).toContain("font-family:'Tteoki Pixel'")

    const picker = (subject.slots.entries('sidebar.footer.action')[0]!.inject as never as () => ThemePickerInjected)()
    expect(picker.current.getSnapshot()).toBe('matcha')
    picker.choose('starlight')
    expect(picker.current.getSnapshot()).toBe('starlight')
    expect(subject.set).toHaveBeenCalledWith('palette', 'starlight')
    expect(subject.overrideTokens).toHaveBeenLastCalledWith(expect.any(String), skinTokens(paletteById('starlight')))
    // A saved change from elsewhere is adopted; an unknown id falls back to the default.
    subject.store('nope')
    expect(picker.current.getSnapshot()).toBe(DEFAULT_PALETTE_ID)

    await fiber.dispose()
    for (const release of subject.releases.slice(0, -1)) expect(release).toHaveBeenCalledOnce()
    expect(subject.releases.at(-1)).toHaveBeenCalledOnce()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
    expect(document.head.querySelector('style[data-source]')).toBeNull()
  })

  it('waits for declarations that arrive after apply', async () => {
    const subject = await bench({ declare: false })
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
    expect(subject.overrideTokens).toHaveBeenCalledWith(expect.any(String), skinTokens(paletteById(DEFAULT_PALETTE_ID)))

    subject.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)
  })

  it('renders the pixel name and marks at the requested size', () => {
    const name = render(<SkinBrandName />)
    expect(name.container.textContent).toBe(PRODUCT_NAME)
    name.unmount()

    const mark = render(<SkinBrandMark size={36} />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('36')
    expect(mark.container.querySelector('svg')?.getAttribute('shape-rendering')).toBe('crispEdges')
    mark.unmount()

    const hero = render(<SkinHeroMark size={24} className="host-geometry" />)
    expect(hero.container.querySelector('svg')?.getAttribute('width')).toBe('24')
    expect(hero.container.querySelector('svg')?.getAttribute('class')).toContain('host-geometry')
  })

  it('merges sprite rows into runs and skips transparent pixels', () => {
    expect(spriteRuns(['AAB.', '.BB.'], { A: 'red', B: 'blue' })).toEqual([
      { x: 0, y: 0, width: 2, fill: 'red' },
      { x: 2, y: 0, width: 1, fill: 'blue' },
      { x: 1, y: 1, width: 2, fill: 'blue' },
    ])
  })

  it('shows a day scene with a sun and a night scene with stars', () => {
    expect(isDaytime(6)).toBe(true)
    expect(isDaytime(17)).toBe(true)
    expect(isDaytime(18)).toBe(false)
    expect(isDaytime(2)).toBe(false)
    const day = render(<PixelScene now={new Date(2026, 8, 30, 12).getTime()} />)
    expect(day.container.firstElementChild?.getAttribute('data-time')).toBe('day')
    day.unmount()
    const night = render(<PixelScene now={new Date(2026, 8, 30, 22).getTime()} />)
    expect(night.container.firstElementChild?.getAttribute('data-time')).toBe('night')
    expect(night.container.querySelectorAll('svg').length).toBeGreaterThan(6)
  })

  it('parses palette colors for the particle shader and renders nothing without WebGPU', () => {
    expect(colorChannels('#FF8000')).toEqual([1, 128 / 255, 0, 1])
    expect(colorChannels(' rgb(255, 0, 51) ')).toEqual([1, 0, 0.2, 1])
    expect(colorChannels('var(--x)')).toEqual([0, 0, 0, 0])
    expect(PARTICLE_SHADER).toContain('@fragment')
    const sky = render(<PixelSky night />)
    const canvas = sky.container.querySelector('canvas')
    expect(canvas?.getAttribute('aria-hidden')).toBe('true')
    expect(canvas?.width).toBe(300)
  })

  it('embeds the pixel font as WOFF2 data', () => {
    expect(pixelFontCss()).toMatch(/src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]{1000,}\) format\('woff2'\)/)
  })
})

describe('ThemePicker', () => {
  const props = (injected: ThemePickerInjected, wide = true): ThemePickerProps =>
    ({ ...injected, wide, t: (key: keyof typeof en) => en[key] }) as never

  it('lists every palette, marks the current one, and applies a choice', () => {
    const choose = vi.fn()
    render(<ThemePicker {...props({ palettes: PALETTES, current: createSnapshotStore('mochi'), choose })} />)
    const trigger = screen.getByRole('button', { name: 'Theme: Mochi' })
    fireEvent.click(trigger)
    expect(screen.getAllByRole('menuitemradio').map(option => option.textContent)).toEqual(['Mochi✓', 'Matcha', 'Starlight', 'Classic'])
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Matcha/ }))
    expect(choose).toHaveBeenCalledWith('matcha')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Escape and outside clicks, and shows only the mark in the rail', () => {
    render(<ThemePicker {...props({ palettes: PALETTES, current: createSnapshotStore('matcha'), choose: vi.fn() }, false)} />)
    const trigger = screen.getByRole('button', { name: 'Theme: Matcha' })
    expect(trigger.textContent).toBe('')
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('palettes', () => {
  const luminance = (hex: string): number => {
    const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255).map(unit =>
      unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  }
  const contrast = (left: string, right: string): number => {
    const [high, low] = [luminance(left), luminance(right)].sort((a, b) => b - a)
    return (high! + 0.05) / (low! + 0.05)
  }

  it('falls back to the default for an unknown id', () => {
    expect(paletteById('nope').id).toBe(DEFAULT_PALETTE_ID)
    expect(paletteById(undefined).id).toBe(DEFAULT_PALETTE_ID)
    expect(new Set(PALETTES.map(palette => palette.id)).size).toBe(PALETTES.length)
  })

  it('keeps every label and link legible on every surface in both schemes', () => {
    const surfaces = ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3', '--dsw-specific-sidebar-fill']
    const labels = ['--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-label-caption']
    for (const palette of PALETTES) {
      const tokens = skinTokens(palette)
      for (const scheme of ['light', 'dark'] as const) {
        for (const label of labels) {
          for (const surface of surfaces) expect(contrast(tokens[label]![scheme], tokens[surface]![scheme]), `${palette.id} ${scheme} ${label} on ${surface}`).toBeGreaterThanOrEqual(4.5)
        }
        expect(contrast(tokens['--dsw-alias-link']![scheme], tokens['--dsw-alias-bg-base']![scheme]), `${palette.id} ${scheme} link`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
