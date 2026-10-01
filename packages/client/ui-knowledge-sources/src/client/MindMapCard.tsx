/**
 * Mind maps in the Chat: the Turn-tail card that draws each map a Turn made,
 * with an expanded full-window view for studying, and the one-line `mind_map`
 * row inside the Turn's work details. Maps are read from the calls' logged
 * arguments, so a reload redraws them from the Session log.
 */

import { useEffect, useState } from 'react'
import { MindMap } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MindMapLink, MindMapNode } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { selectMindMaps } from './mind-map-turn.ts'
import css from './MindMapCard.module.css'

/** Props the renderer binds for the one-line row in the work details. */
export type MindMapCardProps = ToolCallViewProps & PropsLocale<'knowledge-sources'>

/** Props the renderer binds for the Turn-tail maps. */
export type MindMapTailProps = PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<'knowledge-sources'>

/** A map read from call arguments. */
export interface MindMapArgs {
  readonly title: string
  readonly center: string
  readonly nodes: readonly MindMapNode[]
  readonly links: readonly MindMapLink[]
}

/**
 * Undo HTML escaping models sometimes apply inside JSON strings.
 * @param text - model text.
 * @returns the text with `&amp;`, `&lt;`, `&gt;`, `&quot;`, and `&#39;` decoded.
 */
export function unescapeHtml(text: string): string {
  const named: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (match, name: string) => named[name] ?? match)
}

/**
 * Read a map from raw call arguments; partial or malformed JSON reads as no map.
 * @param raw - the call's argument JSON.
 * @returns the map, or undefined.
 */
export function readMindMap(raw: string): MindMapArgs | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    // Arguments still streaming are incomplete JSON; the card waits for the rest.
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.center !== 'string' || !Array.isArray(record.concepts)) return undefined
  const concepts: readonly unknown[] = record.concepts
  const links: readonly unknown[] = Array.isArray(record.links) ? record.links : []
  const text = (field: unknown): string | undefined => typeof field === 'string' && field !== '' ? unescapeHtml(field) : undefined
  const nodes: MindMapNode[] = concepts.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const concept = entry as Record<string, unknown>
    const id = text(concept.id)
    const label = text(concept.label)
    if (id === undefined || label === undefined) return []
    const sourceList: readonly unknown[] = Array.isArray(concept.sources) ? concept.sources : []
    const sources = sourceList.filter((source): source is string => typeof source === 'string').map(unescapeHtml)
    return [{ id, label, detail: text(concept.detail), sources }]
  })
  const edges: MindMapLink[] = links.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const link = entry as Record<string, unknown>
    const from = text(link.from)
    const to = text(link.to)
    return from === undefined || to === undefined ? [] : [{ from, to, label: text(link.label) }]
  })
  return { title: text(record.title) ?? '', center: record.center, nodes, links: edges }
}

/**
 * One drawn map with its expanded view.
 * @param props - the map, locale, and file opener.
 * @returns the card.
 */
function MapCard({ map, t, openFile }: { map: MindMapArgs; t: MindMapTailProps['t']; openFile: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (!expanded) return
    const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') setExpanded(false) }
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('keydown', close) }
  }, [expanded])
  // Citations like "K2" are labels; anything that looks like a path opens the file.
  const onSource = (source: string): void => { if (source.includes('/')) openFile(source) }
  const title = map.title === '' ? t('mindMap') : map.title
  const body = <MindMap center={map.center} nodes={map.nodes} links={map.links} label={title} sourcesLabel={t('mapSources')} onSource={onSource} />
  return (
    <section className={css.card} aria-label={title}>
      <header className={css.head}>
        <span className={css.kicker}>{t('mindMap')}</span>
        <span className={css.title}>{map.title}</span>
        <button type="button" className={css.expand} onClick={() => { setExpanded(true) }}>{t('expandMap')}</button>
      </header>
      {expanded ? null : body}
      {expanded
        ? (
          <div className={css.overlay} role="dialog" aria-modal="true" aria-label={title}>
            <div className={css.sheet}>
              <header className={css.head}>
                <span className={css.kicker}>{t('mindMap')}</span>
                <span className={css.title}>{map.title}</span>
                <button type="button" className={css.expand} onClick={() => { setExpanded(false) }}>{t('closeMap')}</button>
              </header>
              {body}
            </div>
          </div>
        )
        : null}
    </section>
  )
}

/**
 * The maps a Turn drew, under its answer.
 * @param props - the Turn, file opener, and locale.
 * @returns one card per map, or nothing.
 */
export function MindMapTail({ turn, openFile, t }: MindMapTailProps) {
  const maps = selectMindMaps(turn).flatMap((entry) => {
    const map = readMindMap(entry.argsRaw)
    return map === undefined || map.nodes.length === 0 ? [] : [{ callId: entry.callId, map }]
  })
  if (maps.length === 0) return null
  return <>{maps.map(entry => <MapCard key={entry.callId} map={entry.map} t={t} openFile={openFile} />)}</>
}

/**
 * The `mind_map` row inside the work details: what is being drawn, or why it failed.
 * @param props - the tool call and locale.
 * @returns one line.
 */
export function MindMapCard(props: MindMapCardProps) {
  const { t } = props
  if (props.phase === 'preparing') return <p className={css.status}>{t('drawingMap')}</p>
  const block = props.block
  const settled = 'kind' in block
  const raw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  if (settled && block.isError) {
    const reason = block.content.map(item => item.type === 'text' ? item.text : '').join(' ').trim()
    return <p className={css.status}>{t('mapFailed').replace('{reason}', reason)}</p>
  }
  const map = readMindMap(raw)
  if (!settled || map === undefined) return <p className={css.status}>{t('drawingMap')}</p>
  return <p className={css.status}>{t('mapShown').replace('{title}', map.title === '' ? t('mindMap') : map.title)}</p>
}
