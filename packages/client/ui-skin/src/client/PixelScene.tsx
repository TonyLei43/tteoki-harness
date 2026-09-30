/**
 * Home banner: a pixel scene with a sky that follows the time of day (sun and
 * clouds by day, moon and stars at night), grass, a carrot, and a bunny that
 * bobs and blinks, over a WebGPU layer of fireflies or petals
 * ({@link PixelSky}). Animation stops under `prefers-reduced-motion`.
 */

import { BUNNY_BLINK, BUNNY_COLORS, BUNNY_SITTING, CARROT, CARROT_COLORS, CRESCENT, DISC, GLOW_COLORS, Sprite, STAR } from './pixel.tsx'
import { PixelSky } from './PixelSky.tsx'
import css from './PixelScene.module.css'

/** A pixel cloud, 12 × 4. */
const CLOUD: readonly string[] = [
  '...WWWW.....',
  '.WWWWWWWW...',
  'WWWWWWWWWWW.',
  '.WWWWWWWWW..',
]

/** Cloud color: the bunny's fur, so clouds suit every palette. */
const CLOUD_COLORS = { W: 'var(--tteoki-fur, #FFFFFF)' }

/** Star positions in percent of the banner, with a twinkle delay each. */
const STARS: readonly { left: number; top: number; delay: number }[] = [
  { left: 12, top: 18, delay: 0 }, { left: 27, top: 42, delay: 1.2 }, { left: 41, top: 14, delay: 0.6 },
  { left: 56, top: 34, delay: 1.8 }, { left: 68, top: 12, delay: 0.3 }, { left: 83, top: 40, delay: 1.5 },
]

/**
 * Whether an hour is daytime.
 * @param hour - local hour, 0–23.
 * @returns true from 6:00 to 17:59.
 */
export function isDaytime(hour: number): boolean {
  return hour >= 6 && hour < 18
}

/**
 * The Home pixel scene.
 * @param props.now - current time, epoch milliseconds.
 * @returns the banner.
 */
export function PixelScene({ now }: { now: number }) {
  const day = isDaytime(new Date(now).getHours())
  return (
    <div className={css.scene} data-time={day ? 'day' : 'night'} aria-hidden="true">
      {day
        ? (
          <>
            <Sprite className={css.sun} rows={DISC} colors={GLOW_COLORS} scale={4} />
            <Sprite className={`${css.cloud} ${css.cloudA}`} rows={CLOUD} colors={CLOUD_COLORS} scale={4} />
            <Sprite className={`${css.cloud} ${css.cloudB}`} rows={CLOUD} colors={CLOUD_COLORS} scale={3} />
          </>
        )
        : (
          <>
            <Sprite className={css.moon} rows={CRESCENT} colors={GLOW_COLORS} scale={4} />
            {STARS.map(star => (
              <Sprite key={`${star.left}-${star.top}`} className={css.star} rows={STAR} colors={GLOW_COLORS} scale={3} style={{ left: `${star.left}%`, top: `${star.top}%`, animationDelay: `${star.delay}s` }} />
            ))}
          </>
        )}
      <PixelSky night={!day} />
      <div className={css.grass} />
      <div className={css.bunny}>
        <Sprite rows={BUNNY_SITTING} colors={BUNNY_COLORS} scale={4} />
        <Sprite className={css.blink} rows={BUNNY_BLINK} colors={BUNNY_COLORS} scale={4} />
      </div>
      <Sprite className={css.carrot} rows={CARROT} colors={CARROT_COLORS} scale={4} />
    </div>
  )
}
