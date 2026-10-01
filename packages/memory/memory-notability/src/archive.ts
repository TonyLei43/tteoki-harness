/** Binary property lists and `NSKeyedArchiver` object graphs, decoded to plain values. */

import { readFile } from 'node:fs/promises'
import { parseBuffer, setMaxObjectCount, UID } from 'bplist-parser'

/** A decoded value: property-list scalars, arrays, and dictionaries with archiver references resolved. */
export type Archived = string | number | bigint | boolean | Date | Uint8Array | undefined | Archived[] | { [key: string]: Archived }

/** Seconds between the Unix epoch and the Core Foundation epoch (2001-01-01). */
const CF_EPOCH_SECONDS = 978_307_200

/**
 * Read one binary property list.
 * @param path - absolute plist path.
 * @returns the root value, with keyed-archiver references still unresolved.
 * @throws Error when the file is not a binary property list.
 */
export async function readPlist(path: string): Promise<Archived> {
  const buffer = await readFile(path)
  // Every object occupies at least one byte, so the file length bounds the count;
  // the parser's default cap rejects large handwriting sessions.
  setMaxObjectCount(Math.max(32_768, buffer.length))
  const [root] = parseBuffer<Archived>(buffer)
  return root
}

/**
 * Whether a value is a plain dictionary.
 * @param value - decoded value.
 * @returns true for a non-array, non-binary object.
 */
export function isRecord(value: Archived): value is { [key: string]: Archived } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Uint8Array) && !(value instanceof UID)
}

/**
 * Resolve an `NSKeyedArchiver` graph into plain values. `NSArray`/`NSSet`
 * become arrays, `NSDictionary` becomes an object keyed by its resolved keys,
 * `NSString`, `NSData`, and `NSDate` become strings, bytes, and dates, and every other archived
 * object becomes its field dictionary without `$class`. Shared and cyclic
 * references resolve to the same decoded value.
 * @param archive - the plist root produced by `NSKeyedArchiver`.
 * @param top - the `$top` entry to decode: `root` for `NSKeyedArchiver`,
 * `$0` for Notability's `GLKeyedArchiver` sessions.
 * @returns the decoded `$top` object.
 * @throws Error when the plist is not a keyed archive.
 */
export function unarchive(archive: Archived, top = 'root'): Archived {
  if (!isRecord(archive) || !Array.isArray(archive.$objects) || !isRecord(archive.$top)) throw new Error('not an NSKeyedArchiver plist')
  const objects = archive.$objects
  const decoded = new Map<number, Archived>()
  const resolve = (value: Archived): Archived => {
    if (value instanceof UID) return object(value.UID)
    if (Array.isArray(value)) return value.map(resolve)
    return value
  }
  const object = (index: number): Archived => {
    if (decoded.has(index)) return decoded.get(index)
    const raw = objects[index]
    if (raw === '$null') return undefined
    if (!isRecord(raw)) {
      decoded.set(index, raw)
      return raw
    }
    if (typeof raw['NS.time'] === 'number') {
      const date = new Date((CF_EPOCH_SECONDS + raw['NS.time']) * 1000)
      decoded.set(index, date)
      return date
    }
    if (raw['NS.bytes'] instanceof Uint8Array) {
      decoded.set(index, raw['NS.bytes'])
      return raw['NS.bytes']
    }
    if (typeof raw['NS.string'] === 'string') {
      decoded.set(index, raw['NS.string'])
      return raw['NS.string']
    }
    if (Array.isArray(raw['NS.keys']) && Array.isArray(raw['NS.objects'])) {
      const out: { [key: string]: Archived } = {}
      decoded.set(index, out)
      const values = raw['NS.objects']
      raw['NS.keys'].forEach((key, position) => { out[String(resolve(key))] = resolve(values[position]) })
      return out
    }
    if (Array.isArray(raw['NS.objects'])) {
      const out: Archived[] = []
      decoded.set(index, out)
      for (const item of raw['NS.objects']) out.push(resolve(item))
      return out
    }
    const out: { [key: string]: Archived } = {}
    decoded.set(index, out)
    for (const [key, value] of Object.entries(raw)) if (key !== '$class') out[key] = resolve(value)
    return out
  }
  return resolve(archive.$top[top])
}
