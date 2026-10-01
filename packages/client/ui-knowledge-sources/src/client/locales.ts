/** English copy for the knowledge Sources card. */

/** Locale keys the card renders. */
export type KnowledgeSourcesLocaleKey =
  | 'title' | 'none' | 'failed' | 'page' | 'showPage' | 'hidePage' | 'loadingPage' | 'pageFailed' | 'openFile' | 'match'
  | 'mindMap' | 'drawingMap' | 'mapFailed' | 'mapSources' | 'expandMap' | 'closeMap' | 'mapShown'
  | 'copy' | 'copied' | 'codeBlock' | 'wrap' | 'unwrap' | 'footnotes'

/** English copy. */
export const en: Record<KnowledgeSourcesLocaleKey, string> = {
  title: 'From your notes',
  none: 'Your notes had nothing on this.',
  failed: 'Your notes could not be searched: {error}',
  page: 'p. {page}',
  showPage: 'Show page',
  hidePage: 'Hide page',
  loadingPage: 'Rendering page…',
  pageFailed: 'This page has no preview.',
  openFile: 'Open file',
  match: '{percent}% match',
  mindMap: 'Mind map',
  drawingMap: 'Drawing a mind map…',
  mapFailed: 'The mind map could not be drawn: {reason}',
  mapSources: 'From',
  expandMap: 'Expand',
  closeMap: 'Close',
  mapShown: 'Mind map “{title}” — shown under the answer',
  copy: 'Copy',
  copied: 'Copied',
  codeBlock: 'Code',
  wrap: 'Wrap',
  unwrap: 'Unwrap',
  footnotes: 'Footnotes',
}
