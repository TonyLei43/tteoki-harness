/** Locale bundles for the native orchestrator board and its auto-router. */

/** Locale keys the board and the router render. */
export type OrchestratorLocaleKey =
  | 'nav' | 'title' | 'intro' | 'loading' | 'empty' | 'error'
  | 'ask.placeholder' | 'ask.send' | 'ask.routing' | 'ask.routed' | 'ask.noTargets' | 'ask.error'
  | 'state.running' | 'state.retrying' | 'state.needs-feedback' | 'state.idle' | 'state.done' | 'state.error'
  | 'group.untitled'
  | 'meta.preset' | 'meta.activity'
  | 'activity.now' | 'activity.minutes' | 'activity.hours' | 'activity.days' | 'activity.months' | 'activity.years'
  | 'open.session'

/** English copy. */
export const en: Record<OrchestratorLocaleKey, string> = {
  nav: 'Orchestrator',
  title: 'Orchestrator',
  intro: 'Every DSH session on one board, grouped by project. Type anything to route it to the best agent.',
  loading: 'Loading sessions…',
  empty: 'No DSH sessions yet.',
  error: 'The board could not be loaded.',
  'ask.placeholder': 'Ask anything — routes to the best agent',
  'ask.send': 'Route',
  'ask.routing': 'Routing…',
  'ask.routed': 'Routed to {target}',
  'ask.noTargets': 'No matching session or agent preset to route to.',
  'ask.error': 'The message could not be routed.',
  'state.running': 'Running',
  'state.retrying': 'Retrying',
  'state.needs-feedback': 'Needs feedback',
  'state.idle': 'Idle',
  'state.done': 'Done',
  'state.error': 'Error',
  'group.untitled': 'No project directory',
  'meta.preset': 'Agent: {name}',
  'meta.activity': '{value}',
  'activity.now': 'now',
  'activity.minutes': '{n}m',
  'activity.hours': '{n}h',
  'activity.days': '{n}d',
  'activity.months': '{n}mo',
  'activity.years': '{n}y',
  'open.session': 'Open session {title}',
}

/** Simplified Chinese copy. */
export const zh: Record<OrchestratorLocaleKey, string> = {
  nav: '编排器',
  title: '编排器',
  intro: '在同一看板中按项目列出全部 DSH 会话。输入任何内容即可路由到最合适的智能体。',
  loading: '正在加载会话…',
  empty: '暂无 DSH 会话。',
  error: '无法加载看板。',
  'ask.placeholder': '输入任何问题 — 自动路由到最合适的智能体',
  'ask.send': '路由',
  'ask.routing': '正在路由…',
  'ask.routed': '已路由到 {target}',
  'ask.noTargets': '没有匹配的会话或智能体预设可路由。',
  'ask.error': '消息无法路由。',
  'state.running': '运行中',
  'state.retrying': '重试中',
  'state.needs-feedback': '需要反馈',
  'state.idle': '空闲',
  'state.done': '已完成',
  'state.error': '错误',
  'group.untitled': '无项目目录',
  'meta.preset': '智能体：{name}',
  'meta.activity': '{value}',
  'activity.now': '刚刚',
  'activity.minutes': '{n} 分钟',
  'activity.hours': '{n} 小时',
  'activity.days': '{n} 天',
  'activity.months': '{n} 个月',
  'activity.years': '{n} 年',
  'open.session': '打开会话 {title}',
}