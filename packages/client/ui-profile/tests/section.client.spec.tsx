// @vitest-environment jsdom
/** The Profile section: name, picture, save, and error states. */

import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfileSection } from '../src/client/ProfileSection.tsx'
import type { ProfileSectionProps } from '../src/client/ProfileSection.tsx'
import { profileSnapshot, readAvatarFile, subscribeProfile, writeProfile } from '../src/client/profile-storage.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  globalThis.localStorage.clear()
  writeProfile({ name: '', avatar: '' })
  vi.unstubAllGlobals()
})

const t = (key: string) => en[key as keyof typeof en]

/** Renders the section over the real local profile store. */
function Harness() {
  const profile = useSyncExternalStore(subscribeProfile, profileSnapshot)
  const props = { t, close: () => {}, useProfile: (selector: (value: typeof profile) => unknown) => selector(profile) } as ProfileSectionProps
  return <ProfileSection {...props} />
}

function renderSection() {
  render(<Harness />)
  return { input: screen.getByRole('textbox', { name: en.name }) }
}

describe('ProfileSection', () => {
  it('leads with its heading, name field, and picture controls', () => {
    renderSection()
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.choose })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    expect(screen.getByText(en.saved)).toBeTruthy()
  })

  it('ignores an empty pick and a non-string reader result', async () => {
    renderSection()
    fireEvent.change(screen.getByLabelText(en.avatar), { target: { files: [] } })
    expect(screen.queryByAltText(en.avatar)).toBeNull()

    class NonStringReader {
      onerror: (() => void) | null = null
      onload: (() => void) | null = null
      result: unknown = null
      readAsDataURL(): void { this.onload?.() }
    }
    vi.stubGlobal('FileReader', NonStringReader)
    await expect(readAvatarFile(new File(['x'], 'x.png'))).resolves.toBe('')
  })
  it('opens the file picker from the choose button', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: en.choose }))
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })
  it('saves a display name', async () => {
    const { input } = renderSection()
    fireEvent.change(input, { target: { value: 'Tony Lei' } })
    expect(screen.getByText(en.unsaved)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(screen.getByText(en.saved)).toBeTruthy() })
    expect(globalThis.localStorage.getItem('dsh.profile.name')).toBe('Tony Lei')
  })

  it('chooses a picture, renders it round, and removes it', async () => {
    renderSection()
    const file = new File(['pretend-image'], 'me.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(en.avatar), { target: { files: [file] } })
    const image = await screen.findByAltText(en.avatar)
    expect(image.getAttribute('src')).toContain('data:image/png')

    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(globalThis.localStorage.getItem('dsh.profile.avatar')).toContain('data:image/png') })

    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    expect(screen.queryByAltText(en.avatar)).toBeNull()
  })

  it('rejects an oversized picture', async () => {
    renderSection()
    const big = new File([new Uint8Array(3_300_000)], 'big.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(en.avatar), { target: { files: [big] } })
    expect((await screen.findByRole('alert')).textContent).toBe(en.tooLarge)
  })

  it('reports a picture that cannot be read', async () => {
    class FailingReader {
      onerror: (() => void) | null = null
      onload: (() => void) | null = null
      readAsDataURL(): void { this.onerror?.() }
    }
    vi.stubGlobal('FileReader', FailingReader)
    renderSection()
    fireEvent.change(screen.getByLabelText(en.avatar), { target: { files: [new File(['x'], 'x.png')] } })
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
  })
})
