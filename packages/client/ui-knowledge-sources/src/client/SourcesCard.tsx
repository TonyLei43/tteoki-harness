/**
 * Turn-tail card listing the notes a grounded answer drew on. Each passage is
 * a chip with its citation label, file, and page; opening a chip shows the
 * passage with its math rendered, a preview of the page for PDFs and
 * Notability notes, and a button that opens the file.
 */

import { useMemo, useState } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { KnowledgeSourcesLocaleKey } from './locales.ts'
import { selectSources } from './sources-turn.ts'
import type { SourcePassage } from './sources-turn.ts'
import css from './SourcesCard.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Knowledge Sources card copy. */
    'knowledge-sources': KnowledgeSourcesLocaleKey
  }
}

/** What the card needs beyond the Turn. */
export interface SourcesCardInjected {
  /**
   * Render one page of an indexed document.
   * @param source - document path.
   * @param page - 1-based page.
   * @returns an image URL.
   */
  readonly previewPage: (source: string, page: number) => Promise<string>
}

/** Props the renderer binds for the card. */
export type SourcesCardProps = PropsRuntime<'conversation.chat.turnTail'>
  & InjectFace<SourcesCardInjected>
  & PropsLocale<'knowledge-sources'>

/**
 * A file's display name and folder.
 * @param path - absolute path.
 * @returns the file name without extension, and its parent folder name.
 */
export function fileLabel(path: string): { name: string; folder: string } {
  const parts = path.split('/').filter(part => part !== '')
  const file = parts.at(-1) ?? path
  return { name: file.replace(/\.(md|pdf|tex|nbn|txt)$/i, ''), folder: parts.at(-2) ?? '' }
}

/** Formats with page previews. */
const PAGED = /\.(pdf|nbn)$/i

/**
 * One opened passage: text, page preview, and file action.
 * @param props - the passage, locale, and actions.
 * @returns the detail panel.
 */
function PassageDetail({ passage, t, previewPage, openFile }: {
  passage: SourcePassage
  t: SourcesCardProps['t']
  previewPage: SourcesCardInjected['previewPage']
  openFile: (path: string) => void
}) {
  const [image, setImage] = useState<string | 'loading' | 'failed' | undefined>()
  const labels = useMemo(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: { codeLabel: t('codeBlock'), wrapLabel: t('wrap'), unwrapLabel: t('unwrap') } },
    footnotes: t('footnotes'),
  }), [t])
  const page = passage.page
  return (
    <div className={css.detail}>
      <div className={css.detailHead}>
        <span className={css.path} title={passage.source}>{passage.source}</span>
        <span className={css.muted}>{t('match').replace('{percent}', String(Math.round(passage.score * 100)))}</span>
      </div>
      <div className={css.passage}><MarkdownText text={passage.text} labels={labels} variant="compact" /></div>
      <div className={css.actions}>
        {page !== undefined && PAGED.test(passage.source)
          ? (
            <button type="button" className={css.link} onClick={() => {
              if (image !== undefined && image !== 'failed') { setImage(undefined); return }
              setImage('loading')
              previewPage(passage.source, page).then(setImage, () => { setImage('failed') })
            }}>{image !== undefined && image !== 'failed' ? t('hidePage') : t('showPage')}</button>
          )
          : null}
        <button type="button" className={css.link} onClick={() => { openFile(passage.source) }}>{t('openFile')}</button>
      </div>
      {image === 'loading' ? <p className={css.muted}>{t('loadingPage')}</p> : null}
      {image === 'failed' ? <p className={css.muted}>{t('pageFailed')}</p> : null}
      {image !== undefined && image !== 'loading' && image !== 'failed' ? <img className={css.page} src={image} alt={`${fileLabel(passage.source).name} ${t('page').replace('{page}', String(page))}`} /> : null}
    </div>
  )
}

/**
 * The Sources card of one Turn.
 * @param props - the Turn, locale, and preview action.
 * @returns the card, or nothing when the Turn was not grounded.
 */
export function SourcesCard({ turn, openFile, previewPage, t }: SourcesCardProps) {
  const data = selectSources(turn)
  const [open, setOpen] = useState<string | undefined>()
  if (data === null) return null
  const selected = data.passages.find(passage => passage.label === open)
  return (
    <section className={css.card} aria-label={t('title')}>
      <header className={css.head}>
        <span className={css.title}>{t('title')}</span>
        {data.error !== undefined ? <span className={css.muted}>{t('failed').replace('{error}', data.error)}</span> : null}
        {data.error === undefined && data.passages.length === 0 ? <span className={css.muted}>{t('none')}</span> : null}
      </header>
      {data.passages.length === 0 ? null : (
        <ul className={css.chips}>
          {data.passages.map((passage) => {
            const label = fileLabel(passage.source)
            return (
              <li key={passage.label}>
                <button
                  type="button"
                  className={css.chip}
                  aria-expanded={open === passage.label}
                  title={passage.heading ?? passage.source}
                  onClick={() => { setOpen(open === passage.label ? undefined : passage.label) }}
                >
                  <span className={css.label}>{passage.label}</span>
                  <span className={css.name}>{label.name}</span>
                  {passage.page === undefined ? null : <span className={css.muted}>{t('page').replace('{page}', String(passage.page))}</span>}
                  {label.folder === '' ? null : <span className={css.folder}>{label.folder}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {selected === undefined ? null : <PassageDetail key={selected.label} passage={selected} t={t} previewPage={previewPage} openFile={openFile} />}
    </section>
  )
}
