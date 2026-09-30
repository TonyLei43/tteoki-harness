/**
 * Handwriting rendering: draw a note's pen strokes onto page images for OCR.
 * Strokes live in `Session.plist` under `richText['Handwriting Overlay'].SpatialHash`
 * as packed little-endian arrays: `curvespoints` (float32 x, y pairs),
 * `curvesnumpoints` (int32 points per stroke), `curveswidth` (float32 per
 * stroke), and `curvescolors` (RGBA bytes per stroke). Pages stack vertically
 * in document coordinates; the page width comes from the paper's
 * `lockedWidth` and the height from its paper size.
 */

import { createCanvas } from '@napi-rs/canvas'
import { isRecord, type Archived } from './archive.ts'

/** Paper sizes as height ÷ width. */
const PAPER_ASPECT: Readonly<Record<string, number>> = { letter: 11 / 8.5, a4: 297 / 210, legal: 14 / 8.5, a5: 210 / 148 }

/** Width used when the session names no locked width. */
const DEFAULT_WIDTH = 834.4

/** One pen stroke. */
export interface Stroke {
  /** Interleaved x, y document coordinates. */
  readonly points: Float32Array
  readonly width: number
  /** CSS color. */
  readonly color: string
}

/** A note's strokes and page size. */
export interface StrokeDocument {
  readonly pageWidth: number
  readonly pageHeight: number
  readonly strokes: readonly Stroke[]
}

/**
 * Walk a decoded value by keys.
 * @param value - decoded root.
 * @param keys - property path.
 * @returns the value at the path, or undefined.
 */
function at(value: Archived, ...keys: string[]): Archived {
  let current = value
  for (const key of keys) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

/**
 * View a byte field as a typed array; an absent field is empty.
 * @param value - decoded bytes.
 * @param make - typed-array constructor over an aligned copy.
 * @returns the typed array.
 */
function packed<T>(value: Archived, make: (buffer: ArrayBuffer) => T): T {
  // Copy into a fresh, aligned buffer: a decoded Buffer is a view into the whole plist file.
  const bytes = value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(0)
  return make(bytes.buffer)
}

/**
 * Read the strokes and page geometry of a decoded session.
 * @param session - `Session.plist` decoded with top key `$0`.
 * @returns the strokes, or an empty list when the note has no handwriting.
 */
export function readStrokes(session: Archived): StrokeDocument {
  const attributes = at(session, 'NBNoteTakingSessionDocumentPaperLayoutModelKey', 'documentPaperAttributes')
  const sizing = String(at(attributes, 'paperSizingBehavior') ?? '')
  const locked = /lockedWidth:([\d.]+)/.exec(sizing)
  const pageWidth = locked === null ? DEFAULT_WIDTH : Number(locked[1])
  const paper = String(at(attributes, 'paperSize') ?? 'letter').toLowerCase()
  const landscape = String(at(attributes, 'paperOrientation') ?? '') === 'landscape'
  const aspect = PAPER_ASPECT[paper] ?? PAPER_ASPECT.letter ?? 1
  const pageHeight = pageWidth * (landscape ? 1 / aspect : aspect)
  const hash = at(session, 'richText', 'Handwriting Overlay', 'SpatialHash')
  const points = packed(at(hash, 'curvespoints'), buffer => new Float32Array(buffer))
  const counts = packed(at(hash, 'curvesnumpoints'), buffer => new Int32Array(buffer))
  const widths = packed(at(hash, 'curveswidth'), buffer => new Float32Array(buffer))
  const colors = packed(at(hash, 'curvescolors'), buffer => new Uint8Array(buffer))
  const strokes: Stroke[] = []
  let offset = 0
  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index] ?? 0
    if (count <= 0 || (offset + count) * 2 > points.length) break
    const [red, green, blue, alpha] = [colors[index * 4] ?? 0, colors[index * 4 + 1] ?? 0, colors[index * 4 + 2] ?? 0, colors[index * 4 + 3] ?? 255]
    strokes.push({
      points: points.subarray(offset * 2, (offset + count) * 2),
      width: widths[index] ?? 1,
      color: `rgba(${red}, ${green}, ${blue}, ${(alpha / 255).toFixed(3)})`,
    })
    offset += count
  }
  return { pageWidth, pageHeight, strokes }
}

/**
 * Render each page that has strokes to a PNG, white background, in page order.
 * A stroke is drawn on the page holding its first point.
 * @param document - strokes and page geometry.
 * @param scale - pixels per document unit.
 * @returns page numbers (1-based) with their PNG bytes.
 */
export async function renderPages(document: StrokeDocument, scale = 1.5): Promise<{ page: number; png: Uint8Array }[]> {
  const byPage = new Map<number, Stroke[]>()
  for (const stroke of document.strokes) {
    const page = Math.max(0, Math.floor((stroke.points[1] ?? 0) / document.pageHeight))
    const list = byPage.get(page) ?? []
    list.push(stroke)
    byPage.set(page, list)
  }
  const out: { page: number; png: Uint8Array }[] = []
  for (const page of [...byPage.keys()].sort((left, right) => left - right)) {
    const canvas = createCanvas(Math.ceil(document.pageWidth * scale), Math.ceil(document.pageHeight * scale))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    const top = page * document.pageHeight
    for (const stroke of byPage.get(page) ?? []) {
      context.strokeStyle = stroke.color
      context.lineWidth = Math.max(1, stroke.width * scale * 1.6)
      context.beginPath()
      for (let index = 0; index < stroke.points.length; index += 2) {
        const x = (stroke.points[index] ?? 0) * scale
        const y = ((stroke.points[index + 1] ?? 0) - top) * scale
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      if (stroke.points.length === 2) context.lineTo((stroke.points[0] ?? 0) * scale + 0.5, ((stroke.points[1] ?? 0) - top) * scale)
      context.stroke()
    }
    out.push({ page: page + 1, png: await canvas.encode('png') })
  }
  return out
}
