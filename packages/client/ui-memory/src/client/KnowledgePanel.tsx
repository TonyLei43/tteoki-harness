/** Knowledge main panel: search, memory notes, and indexing across knowledge bases. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  MemoryCollection, MemoryDocumentList, MemoryHit, MemoryIndexValue, MemorySearchValue, MemoryStatus,
} from '@deepseek-ai/dsh-api-remotes/client'
import { IconSearchOutlineMedium, MarkdownText, MindMap } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels, MindMapLink, MindMapNode } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the session standard props merge (PropsRuntime<'main'>.useSessions).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { KnowledgeLocaleKey } from './knowledge-locales.ts'
import { KnowledgeBrowser, typeOf } from './KnowledgeBrowser.tsx'

export { typeOf as fileType } from './KnowledgeBrowser.tsx'
import css from './KnowledgePanel.module.css'

/** Registration-side business face for the panel. */
export interface KnowledgePanelInjected {
  /** @returns configured knowledge bases and the current index status. */
  load: () => Promise<{ collections: readonly MemoryCollection[]; status: MemoryStatus }>
  /**
   * Search knowledge bases.
   * @param query - query text.
   * @param collections - knowledge-base ids, or undefined for all.
   * @returns ranked passages with related entities.
   */
  search: (query: string, collections: readonly string[] | undefined) => Promise<MemorySearchValue>
  /**
   * Index knowledge bases.
   * @param collections - knowledge-base ids, or undefined for all.
   * @returns counts and per-file failures.
   */
  index: (collections: readonly string[] | undefined) => Promise<MemoryIndexValue>
  /**
   * List one knowledge base's indexed files.
   * @param collection - knowledge-base id.
   * @returns its source roots and documents.
   */
  listDocuments: (collection: string) => Promise<MemoryDocumentList>
  /**
   * List one knowledge base's memory notes.
   * @param collection - knowledge-base id.
   * @returns note names.
   */
  listNotes: (collection: string) => Promise<readonly string[]>
  /**
   * Read one memory note.
   * @param collection - knowledge-base id.
   * @param name - note name.
   * @returns the note content.
   */
  readNote: (collection: string, name: string) => Promise<string>
  /**
   * Create or replace one memory note.
   * @param collection - knowledge-base id.
   * @param name - note name.
   * @param content - full Markdown content.
   */
  writeNote: (collection: string, name: string, content: string) => Promise<void>
  /**
   * Render one page of an indexed document.
   * @param source - the hit's source path.
   * @param page - 1-based page number.
   * @returns an image URL.
   */
  previewPage: (source: string, page: number) => Promise<string>
  /**
   * Read an indexed document's text for the preview pane.
   * @param sessionId - the session whose workspace resolves the path.
   * @param path - the hit's source path, absolute or workspace-relative.
   * @param signal - cancels the read.
   * @returns the document text and whether the page cap truncated it.
   * @throws Error when the file is unreadable or is not text.
   */
  readDocument: (sessionId: SessionId, path: string, signal: AbortSignal) => Promise<{ text: string; truncated: boolean }>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Knowledge panel copy. */
    knowledge: KnowledgeLocaleKey
  }
}

/** Props the renderer binds for the panel. */
export type KnowledgePanelProps =
  PropsRuntime<'main'>
  & PropsLocale<'knowledge'>
  & InjectFace<KnowledgePanelInjected>

/** The note being viewed or drafted in the notes column. */
interface NoteDraft {
  /** Note name; empty while a new note is unnamed. */
  readonly name: string
  /** Editor content. */
  readonly content: string
  /** Whether the note already exists on disk. */
  readonly stored: boolean
}

/**
 * Last path segment of a source path, for the result title.
 * @param path - absolute source path.
 * @returns the file or bundle name.
 */
function baseName(path: string): string {
  return path.split('/').filter(part => part !== '').pop() ?? path
}

/**
 * The page a hit came from, when its heading names one.
 * @param heading - the hit's heading.
 * @returns the 1-based page, or undefined.
 */
export function hitPage(heading: string | undefined): number | undefined {
  const match = /^Page (\d+)$/.exec(heading ?? '')
  return match === null ? undefined : Number(match[1])
}

/**
 * The folder a source sits in, such as a course folder.
 * @param path - source path.
 * @returns the parent folder name, or an empty string.
 */
export function folderOf(path: string): string {
  return path.split('/').filter(part => part !== '').at(-2) ?? ''
}

/**
 * The group a source belongs to: the nearest course folder on its path (such
 * as `STAT 559`), else its parent folder.
 * @param path - source path.
 * @returns the group name, or an empty string.
 */
export function groupOf(path: string): string {
  const parts = path.split('/').filter(part => part !== '')
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    const course = /^([A-Z]{2,6})[ _]?(\d{3}[A-Z]?)(?![A-Za-z0-9])/.exec(parts[index] ?? '')
    if (course !== null) return `${course[1]} ${course[2]}`
  }
  return folderOf(path)
}

/**
 * Filled cells of a five-cell match meter.
 * @param score - cosine similarity.
 * @returns 1 to 5.
 */
export function meterCells(score: number): number {
  return Math.min(5, Math.max(1, Math.round((score - 0.25) / 0.12) + 1))
}

/**
 * The map of a search: the query in the center, the courses (or folders) the
 * matches come from around it, and each matching document on the outer ring.
 * @param query - the searched text.
 * @param hits - search hits.
 * @returns concepts and links for {@link MindMap}.
 */
export function resultMap(query: string, hits: readonly MemoryHit[]): { nodes: MindMapNode[]; links: MindMapLink[] } {
  const nodes: MindMapNode[] = [{ id: 'query', label: query }]
  const links: MindMapLink[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    const folder = groupOf(hit.source) || hit.collection
    const folderId = `folder:${folder}`
    if (!seen.has(folderId)) {
      seen.add(folderId)
      nodes.push({ id: folderId, label: folder })
      links.push({ from: 'query', to: folderId })
    }
    const docId = `doc:${hit.source}`
    if (seen.has(docId)) continue
    seen.add(docId)
    nodes.push({
      id: docId,
      label: baseName(hit.source).replace(/\.[a-z0-9]+$/i, ''),
      detail: hit.text.length > 220 ? `${hit.text.slice(0, 220).trimEnd()}…` : hit.text,
      sources: [hit.source],
    })
    links.push({ from: folderId, to: docId, ...hit.heading === undefined ? {} : { label: hit.heading } })
  }
  return { nodes, links }
}

/** One result card: a hit and the other folders the same passage was also found in. */
export interface FoldedHit {
  readonly hit: MemoryHit
  readonly alsoIn: readonly string[]
}

/**
 * Fold repeated passages, such as one file copied into two folders, into the best hit.
 * @param hits - search hits, best first.
 * @returns one entry per distinct passage, with the folders of its copies.
 */
export function foldHits(hits: readonly MemoryHit[]): FoldedHit[] {
  const folded: { hit: MemoryHit; alsoIn: string[] }[] = []
  const byText = new Map<string, { hit: MemoryHit; alsoIn: string[] }>()
  for (const hit of hits) {
    const key = hit.text.replace(/\s+/g, ' ').trim().slice(0, 200).toLowerCase()
    const first = byText.get(key)
    if (first === undefined) {
      const entry = { hit, alsoIn: [] }
      byText.set(key, entry)
      folded.push(entry)
      continue
    }
    const folder = folderOf(hit.source)
    if (folder !== '' && folder !== folderOf(first.hit.source) && !first.alsoIn.includes(folder)) first.alsoIn.push(folder)
  }
  return folded
}

/**
 * A five-cell pixel meter of how well a passage matched.
 * @param props.score - cosine similarity.
 * @param props.label - accessible description.
 * @returns the meter.
 */
function MatchMeter({ score, label }: { score: number; label: string }) {
  const filled = meterCells(score)
  return (
    <span className={css.meter} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={1} aria-valuenow={Math.round(score * 100) / 100} title={score.toFixed(2)}>
      {[1, 2, 3, 4, 5].map(cell => <span key={cell} className={cell <= filled ? css.cellOn : css.cell} />)}
    </span>
  )
}

/** What the preview pane shows for the selected hit. */
export type PreviewContent =
  | { readonly kind: 'text'; readonly text: string; readonly markdown: boolean; readonly truncated: boolean }
  | { readonly kind: 'page'; readonly url: string; readonly page: number }
  | { readonly kind: 'passage'; readonly reason: 'noSession' | 'unavailable' }

/** The readers the preview load calls. */
export interface PreviewReaders {
  /** @see KnowledgePanelInjected.previewPage */
  readonly previewPage: KnowledgePanelInjected['previewPage']
  /** @see KnowledgePanelInjected.readDocument */
  readonly readDocument: KnowledgePanelInjected['readDocument']
}

/**
 * Whether a source path renders as Markdown.
 * @param path - the source path.
 * @returns whether the extension is a Markdown one.
 */
export function isMarkdown(path: string): boolean {
  return /\.(?:md|markdown|mdx)$/i.test(path)
}

/**
 * Load the preview for one hit: the rendered page when the hit names one, else
 * the document text through the current session, else the indexed passage.
 * @param hit - the selected search hit.
 * @param sessionId - the current session, or undefined when none is selected.
 * @param readers - the page renderer and document reader.
 * @param signal - cancels the document read.
 * @returns the preview content; never rejects.
 */
export async function loadHit(
  hit: MemoryHit,
  sessionId: SessionId | undefined,
  readers: PreviewReaders,
  signal: AbortSignal,
): Promise<PreviewContent> {
  const page = hitPage(hit.heading)
  if (page !== undefined) {
    try {
      return { kind: 'page', url: await readers.previewPage(hit.source, page), page }
    } catch {
      // A document without rendered pages falls through to its text.
    }
  }
  if (sessionId === undefined) return { kind: 'passage', reason: 'noSession' }
  try {
    const { text, truncated } = await readers.readDocument(sessionId, hit.source, signal)
    return { kind: 'text', text, markdown: isMarkdown(hit.source), truncated }
  } catch {
    return { kind: 'passage', reason: 'unavailable' }
  }
}

/**
 * A search hit's page preview: a toggle that loads and shows the rendered page.
 * @param props - locale, source, page, and the renderer.
 * @returns the preview control.
 */
function PagePreview({ t, source, page, previewPage }: { t: KnowledgePanelProps['t']; source: string; page: number; previewPage: KnowledgePanelInjected['previewPage'] }) {
  const [state, setState] = useState<'closed' | 'loading' | 'failed' | { url: string }>('closed')
  return (
    <div className={css.preview}>
      <button type="button" className={css.link} onClick={() => {
        if (state !== 'closed' && state !== 'failed') { setState('closed'); return }
        setState('loading')
        previewPage(source, page).then((url) => { setState({ url }) }, () => { setState('failed') })
      }}>
        {state === 'closed' || state === 'failed' ? t('previewPage') : t('hidePreview')}
      </button>
      {state === 'loading' ? <span className={css.caption}>{t('previewLoading')}</span> : null}
      {state === 'failed' ? <span className={css.caption}>{t('previewFailed')}</span> : null}
      {typeof state === 'object' ? <img className={css.pageImage} src={state.url} alt={`${t('pageAlt')} ${page}`} /> : null}
    </div>
  )
}

/**
 * Render the Knowledge panel.
 * @param props - locale binding and the injected business face.
 * @returns the panel element.
 */
export function KnowledgePanel({
  t, load, search, index, listNotes, readNote, writeNote, previewPage, readDocument, listDocuments, useSessions,
}: KnowledgePanelProps) {
  const [collections, setCollections] = useState<readonly MemoryCollection[]>([])
  const [status, setStatus] = useState<MemoryStatus | undefined>()
  const [selected, setSelected] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemorySearchValue | undefined>()
  const [notes, setNotes] = useState<readonly string[]>([])
  const [draft, setDraft] = useState<NoteDraft | undefined>()
  const [failures, setFailures] = useState<MemoryIndexValue['failures']>([])
  const [busy, setBusy] = useState<'search' | 'index' | 'note' | undefined>()
  const [failed, setFailed] = useState(false)
  const [side, setSide] = useState<'notes' | 'preview'>('notes')
  const [selectedHit, setSelectedHit] = useState<MemoryHit | undefined>()
  const [content, setContent] = useState<PreviewContent | undefined>()
  const [previewing, setPreviewing] = useState(false)
  const [view, setView] = useState<'list' | 'map'>('list')
  const [browsing, setBrowsing] = useState<string | undefined>()
  const [searched, setSearched] = useState('')

  const sessionId = useSessions(state => Object.values(state.byId)
    .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id)

  // Load the selected hit's preview through the current session; a later
  // selection or unmount aborts the read.
  useEffect(() => {
    if (selectedHit === undefined) {
      setContent(undefined)
      setPreviewing(false)
      return
    }
    const controller = new AbortController()
    let active = true
    setPreviewing(true)
    setContent(undefined)
    void loadHit(selectedHit, sessionId, { previewPage, readDocument }, controller.signal).then((next) => {
      if (!active) return
      setContent(next)
      setPreviewing(false)
    })
    return () => { active = false; controller.abort() }
  }, [selectedHit, sessionId, previewPage, readDocument])

  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('mdCopy'), copiedLabel: t('mdCopied') },
    footnotes: t('mdFootnotes'),
  }), [t])

  const scope = selected === undefined ? undefined : [selected]

  const run = async (kind: 'search' | 'index' | 'note', task: () => Promise<void>): Promise<void> => {
    setBusy(kind)
    setFailed(false)
    try {
      await task()
    } catch {
      setFailed(true)
    } finally {
      setBusy(undefined)
    }
  }

  useEffect(() => {
    let active = true
    load().then(
      (value) => {
        if (!active) return
        setCollections(value.collections)
        setStatus(value.status)
      },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [load])

  const refreshNotes = useCallback(async (collection: string | undefined): Promise<void> => {
    setNotes(collection === undefined ? [] : await listNotes(collection))
  }, [listNotes])

  useEffect(() => {
    setDraft(undefined)
    refreshNotes(selected).catch(() => { setFailed(true) })
  }, [selected, refreshNotes])

  const folded = useMemo(() => results === undefined ? [] : foldHits(results.hits), [results])
  const map = useMemo(() => results === undefined ? undefined : resultMap(searched, folded.map(entry => entry.hit)), [results, folded, searched])
  const countFor = (id: string): number => status?.collections.find(entry => entry.id === id)?.documents ?? 0
  const nameFor = (id: string): string => collections.find(entry => entry.id === id)?.name ?? id
  const current = collections.find(entry => entry.id === selected)

  const browsed = collections.find(entry => entry.id === browsing)
  const submit = (): void => {
    if (query.trim() === '') return
    setBrowsing(undefined)
    void run('search', async () => {
      setResults(await search(query, scope))
      setSearched(query.trim())
    })
  }

  return (
    <div className={css.panel}>
      <header className={css.header}>
        <div className={css.heroText}>
          <h1 className={css.title}>{t('title')}</h1>
          <p className={css.caption}>{current?.description ?? t('intro')}</p>
        </div>
        <div className={css.heroSide}>
          <span className={css.stat}><strong>{status?.documents ?? 0}</strong> {t('documents')}</span>
          <button type="button" className={css.secondary} disabled={busy !== undefined} onClick={() => {
            void run('index', async () => {
              const value = await index(scope)
              setStatus(value)
              setFailures(value.failures)
            })
          }}>
            {busy === 'index' ? t('indexing') : selected === undefined ? t('indexAll') : t('indexOne')}
          </button>
        </div>
      </header>

      <form className={css.spotlight} onSubmit={(event) => { event.preventDefault(); submit() }}>
        <span className={css.spotlightIcon} aria-hidden="true"><IconSearchOutlineMedium size={18} /></span>
        <input
          className={css.spotlightInput}
          value={query}
          aria-label={t('searchPlaceholder')}
          placeholder={selected === undefined ? t('searchPlaceholder') : t('searchIn').replace('{name}', nameFor(selected))}
          onChange={(event) => { setQuery(event.target.value) }}
        />
        <button type="submit" className={css.primary} disabled={busy !== undefined || query.trim() === ''}>
          {busy === 'search' ? t('searching') : t('search')}
        </button>
      </form>

      <nav className={css.tabs} aria-label={t('bases')}>
        <button type="button" className={selected === undefined ? css.tabActive : css.tab} aria-pressed={selected === undefined} onClick={() => { setSelected(undefined) }}>
          {t('all')}
          <span className={css.count}>{status?.documents ?? 0}</span>
        </button>
        {collections.map(collection => (
          <button
            key={collection.id}
            type="button"
            className={selected === collection.id ? css.tabActive : css.tab}
            aria-pressed={selected === collection.id}
            onClick={() => { setSelected(collection.id) }}
          >
            {collection.name}
            <span className={css.count}>{countFor(collection.id)}</span>
          </button>
        ))}
        {current === undefined || browsing === current.id ? null : (
          <button type="button" className={css.link} onClick={() => { setBrowsing(current.id) }}>{t('browseFiles').replace('{name}', current.name)}</button>
        )}
      </nav>

      {failed ? <p className={css.alert} role="alert">{t('error')}</p> : null}
      {failures.length > 0 ? (
        <details className={css.failures}>
          <summary>{t('failures').replace('{count}', String(failures.length))}</summary>
          <ul>
            {failures.map(failure => <li key={failure.path}><code>{failure.path}</code> — {failure.message}</li>)}
          </ul>
        </details>
      ) : null}

      <div className={css.columns}>
        {browsed !== undefined ? (
          <KnowledgeBrowser
            t={t}
            collection={browsed}
            listDocuments={listDocuments}
            onBack={() => { setBrowsing(undefined) }}
            selected={selectedHit?.source}
            busy={busy !== undefined}
            onIndex={async () => {
              await run('index', async () => {
                const value = await index([browsed.id])
                setStatus(value)
                setFailures(value.failures)
              })
            }}
            onOpen={(document) => {
              // A browsed file previews like a hit: page 1 of a paged document, else its text.
              setSelectedHit({
                source: document.path,
                collection: browsed.id,
                .../\.(pdf|nbn)$/i.test(document.path) ? { heading: 'Page 1' } : {},
                text: t('passages').replace('{count}', String(document.chunks)),
                score: 0,
              })
              setSide('preview')
            }}
          />
        ) : (
        <section className={css.results} aria-label={t('searchTitle')}>
          {results === undefined ? (
            <>
              <p className={css.empty}>{t('searchHint')}</p>
              <div className={css.bento}>
                {collections.map(collection => (
                  <button key={collection.id} type="button" className={css.baseCard} onClick={() => { setSelected(collection.id); setBrowsing(collection.id) }}>
                    <span className={css.baseName}>{collection.name}</span>
                    <span className={css.baseCount}>{t('docsCount').replace('{count}', String(countFor(collection.id)))}</span>
                    {collection.description === undefined ? null : <span className={css.baseText}>{collection.description}</span>}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {results !== undefined && results.hits.length === 0 ? <p className={css.empty}>{t('noResults')}</p> : null}
          {results !== undefined && results.hits.length > 0 ? (
            <div className={css.toolbar}>
              <span className={css.caption}>{t('matches').replace('{count}', String(folded.length))}</span>
              <div className={css.viewSwitch} role="tablist" aria-label={t('view')}>
                <button type="button" role="tab" aria-selected={view === 'list'} className={css.viewTab} onClick={() => { setView('list') }}>{t('viewList')}</button>
                <button type="button" role="tab" aria-selected={view === 'map'} className={css.viewTab} onClick={() => { setView('map') }}>{t('viewMap')}</button>
              </div>
            </div>
          ) : null}
          {view === 'map' && map !== undefined && results !== undefined && results.hits.length > 0 ? (
            <div className={css.mapCard}>
              <MindMap
                center="query"
                nodes={map.nodes}
                links={map.links}
                label={t('mapLabel').replace('{query}', searched)}
                sourcesLabel={t('mapFrom')}
                onSource={(source) => {
                  const hit = results.hits.find(entry => entry.source === source)
                  if (hit !== undefined) { setSelectedHit(hit); setSide('preview') }
                }}
              />
            </div>
          ) : (
            <ul className={css.hits}>
              {folded.map(({ hit, alsoIn }) => (
                <li key={`${hit.source}\u0000${hit.text.slice(0, 32)}`} className={css.hit} data-selected={selectedHit === hit}>
                  <button
                    type="button"
                    className={`${css.hitHead} ${css.hitOpen}`}
                    aria-pressed={selectedHit === hit}
                    onClick={() => { setSelectedHit(hit); setSide('preview') }}
                  >
                    <span className={css.fileTag} data-type={typeOf(hit.source)}>{typeOf(hit.source)}</span>
                    <span className={css.hitTitle}>{baseName(hit.source)}{hit.heading === undefined ? '' : ` · ${hit.heading}`}</span>
                    <MatchMeter score={hit.score} label={t('matchLabel').replace('{percent}', String(Math.round(hit.score * 100)))} />
                  </button>
                  <div className={css.hitMeta}>
                    <span className={css.badge}>{nameFor(hit.collection)}</span>
                    {groupOf(hit.source) === '' ? null : <span className={css.folder}>{groupOf(hit.source)}</span>}
                    <p className={css.path} title={hit.source}>{hit.source}</p>
                  </div>
                  {alsoIn.length === 0 ? null : <p className={css.caption}>{t('alsoIn').replace('{folders}', alsoIn.join(', '))}</p>}
                  <div className={css.snippet}><MarkdownText text={hit.text} labels={markdownLabels} variant="compact" /></div>
                  {(() => {
                    const page = hitPage(hit.heading)
                    return page === undefined ? null : <PagePreview t={t} source={hit.source} page={page} previewPage={previewPage} />
                  })()}
                </li>
              ))}
            </ul>
          )}
          {results !== undefined && results.entities.length > 0 ? (
            <p className={css.caption}>{`${t('related')}: ${results.entities.map(entity => entity.name).join(', ')}`}</p>
          ) : null}
        </section>
        )}

        <aside className={css.notes} aria-label={side === 'preview' ? t('previewTitle') : t('notesTitle')}>
          <div className={css.sideTabs}>
            <button type="button" className={side === 'notes' ? css.tabActive : css.tab} aria-pressed={side === 'notes'} onClick={() => { setSide('notes') }}>{t('notesTitle')}</button>
            <button type="button" className={side === 'preview' ? css.tabActive : css.tab} aria-pressed={side === 'preview'} onClick={() => { setSide('preview') }}>{t('previewTitle')}</button>
          </div>
          {side === 'preview' ? (
            <div className={css.previewPane}>
              {selectedHit === undefined ? <p className={css.empty}>{t('previewHint')}</p> : (
                <>
                  <div className={css.previewHead}>
                    <span className={css.badge}>{nameFor(selectedHit.collection)}</span>
                    <span className={css.hitTitle}>{baseName(selectedHit.source)}</span>
                  </div>
                  <p className={css.path} title={selectedHit.source}>{selectedHit.source}</p>
                  {previewing ? <p className={css.empty}>{t('previewLoading')}</p> : null}
                  {content?.kind === 'text' ? (content.markdown
                    ? <div className={css.markdown}><MarkdownText text={content.text} streaming={false} labels={markdownLabels} /></div>
                    : <pre className={css.textPreview}>{content.text}</pre>
                  ) : null}
                  {content?.kind === 'page' ? <img className={css.pageImage} src={content.url} alt={`${t('pageAlt')} ${content.page}`} /> : null}
                  {content?.kind === 'passage' ? (
                    <>
                      <p className={css.caption}>{content.reason === 'noSession' ? t('previewNoSession') : t('previewUnavailable')}</p>
                      <p className={css.snippet}>{selectedHit.text}</p>
                    </>
                  ) : null}
                  {content?.kind === 'text' && content.truncated ? <p className={css.caption}>{t('previewTruncated')}</p> : null}
                </>
              )}
            </div>
          ) : (
            <div className={css.notesBody}>
              <div className={css.notesHead}>
                <h2 className={css.subtitle}>{t('notesTitle')}</h2>
                {selected === undefined ? null : (
                  <button type="button" className={css.secondary} disabled={busy !== undefined} onClick={() => { setDraft({ name: '', content: '', stored: false }) }}>
                    {t('newNote')}
                  </button>
                )}
              </div>
              {selected === undefined ? <p className={css.empty}>{t('pickBase')}</p> : null}
              {selected !== undefined && notes.length === 0 && draft === undefined ? <p className={css.empty}>{t('noNotes')}</p> : null}
              <ul className={css.noteList}>
                {notes.map(name => (
                  <li key={name}>
                    <button
                      type="button"
                      className={draft?.name === name && draft.stored ? css.noteActive : css.note}
                      onClick={() => {
                        if (selected === undefined) return
                        void run('note', async () => { setDraft({ name, content: await readNote(selected, name), stored: true }) })
                      }}
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
              {draft === undefined || selected === undefined ? null : (
                <form className={css.editor} onSubmit={(event) => {
                  event.preventDefault()
                  const name = draft.name.trim()
                  if (name === '') return
                  void run('note', async () => {
                    await writeNote(selected, name, draft.content)
                    setDraft({ name, content: draft.content, stored: true })
                    await refreshNotes(selected)
                  })
                }}>
                  {draft.stored ? <h3 className={css.noteName}>{draft.name}</h3> : (
                    <input
                      className={css.input}
                      value={draft.name}
                      aria-label={t('noteName')}
                      placeholder={t('noteName')}
                      onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }}
                    />
                  )}
                  <textarea
                    className={css.textarea}
                    value={draft.content}
                    aria-label={t('noteContent')}
                    onChange={(event) => { setDraft({ ...draft, content: event.target.value }) }}
                  />
                  <div className={css.editorActions}>
                    <button type="button" className={css.secondary} onClick={() => { setDraft(undefined) }}>{t('close')}</button>
                    <button type="submit" className={css.primary} disabled={busy !== undefined || draft.name.trim() === ''}>
                      {busy === 'note' ? t('saving') : t('saveNote')}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
