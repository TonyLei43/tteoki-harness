/**
 * Knowledge base browser: every indexed file of one knowledge base, grouped
 * by folder under its source roots, with a name filter and file-type chips.
 * Selecting a file hands it to the panel's preview pane.
 */

import { useEffect, useMemo, useState } from 'react'
import type { MemoryCollection, MemoryDocument, MemoryDocumentList } from '@deepseek-ai/dsh-api-remotes/client'
import { IconChevronDownOutlineRegular, IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { KnowledgePanelProps } from './KnowledgePanel.tsx'
import css from './KnowledgePanel.module.css'

/** One file row. */
export interface BrowsedFile {
  readonly document: MemoryDocument
  /** File name. */
  readonly name: string
  /** Folders below the group, such as `Lecture Notes`; empty directly in the group. */
  readonly sub: string
}

/** One folder group. */
export interface DocumentGroup {
  /** Stable key: root and the group's folders. */
  readonly key: string
  /** Display label, such as `UW - Graduate / Spring 2026 / STAT 559`. */
  readonly label: string
  readonly files: readonly BrowsedFile[]
}

/** Folder levels below a root that form a group. */
const GROUP_DEPTH = 2

/**
 * A file's type tag.
 * @param path - file path.
 * @returns `PDF`, `MD`, `TEX`, `NOTE`, `NB`, or the upper-cased extension.
 */
export function typeOf(path: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  switch (extension) {
    case 'pdf': return 'PDF'
    case 'md': case 'markdown': case 'mdx': return 'MD'
    case 'tex': return 'TEX'
    case 'nbn': return 'NOTE'
    case 'ipynb': return 'NB'
    default: return extension === undefined ? 'DOC' : extension.toUpperCase().slice(0, 4)
  }
}

/**
 * Group a knowledge base's files by folder.
 * @param list - the knowledge base's roots and documents.
 * @param filter - case-insensitive text every shown path contains; empty shows all.
 * @param type - only this type tag, or `all`.
 * @returns groups by label, each with its files by name.
 */
export function groupDocuments(list: MemoryDocumentList, filter: string, type: string): DocumentGroup[] {
  const needle = filter.trim().toLowerCase()
  const roots = [...list.roots].sort((a, b) => b.length - a.length)
  const groups = new Map<string, { label: string; files: BrowsedFile[] }>()
  for (const document of list.documents) {
    if (type !== 'all' && typeOf(document.path) !== type) continue
    const root = roots.find(entry => document.path.startsWith(`${entry}/`))
    const rootLabel = root === undefined ? '' : root.split('/').filter(part => part !== '').at(-1) ?? root
    const relative = root === undefined ? document.path : document.path.slice(root.length + 1)
    if (needle !== '' && !relative.toLowerCase().includes(needle)) continue
    const parts = relative.split('/')
    const name = parts.pop() ?? relative
    const head = parts.slice(0, GROUP_DEPTH)
    const label = [rootLabel, ...head].filter(part => part !== '').join(' / ')
    const key = `${root ?? ''}\u0000${head.join('/')}`
    const group = groups.get(key) ?? { label, files: [] }
    group.files.push({ document, name, sub: parts.slice(GROUP_DEPTH).join(' / ') })
    groups.set(key, group)
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, label: group.label, files: group.files.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Count files per type tag.
 * @param documents - documents.
 * @returns type tags with counts, most common first.
 */
export function typeCounts(documents: readonly MemoryDocument[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const document of documents) counts.set(typeOf(document.path), (counts.get(typeOf(document.path)) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/**
 * A short day for a modification time.
 * @param time - epoch milliseconds.
 * @returns such as `Sep 30, 2026`.
 */
function day(time: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(time))
}

/** Props of {@link KnowledgeBrowser}. */
export interface KnowledgeBrowserProps {
  readonly t: KnowledgePanelProps['t']
  readonly collection: MemoryCollection
  readonly listDocuments: KnowledgePanelProps['listDocuments']
  /** Leave the browser. */
  readonly onBack: () => void
  /** Preview a file. */
  readonly onOpen: (document: MemoryDocument) => void
  /** Path of the file being previewed. */
  readonly selected?: string | undefined
  /** Re-index this knowledge base; the list reloads after. */
  readonly onIndex: () => Promise<void>
  readonly busy: boolean
}

/**
 * The browser.
 * @param props - the knowledge base, its reader, and actions.
 * @returns the browser column.
 */
export function KnowledgeBrowser({ t, collection, listDocuments, onBack, onOpen, selected, onIndex, busy }: KnowledgeBrowserProps) {
  const [list, setList] = useState<MemoryDocumentList | undefined>()
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState('')
  const [type, setType] = useState('all')
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setList(undefined)
    listDocuments(collection.id).then(
      (value) => { if (active) { setList(value); setFailed(false) } },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [collection.id, listDocuments, revision])
  const groups = useMemo(() => list === undefined ? [] : groupDocuments(list, filter, type), [list, filter, type])
  const shown = groups.reduce((total, group) => total + group.files.length, 0)
  // Filtering opens every matching group; otherwise groups open on click.
  const isOpen = (key: string): boolean => filter.trim() !== '' || groups.length === 1 || open.has(key)
  return (
    <section className={css.results} aria-label={t('browseTitle').replace('{name}', collection.name)}>
      <div className={css.browseHead}>
        <button type="button" className={css.link} onClick={onBack}>{t('backToSearch')}</button>
        <h2 className={css.browseTitle}>{collection.name}</h2>
        <span className={css.caption}>{list === undefined ? '' : t('docsCount').replace('{count}', String(list.documents.length))}</span>
        <button type="button" className={css.secondary} disabled={busy} onClick={() => { void onIndex().then(() => { setRevision(revision + 1) }) }}>
          {busy ? t('indexing') : t('indexOne')}
        </button>
      </div>
      <div className={css.browseControls}>
        <input
          className={css.input}
          value={filter}
          aria-label={t('filterFiles')}
          placeholder={t('filterFiles')}
          onChange={(event) => { setFilter(event.target.value) }}
        />
        <div className={css.typeChips} role="group" aria-label={t('fileTypes')}>
          <button type="button" className={type === 'all' ? css.tabActive : css.tab} aria-pressed={type === 'all'} onClick={() => { setType('all') }}>
            {t('all')}
            <span className={css.count}>{list?.documents.length ?? 0}</span>
          </button>
          {typeCounts(list?.documents ?? []).map(([tag, count]) => (
            <button key={tag} type="button" className={type === tag ? css.tabActive : css.tab} aria-pressed={type === tag} onClick={() => { setType(tag) }}>
              {tag}
              <span className={css.count}>{count}</span>
            </button>
          ))}
        </div>
      </div>
      {failed ? <p className={css.alert} role="alert">{t('error')}</p> : null}
      {list === undefined && !failed ? <p className={css.empty}>{t('loadingFiles')}</p> : null}
      {list !== undefined && shown === 0 ? <p className={css.empty}>{list.documents.length === 0 ? t('noFiles') : t('noFileMatches')}</p> : null}
      <ul className={css.groups}>
        {groups.map(group => (
          <li key={group.key} className={css.group}>
            <button
              type="button"
              className={css.groupHead}
              aria-expanded={isOpen(group.key)}
              onClick={() => {
                const next = new Set(open)
                if (next.has(group.key)) next.delete(group.key)
                else next.add(group.key)
                setOpen(next)
              }}
            >
              <span className={css.groupChevron} aria-hidden="true">{isOpen(group.key) ? <IconChevronDownOutlineRegular size={14} /> : <IconChevronRightOutlineRegular size={14} />}</span>
              <span className={css.groupLabel}>{group.label === '' ? collection.name : group.label}</span>
              <span className={css.count}>{group.files.length}</span>
            </button>
            {isOpen(group.key) ? (
              <ul className={css.files}>
                {group.files.map(file => (
                  <li key={file.document.path}>
                    <button
                      type="button"
                      className={css.fileRow}
                      aria-pressed={selected === file.document.path}
                      title={file.document.path}
                      onClick={() => { onOpen(file.document) }}
                    >
                      <span className={css.fileTag} data-type={typeOf(file.document.path)}>{typeOf(file.document.path)}</span>
                      <span className={css.fileName}>{file.name}</span>
                      {file.sub === '' ? null : <span className={css.folder}>{file.sub}</span>}
                      <span className={css.fileMeta}>{day(file.document.modified)}</span>
                      <span className={css.fileMeta}>{t('passages').replace('{count}', String(file.document.chunks))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
