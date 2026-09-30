/** Locale bundles for the Prices settings section and sidebar panel. */

/** Locale keys the page renders. */
export type PricesLocaleKey =
  | 'nav' | 'title' | 'intro' | 'loading' | 'error' | 'unavailable'
  | 'openBoard' | 'section.summary' | 'section.modelCount'
  | 'clock.offPeak' | 'clock.peak' | 'clock.changeIn' | 'clock.windows' | 'clock.timezone' | 'clock.verified'
  | 'deepseek.title'
  | 'deepseek.model' | 'deepseek.cacheHit' | 'deepseek.cacheMiss' | 'deepseek.output'
  | 'deepseek.offPeak' | 'deepseek.peak' | 'deepseek.priceHint'
  | 'openrouter.title' | 'openrouter.search' | 'openrouter.searchPlaceholder' | 'openrouter.empty'
  | 'openrouter.refresh' | 'openrouter.refreshing'
  | 'openrouter.model' | 'openrouter.context' | 'openrouter.input' | 'openrouter.output'
  | 'openrouter.cacheRead' | 'openrouter.cacheWrite' | 'openrouter.contextValue'

/** English copy. */
export const en: Record<PricesLocaleKey, string> = {
  nav: 'Prices',
  title: 'Prices',
  intro: 'DeepSeek off-peak pricing and the OpenRouter model catalog.',
  loading: 'Loading prices…',
  error: 'The prices could not be loaded.',
  unavailable: 'OpenRouter is not reachable from this host.',
  openBoard: 'Open the prices page',
  'section.summary': 'Peak windows 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday; off-peak is half price.',
  'section.modelCount': '{models} OpenRouter models available',
  'clock.offPeak': 'Off-peak — 50% off',
  'clock.peak': 'Peak',
  'clock.changeIn': 'Changes in {time}',
  'clock.windows': 'Peak windows: {windows} UTC (Mon–Fri)',
  'clock.timezone': 'Host timezone: {zone}',
  'clock.verified': 'DeepSeek rates verified 2026-09-25',
  'deepseek.title': 'DeepSeek token prices (USD per 1M tokens)',
  'deepseek.model': 'Model',
  'deepseek.cacheHit': 'Cache hit input',
  'deepseek.cacheMiss': 'Cache miss input',
  'deepseek.output': 'Output',
  'deepseek.offPeak': 'Off-peak',
  'deepseek.peak': 'Peak',
  'deepseek.priceHint': 'Each cell shows the off-peak / peak price.',
  'openrouter.title': 'OpenRouter models (USD per 1M tokens)',
  'openrouter.search': 'Search models',
  'openrouter.searchPlaceholder': 'Search by id or name',
  'openrouter.empty': 'No models match the search.',
  'openrouter.refresh': 'Refresh',
  'openrouter.refreshing': 'Refreshing…',
  'openrouter.model': 'Model',
  'openrouter.context': 'Context',
  'openrouter.input': 'Input',
  'openrouter.output': 'Output',
  'openrouter.cacheRead': 'Cache read',
  'openrouter.cacheWrite': 'Cache write',
  'openrouter.contextValue': '{tokens} tokens',
}

/** Simplified Chinese copy. */
export const zh: Record<PricesLocaleKey, string> = {
  nav: '价格',
  title: '价格',
  intro: 'DeepSeek 错峰价格与 OpenRouter 模型目录。',
  loading: '正在加载价格…',
  error: '无法加载价格。',
  unavailable: '此主机无法访问 OpenRouter。',
  openBoard: '打开价格页面',
  'section.summary': '高峰时段为 UTC 周一至周五 01:00–04:00 与 06:00–10:00；错峰价格为半价。',
  'section.modelCount': '已有 {models} 个 OpenRouter 模型',
  'clock.offPeak': '错峰 — 半价',
  'clock.peak': '高峰',
  'clock.changeIn': '{time} 后切换',
  'clock.windows': '高峰时段：UTC {windows}（周一至周五）',
  'clock.timezone': '主机时区：{zone}',
  'clock.verified': 'DeepSeek 价格核验于 2026-09-25',
  'deepseek.title': 'DeepSeek 词元价格（美元 / 每百万词元）',
  'deepseek.model': '模型',
  'deepseek.cacheHit': '缓存命中输入',
  'deepseek.cacheMiss': '缓存未命中输入',
  'deepseek.output': '输出',
  'deepseek.offPeak': '错峰',
  'deepseek.peak': '高峰',
  'deepseek.priceHint': '每格显示错峰 / 高峰价格。',
  'openrouter.title': 'OpenRouter 模型（美元 / 每百万词元）',
  'openrouter.search': '搜索模型',
  'openrouter.searchPlaceholder': '按 id 或名称搜索',
  'openrouter.empty': '没有匹配的模型。',
  'openrouter.refresh': '刷新',
  'openrouter.refreshing': '刷新中…',
  'openrouter.model': '模型',
  'openrouter.context': '上下文',
  'openrouter.input': '输入',
  'openrouter.output': '输出',
  'openrouter.cacheRead': '缓存读取',
  'openrouter.cacheWrite': '缓存写入',
  'openrouter.contextValue': '{tokens} 词元',
}
