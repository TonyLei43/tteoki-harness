/**
 * Browser-local profile storage shared by the Profile settings section and the
 * sidebar banner. Both read the same `localStorage` keys and react to the same
 * `dsh-profile-change` event, so the two plugins stay decoupled. The cached
 * snapshot keeps a stable reference between changes for the renderer hook.
 */

/** localStorage key holding the display name. */
export const PROFILE_NAME_KEY = 'dsh.profile.name'

/** localStorage key holding the avatar as a data URL. */
export const PROFILE_AVATAR_KEY = 'dsh.profile.avatar'

/** Event dispatched after either key changes. */
export const PROFILE_CHANGE_EVENT = 'dsh-profile-change'

/** Largest avatar data URL stored, in characters. */
export const MAX_AVATAR_CHARS = 4_000_000

/** The stored profile, as far as the browser knows. */
export interface LocalProfile {
  /** Display name, or empty. */
  readonly name: string
  /** Avatar data URL, or empty. */
  readonly avatar: string
}

/** Cached snapshot; replaced on every write or external change. */
let snapshot: LocalProfile | undefined

/**
 * Read the profile directly from storage. Returns empty values outside a
 * browser or on storage errors.
 * @returns the stored profile.
 */
export function readProfile(): LocalProfile {
  try {
    return {
      name: globalThis.localStorage?.getItem(PROFILE_NAME_KEY) ?? '',
      avatar: globalThis.localStorage?.getItem(PROFILE_AVATAR_KEY) ?? '',
    }
  } catch {
    // Storage can be unavailable (private mode); the profile is then empty.
    return { name: '', avatar: '' }
  }
}

/**
 * Read the current profile snapshot, stable between changes.
 * @returns the cached profile.
 */
export function profileSnapshot(): LocalProfile {
  snapshot ??= readProfile()
  return snapshot
}

/**
 * Persist the profile and notify subscribers.
 * @param profile - next profile values.
 */
export function writeProfile(profile: LocalProfile): void {
  try {
    if (profile.name === '') globalThis.localStorage?.removeItem(PROFILE_NAME_KEY)
    else globalThis.localStorage?.setItem(PROFILE_NAME_KEY, profile.name)
    if (profile.avatar === '') globalThis.localStorage?.removeItem(PROFILE_AVATAR_KEY)
    else globalThis.localStorage?.setItem(PROFILE_AVATAR_KEY, profile.avatar)
  } catch {
    // A failed write leaves the previous values in place.
  }
  snapshot = { name: profile.name, avatar: profile.avatar }
  globalThis.dispatchEvent?.(new Event(PROFILE_CHANGE_EVENT))
}

/**
 * Subscribe to profile changes from this or another plugin.
 * @param listener - called after any profile write or external storage change.
 * @returns the unsubscribe function.
 */
export function subscribeProfile(listener: () => void): () => void {
  const onEvent = (): void => {
    snapshot = readProfile()
    listener()
  }
  globalThis.addEventListener?.(PROFILE_CHANGE_EVENT, onEvent)
  globalThis.addEventListener?.('storage', onEvent)
  return () => {
    globalThis.removeEventListener?.(PROFILE_CHANGE_EVENT, onEvent)
    globalThis.removeEventListener?.('storage', onEvent)
  }
}

/**
 * Read a picked image file as a data URL for storage.
 * @param file - picked image file.
 * @returns a data URL for the stored avatar.
 */
export function readAvatarFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => { reject(new Error('the image could not be read')) }
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.readAsDataURL(file)
  })
}
