/** Unified diff with per-line review comments. */

import { useState } from 'react'
import type { WorktreeDiffValue } from '@deepseek-ai/dsh-api-remotes/client'
import type { ParallelRunsLocaleKey } from './locales.ts'
import { parsePatch } from './diff.ts'
import type { DiffComment, DiffLine } from './diff.ts'
import css from './DiffView.module.css'

/** Props for {@link DiffView}. */
export interface DiffViewProps {
  /** Locale lookup. */
  readonly t: (key: ParallelRunsLocaleKey) => string
  /** The lane's diff. */
  readonly diff: WorktreeDiffValue
  /**
   * Record a review comment.
   * @param comment - the anchored comment.
   */
  readonly onComment: (comment: DiffComment) => void
}

/** The line a comment is being drafted on. */
interface Drafting {
  readonly path: string
  readonly line: DiffLine
  readonly key: string
}

/**
 * Render a lane's changes; clicking a line opens a comment box under it.
 * @param props - diff, locale, and comment sink.
 * @returns the diff element.
 */
export function DiffView({ t, diff, onComment }: DiffViewProps) {
  const [drafting, setDrafting] = useState<Drafting | undefined>()
  const [text, setText] = useState('')
  const files = parsePatch(diff.patch)
  if (diff.files.length === 0) return <p className={css.empty}>{t('noChanges')}</p>
  return (
    <div className={css.diff}>
      {diff.truncated ? <p className={css.empty}>{t('truncated')}</p> : null}
      {files.map(file => (
        <section key={file.path} className={css.file}>
          <header className={css.fileHead}>
            <span className={css.filePath}>{file.path}</span>
            {(() => {
              const stat = diff.files.find(entry => entry.path === file.path)
              return stat?.additions === undefined ? null : (
                <span className={css.stat}>
                  <span className={css.added}>{`+${stat.additions}`}</span>
                  <span className={css.deleted}>{`-${stat.deletions ?? 0}`}</span>
                </span>
              )
            })()}
          </header>
          {file.binary ? <p className={css.empty}>{t('binary')}</p> : null}
          {file.hunks.map((hunk, hunkIndex) => (
            <div key={`${file.path}:${hunkIndex}`} className={css.hunk}>
              <div className={css.hunkHead}>{hunk.header}</div>
              {hunk.lines.map((line, lineIndex) => {
                const key = `${file.path}:${hunkIndex}:${lineIndex}`
                return (
                  <div key={key}>
                    <button
                      type="button"
                      className={`${css.line} ${line.kind === 'add' ? css.lineAdd : line.kind === 'del' ? css.lineDel : ''}`}
                      title={t('comment')}
                      aria-label={`${t('comment')}: ${file.path}:${line.kind === 'del' ? `-${line.oldNumber ?? ''}` : line.kind === 'add' ? `+${line.newNumber ?? ''}` : String(line.newNumber ?? '')}`}
                      onClick={() => { setDrafting({ path: file.path, line, key }); setText('') }}
                    >
                      <span className={css.number}>{line.oldNumber ?? ''}</span>
                      <span className={css.number}>{line.newNumber ?? ''}</span>
                      <span className={css.marker}>{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}</span>
                      <span className={css.code}>{line.text}</span>
                    </button>
                    {drafting?.key === key ? (
                      <form className={css.commentBox} onSubmit={(event) => {
                        event.preventDefault()
                        if (text.trim() === '') return
                        onComment({ path: drafting.path, line: drafting.line, text })
                        setDrafting(undefined)
                      }}>
                        <textarea
                          className={css.textarea}
                          value={text}
                          autoFocus
                          aria-label={t('commentPlaceholder')}
                          placeholder={t('commentPlaceholder')}
                          onChange={(event) => { setText(event.target.value) }}
                        />
                        <div className={css.actions}>
                          <button type="button" className={css.secondary} onClick={() => { setDrafting(undefined) }}>{t('cancel')}</button>
                          <button type="submit" className={css.primary} disabled={text.trim() === ''}>{t('addComment')}</button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
