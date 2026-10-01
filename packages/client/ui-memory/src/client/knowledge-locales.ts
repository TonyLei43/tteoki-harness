/** English copy for the Knowledge panel. */

/** Locale keys the panel renders. */
export type KnowledgeLocaleKey =
  | 'nav' | 'title' | 'intro' | 'bases' | 'all'
  | 'indexAll' | 'indexOne' | 'indexing' | 'failures'
  | 'searchTitle' | 'searchPlaceholder' | 'searchIn' | 'search' | 'searching' | 'searchHint' | 'noResults' | 'related'
  | 'notesTitle' | 'newNote' | 'pickBase' | 'noNotes' | 'noteName' | 'noteContent' | 'saveNote' | 'saving' | 'close'
  | 'previewPage' | 'hidePreview' | 'previewLoading' | 'previewFailed' | 'pageAlt'
  | 'previewTitle' | 'previewHint' | 'previewNoSession' | 'previewUnavailable' | 'previewTruncated'
  | 'mdCopy' | 'mdCopied' | 'mdFootnotes'
  | 'documents' | 'docsCount' | 'matches' | 'view' | 'viewList' | 'viewMap' | 'mapLabel' | 'mapFrom' | 'matchLabel' | 'alsoIn'
  | 'browseFiles' | 'browseTitle' | 'backToSearch' | 'filterFiles' | 'fileTypes' | 'loadingFiles' | 'noFiles' | 'noFileMatches' | 'passages'
  | 'error'

/** English copy. */
export const en: Record<KnowledgeLocaleKey, string> = {
  nav: 'Knowledge',
  title: 'Knowledge',
  intro: 'Search your knowledge bases and the memory notes your agents keep.',
  bases: 'Knowledge bases',
  all: 'All',
  indexAll: 'Index all',
  indexOne: 'Index',
  indexing: 'Indexing…',
  failures: '{count} document(s) could not be indexed',
  searchTitle: 'Search',
  searchPlaceholder: 'Search every knowledge base',
  searchIn: 'Search {name}',
  search: 'Search',
  searching: 'Searching…',
  searchHint: 'Ask in plain language; results cite the file and section they came from.',
  noResults: 'No passages matched.',
  related: 'Related',
  notesTitle: 'Memory notes',
  newNote: 'New note',
  pickBase: 'Pick a knowledge base to see its notes.',
  noNotes: 'No notes yet. Agents save notes here with memory_write.',
  noteName: 'Note name',
  noteContent: 'Note content',
  saveNote: 'Save note',
  saving: 'Saving…',
  close: 'Close',
  previewPage: 'Preview page',
  hidePreview: 'Hide page',
  previewLoading: 'Rendering…',
  previewFailed: 'This page could not be rendered.',
  pageAlt: 'Page',
  previewTitle: 'Preview',
  previewHint: 'Pick a search result to preview its file here.',
  previewNoSession: 'Open a session to preview the whole document; showing the matching passage.',
  previewUnavailable: 'This file could not be opened for preview; showing the matching passage.',
  previewTruncated: 'Showing the first pages of a large document.',
  mdCopy: 'Copy',
  mdCopied: 'Copied',
  mdFootnotes: 'Footnotes',
  error: 'The knowledge base could not complete the request.',
  documents: 'documents',
  docsCount: '{count} documents',
  matches: '{count} matching passages',
  view: 'Result view',
  viewList: 'List',
  viewMap: 'Map',
  mapLabel: 'Where “{query}” shows up in your notes',
  mapFrom: 'Open',
  matchLabel: '{percent}% match',
  alsoIn: 'Also in: {folders}',
  browseFiles: 'Browse {name} files →',
  browseTitle: 'Files in {name}',
  backToSearch: '← Knowledge',
  filterFiles: 'Filter by name or folder',
  fileTypes: 'File types',
  loadingFiles: 'Loading files…',
  noFiles: 'Nothing is indexed here yet. Add folders in Settings → Memory, then index.',
  noFileMatches: 'No files match the filter.',
  passages: '{count} passages',
}
