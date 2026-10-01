/**
 * Sidebar footer action: the palette picker. The button shows the current
 * palette; its list shows each palette's light and dark swatches and marks the
 * current one. Choosing a palette applies it at once and saves it.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkinLocaleKey } from './locales.ts'
import type { Palette } from './palette.ts'
import { BUNNY_COLORS, BUNNY_HEAD, Sprite } from './pixel.tsx'
import css from './ThemePicker.module.css'

/** What the picker reads and does. */
export interface ThemePickerInjected {
  readonly palettes: readonly Palette[]
  /** Id of the applied palette. */
  readonly current: ObservableSnapshot<string>
  /**
   * Apply and save a palette.
   * @param id - palette id.
   */
  readonly choose: (id: string) => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Skin theme picker copy. */
    skin: SkinLocaleKey
  }
}

/** Props the renderer binds for the footer action. */
export type ThemePickerProps = SidebarFooterActionOwnerProps & PropsLocale<'skin'> & InjectFace<ThemePickerInjected>

/**
 * The palette picker.
 * @param props - sidebar width and the picker face.
 * @returns the button and, while open, its list.
 */
export function ThemePicker({ t, wide, palettes, current, choose }: ThemePickerProps) {
  const id = useSyncExternalStore(current.subscribe, current.getSnapshot)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; bottom: number } | undefined>()
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const active = palettes.find(palette => palette.id === id) ?? palettes[0]
  useLayoutEffect(() => {
    if (!open) return
    const rect = button.current?.getBoundingClientRect()
    if (rect !== undefined) setPosition({ left: rect.left, bottom: window.innerHeight - rect.top + 6 })
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = (event: Event): void => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !list.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  const label = t('current').replace('{name}', active?.name ?? '')
  return (
    <>
      <button
        ref={button}
        type="button"
        className={wide ? css.trigger : `${css.trigger} ${css.rail}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={wide ? undefined : label}
        onClick={() => { setOpen(!open) }}
      >
        <Sprite rows={BUNNY_HEAD} colors={BUNNY_COLORS} scale={wide ? 1.5 : 2} className={css.icon} />
        {wide ? <span className={css.label}>{t('theme')}</span> : null}
        {wide ? <span className={css.value}>{active?.name}</span> : null}
      </button>
      {open && position !== undefined
        ? (
          <div ref={list} className={css.list} role="menu" aria-label={t('themes')} style={{ left: position.left, bottom: position.bottom }}>
            {palettes.map(palette => (
              <button
                key={palette.id}
                type="button"
                role="menuitemradio"
                aria-checked={palette.id === id}
                className={css.option}
                onClick={() => { choose(palette.id); setOpen(false) }}
              >
                <span className={css.swatches} aria-hidden="true">
                  {palette.swatch.map(([light, dark]) => (
                    <span key={`${light}${dark}`} className={css.swatch} style={{ background: `linear-gradient(135deg, ${light} 50%, ${dark} 50%)` }} />
                  ))}
                </span>
                <span className={css.name}>{palette.name}</span>
                {palette.id === id ? <span className={css.check} aria-hidden="true">✓</span> : null}
              </button>
            ))}
          </div>
        )
        : null}
    </>
  )
}
