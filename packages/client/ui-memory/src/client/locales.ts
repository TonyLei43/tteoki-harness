/** Locale bundles for the Memory settings section. */

/** Locale keys the section renders. */
export type MemoryLocaleKey =
  | 'nav' | 'title' | 'intro'
  | 'endpointTitle' | 'baseUrl' | 'model' | 'apiKey' | 'apiKeyHint' | 'chatModel' | 'visionModel' | 'visionModelHint' | 'graph' | 'graphHint'
  | 'loadModels' | 'loadingModels'
  | 'workspacesTitle' | 'workspacesIntro' | 'addWorkspace' | 'workspaceName' | 'sources' | 'sourcesHint' | 'remove'
  | 'save' | 'saved' | 'unsaved'
  | 'indexTitle' | 'indexAll' | 'indexing' | 'indexWorkspace'
  | 'statusTitle' | 'documents' | 'chunks' | 'entities' | 'relations' | 'noIndex'
  | 'searchTitle' | 'searchPlaceholder' | 'searching' | 'noResults' | 'related'
  | 'error'

/** English copy. */
export const en: Record<MemoryLocaleKey, string> = {
  nav: 'Memory',
  title: 'Memory',
  intro: 'Index local notes and documents into a searchable knowledge base your agents can query.',
  endpointTitle: 'Embedding endpoint',
  baseUrl: 'Base URL',
  model: 'Embedding model',
  apiKey: 'API key',
  apiKeyHint: 'Leave empty for a local server such as LM Studio or Ollama.',
  chatModel: 'Graph model',
  visionModel: 'Vision model (OCR)',
  visionModelHint: 'A vision model that transcribes scanned PDFs and handwritten notes; leave empty to turn OCR off.',
  graph: 'Extract knowledge graph',
  graphHint: 'Uses the chat model to extract entities and relations during indexing.',
  loadModels: 'Load models',
  loadingModels: 'Loading…',
  workspacesTitle: 'Knowledge workspaces',
  workspacesIntro: 'Each workspace is a named set of folders with its own index.',
  addWorkspace: 'Add workspace',
  workspaceName: 'Name',
  sources: 'Folders',
  sourcesHint: 'One folder path per line.',
  remove: 'Remove',
  save: 'Save',
  saved: 'Saved.',
  unsaved: 'Unsaved changes.',
  indexTitle: 'Indexing',
  indexAll: 'Index all',
  indexing: 'Indexing…',
  indexWorkspace: 'Index',
  statusTitle: 'Index status',
  documents: 'Documents',
  chunks: 'Chunks',
  entities: 'Entities',
  relations: 'Relations',
  noIndex: 'Nothing indexed yet.',
  searchTitle: 'Test search',
  searchPlaceholder: 'Search your knowledge base',
  searching: 'Searching…',
  noResults: 'No passages matched.',
  related: 'Related entities',
  error: 'The memory layer could not complete the request.',
}

/** Simplified Chinese copy. */
export const zh: Record<MemoryLocaleKey, string> = {
  nav: '记忆',
  title: '记忆',
  intro: '将本地笔记与文档索引为可搜索的知识库，供智能体查询。',
  endpointTitle: '嵌入端点',
  baseUrl: '基础地址',
  model: '嵌入模型',
  apiKey: 'API 密钥',
  apiKeyHint: '本地服务（如 LM Studio 或 Ollama）可留空。',
  chatModel: '图谱模型',
  visionModel: '视觉模型（OCR）',
  visionModelHint: '用于转写扫描版 PDF 和手写笔记的视觉模型；留空则关闭 OCR。',
  graph: '抽取知识图谱',
  graphHint: '索引时使用聊天模型抽取实体与关系。',
  loadModels: '加载模型',
  loadingModels: '加载中…',
  workspacesTitle: '知识工作区',
  workspacesIntro: '每个工作区是一组具名文件夹，拥有自己的索引。',
  addWorkspace: '新增工作区',
  workspaceName: '名称',
  sources: '文件夹',
  sourcesHint: '每行一个文件夹路径。',
  remove: '移除',
  save: '保存',
  saved: '已保存。',
  unsaved: '有未保存的更改。',
  indexTitle: '索引',
  indexAll: '全部索引',
  indexing: '正在索引…',
  indexWorkspace: '索引',
  statusTitle: '索引状态',
  documents: '文档',
  chunks: '分段',
  entities: '实体',
  relations: '关系',
  noIndex: '尚未建立索引。',
  searchTitle: '测试搜索',
  searchPlaceholder: '搜索你的知识库',
  searching: '正在搜索…',
  noResults: '没有匹配的段落。',
  related: '相关实体',
  error: '记忆层无法完成该请求。',
}
