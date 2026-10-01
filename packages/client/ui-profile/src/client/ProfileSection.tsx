/** Profile settings section: local display name and round avatar. */

import { useRef, useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import { MAX_AVATAR_CHARS, readAvatarFile, writeProfile, type LocalProfile } from './profile-storage.ts'
import type { ProfileLocaleKey } from './locales.ts'
import css from './ProfileSection.module.css'

/** Registration-side business face for the section. */
export interface ProfileSectionInjected {
  hooks: {
    /** Browser-local profile, stable between changes. */
    profile: HostObservable<LocalProfile>
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Profile settings section copy. */
    profile: ProfileLocaleKey
  }
}

/** Props the renderer binds for the section. */
export type ProfileSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'profile'>
  & InjectFace<ProfileSectionInjected>

/**
 * Render the Profile page: a display name and a round avatar.
 * @param props - localized copy and the profile hook.
 * @returns the profile section.
 */
export function ProfileSection({ t, useProfile }: ProfileSectionProps) {
  const profile = useProfile(value => value)
  const [name, setName] = useState(profile.name)
  const [avatar, setAvatar] = useState(profile.avatar)
  const [error, setError] = useState<ProfileLocaleKey>()
  const fileInput = useRef<HTMLInputElement>(null)
  const dirty = name !== profile.name || avatar !== profile.avatar

  const pick = async (picked: File | undefined): Promise<void> => {
    if (picked === undefined) return
    setError(undefined)
    try {
      const data = await readAvatarFile(picked)
      if (data.length > MAX_AVATAR_CHARS) {
        setError('tooLarge')
        return
      }
      setAvatar(data)
    } catch {
      setError('error')
    }
  }

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      <label className={css.field}>
        <span className={css.label}>{t('name')}</span>
        <input
          className={css.input}
          value={name}
          placeholder={t('namePlaceholder')}
          aria-label={t('name')}
          onChange={(event) => { setName(event.target.value) }}
        />
      </label>
      <div className={css.inline}>
        {avatar === ''
          ? <span className={css.avatarFallback} aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || '@'}</span>
          : <img className={css.avatar} src={avatar} alt={t('avatar')} />}
        <button type="button" className={css.secondary} onClick={() => { fileInput.current?.click() }}>{t('choose')}</button>
        {avatar === '' ? null : (
          <button type="button" className={css.secondary} onClick={() => { setAvatar('') }}>{t('remove')}</button>
        )}
        <input
          ref={fileInput}
          className={css.file}
          type="file"
          accept="image/*"
          aria-label={t('avatar')}
          onChange={(event) => { void pick(event.target.files?.[0]) }}
        />
      </div>
      <div className={css.inline}>
        <button type="button" className={css.button} disabled={!dirty} onClick={() => { writeProfile({ name: name.trim(), avatar }) }}>
          {t('save')}
        </button>
        <span className={css.notice}>{dirty ? t('unsaved') : t('saved')}</span>
      </div>
      {error === undefined ? null : <p className={css.notice} role="alert">{t(error)}</p>}
    </div>
  )
}
