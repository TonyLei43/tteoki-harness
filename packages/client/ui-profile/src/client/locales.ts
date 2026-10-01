/** Locale bundles for the Profile settings section. */

/** Locale keys the section renders. */
export type ProfileLocaleKey =
  | 'nav' | 'title' | 'intro' | 'name' | 'namePlaceholder' | 'avatar' | 'choose' | 'remove'
  | 'save' | 'saved' | 'unsaved' | 'error' | 'tooLarge'

/** English copy. */
export const en: Record<ProfileLocaleKey, string> = {
  nav: 'Profile',
  title: 'Profile',
  intro: 'Set the name and picture shown in the sidebar banner.',
  name: 'Display name',
  namePlaceholder: 'Your name',
  avatar: 'Profile picture',
  choose: 'Choose picture',
  remove: 'Remove',
  save: 'Save',
  saved: 'Saved.',
  unsaved: 'Unsaved changes.',
  error: 'The picture could not be read.',
  tooLarge: 'That image is too large. Choose one under about 3 MB.',
}

/** Simplified Chinese copy. */
export const zh: Record<ProfileLocaleKey, string> = {
  nav: '个人资料',
  title: '个人资料',
  intro: '设置侧栏横幅中显示的名称与头像。',
  name: '显示名称',
  namePlaceholder: '你的名字',
  avatar: '头像',
  choose: '选择图片',
  remove: '移除',
  save: '保存',
  saved: '已保存。',
  unsaved: '有未保存的更改。',
  error: '无法读取该图片。',
  tooLarge: '图片过大，请选择约 3 MB 以下的图片。',
}
