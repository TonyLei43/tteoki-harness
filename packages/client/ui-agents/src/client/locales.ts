/** Locale bundles for the Agents settings section. */

/** Locale keys the section renders. */
export type AgentsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'loading' | 'error' | 'empty' | 'default' | 'actionError'

/** English copy. */
export const en: Record<AgentsLocaleKey, string> = {
  nav: 'Agents',
  title: 'Agents',
  intro: 'Each agent runs the model you bind here; unbound agents use the default.',
  loading: 'Loading agents…',
  error: 'Agents could not be loaded.',
  empty: 'No agent presets are composed.',
  default: 'Default',
  actionError: 'The agent model could not be changed.',
}

/** Simplified Chinese copy. */
export const zh: Record<AgentsLocaleKey, string> = {
  nav: '智能体',
  title: '智能体',
  intro: '每个智能体运行你在此绑定的模型；未绑定的智能体使用默认模型。',
  loading: '正在加载智能体…',
  error: '无法加载智能体。',
  empty: '未组合任何智能体预设。',
  default: '默认',
  actionError: '无法更改智能体模型。',
}
