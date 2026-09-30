/** Locale bundles for the Skills settings section. */

/** Locale keys the section renders. */
export type SkillsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'search' | 'loading' | 'error' | 'empty' | 'noMatch'
  | 'modelBadge' | 'userBadge'
  | 'setsTitle' | 'setsIntro' | 'setsEmpty' | 'specPlaceholder' | 'install' | 'installing'
  | 'remove' | 'actionError'

/** English copy. */
export const en: Record<SkillsLocaleKey, string> = {
  nav: 'Skills',
  title: 'Skills',
  intro: 'Reusable instructions this harness can load on demand.',
  search: 'Search skills',
  loading: 'Loading skills…',
  error: 'Skills could not be loaded.',
  empty: 'No skills are installed yet.',
  noMatch: 'No skills match your search.',
  modelBadge: 'Model',
  userBadge: 'User',
  setsTitle: 'Skill sets',
  setsIntro: 'Install an npm package that ships a skills/ directory; its skills become available in every project.',
  setsEmpty: 'No skill sets are installed.',
  specPlaceholder: 'npm package name, e.g. @acme/skills',
  install: 'Install',
  installing: 'Installing…',
  remove: 'Remove',
  actionError: 'The skill set could not be changed.',
}

/** Simplified Chinese copy. */
export const zh: Record<SkillsLocaleKey, string> = {
  nav: '技能',
  title: '技能',
  intro: '此 harness 可按需加载的可复用指令。',
  search: '搜索技能',
  loading: '正在加载技能…',
  error: '无法加载技能。',
  empty: '尚未安装任何技能。',
  noMatch: '没有匹配的技能。',
  modelBadge: '模型',
  userBadge: '用户',
  setsTitle: '技能集',
  setsIntro: '安装带有 skills/ 目录的 npm 包；其技能将在所有项目中可用。',
  setsEmpty: '尚未安装任何技能集。',
  specPlaceholder: 'npm 包名，例如 @acme/skills',
  install: '安装',
  installing: '正在安装…',
  remove: '移除',
  actionError: '无法更改技能集。',
}
