/**
 * A radial mind map: a center topic, the concepts around it on rings by
 * distance, and labeled links. The spanning tree from the center fans out
 * with each branch's angle proportional to its leaves; links outside that
 * tree draw as dashed curves across the map; ring radii grow with their
 * population. On a large map, link labels show only around the hovered or
 * selected concept. Selecting a concept shows its detail and source chips
 * below the map.
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import css from './MindMap.module.css'

/** One concept. */
export interface MindMapNode {
  /** Unique id, referenced by links. */
  readonly id: string
  readonly label: string
  /** One or two sentences shown when the concept is selected. */
  readonly detail?: string | undefined
  /** Where the concept comes from, such as citation labels or file names. */
  readonly sources?: readonly string[] | undefined
}

/** One labeled connection between two concepts. */
export interface MindMapLink {
  readonly from: string
  readonly to: string
  /** How the two relate, such as "generalizes" or "used in the proof of". */
  readonly label?: string | undefined
}

/** A positioned concept. */
export interface PlacedNode {
  readonly node: MindMapNode
  readonly x: number
  readonly y: number
  /** Rings from the center; 0 for the center. */
  readonly depth: number
  /** Index of the first-ring ancestor; -1 for the center. */
  readonly branch: number
}

/** A computed layout. */
export interface MindMapLayout {
  readonly placed: ReadonlyMap<string, PlacedNode>
  /** Links of the spanning tree, parent first. */
  readonly tree: readonly MindMapLink[]
  /** Links outside the spanning tree. */
  readonly cross: readonly MindMapLink[]
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
}

/** Least distance between rings: clears a center bubble and a neighbor side by side. */
const RING = 230

/** Arc length each concept on a ring needs, so neighbors do not overlap. */
const ARC_PER_NODE = 200

/** Above this many concepts, link labels show only around the hovered or selected concept. */
const QUIET_LABELS_ABOVE = 12

/**
 * Lay a map out radially around its center.
 * @param center - id of the center concept; the first node when it names none.
 * @param nodes - concepts; duplicate ids keep the first.
 * @param links - connections; links naming unknown concepts are dropped.
 * @returns positions and the tree/cross split of the links.
 */
export function layoutMindMap(center: string, nodes: readonly MindMapNode[], links: readonly MindMapLink[]): MindMapLayout {
  const byId = new Map<string, MindMapNode>()
  for (const node of nodes) if (!byId.has(node.id)) byId.set(node.id, node)
  const root = byId.has(center) ? center : nodes[0]?.id
  const empty = { placed: new Map(), tree: [], cross: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }
  if (root === undefined) return empty
  const valid = links.filter(link => byId.has(link.from) && byId.has(link.to) && link.from !== link.to)
  const neighbors = new Map<string, MindMapLink[]>()
  for (const link of valid) {
    neighbors.set(link.from, [...neighbors.get(link.from) ?? [], link])
    neighbors.set(link.to, [...neighbors.get(link.to) ?? [], link])
  }
  // Breadth-first spanning tree; concepts the links never reach hang off the center.
  const parent = new Map<string, string>()
  const children = new Map<string, string[]>()
  const depth = new Map<string, number>([[root, 0]])
  const tree: MindMapLink[] = []
  const queue = [root]
  while (queue.length > 0) {
    const id = queue.shift() ?? root
    for (const link of neighbors.get(id) ?? []) {
      const other = link.from === id ? link.to : link.from
      if (depth.has(other)) continue
      depth.set(other, (depth.get(id) ?? 0) + 1)
      parent.set(other, id)
      children.set(id, [...children.get(id) ?? [], other])
      tree.push(link.from === id ? link : { ...link, from: id, to: other })
      queue.push(other)
    }
  }
  for (const id of byId.keys()) {
    if (depth.has(id)) continue
    depth.set(id, 1)
    parent.set(id, root)
    children.set(root, [...children.get(root) ?? [], id])
    tree.push({ from: root, to: id })
  }
  const inTree = new Set(tree.map(link => `${link.from}\u0000${link.to}`))
  const cross = valid.filter(link => !inTree.has(`${link.from}\u0000${link.to}`) && !inTree.has(`${link.to}\u0000${link.from}`))
  const leaves = new Map<string, number>()
  const countLeaves = (id: string): number => {
    const kids = children.get(id) ?? []
    const count = kids.length === 0 ? 1 : kids.reduce((total, kid) => total + countLeaves(kid), 0)
    leaves.set(id, count)
    return count
  }
  countLeaves(root)
  // Each ring's radius grows with its population, so its concepts have room side by side.
  const perRing = new Map<number, number>()
  for (const level of depth.values()) perRing.set(level, (perRing.get(level) ?? 0) + 1)
  const radius = [0]
  for (let level = 1; level <= Math.max(...perRing.keys()); level += 1) {
    const needed = (perRing.get(level) ?? 0) * ARC_PER_NODE / (2 * Math.PI)
    radius.push(Math.max((radius[level - 1] ?? 0) + RING, needed))
  }
  const placed = new Map<string, PlacedNode>()
  const place = (id: string, start: number, end: number, branch: number): void => {
    const level = depth.get(id) ?? 0
    const angle = (start + end) / 2
    const node = byId.get(id)
    if (node === undefined) return
    const r = radius[level] ?? level * RING
    placed.set(id, { node, x: Math.cos(angle) * r, y: Math.sin(angle) * r, depth: level, branch })
    let cursor = start
    const total = leaves.get(id) ?? 1
    ;(children.get(id) ?? []).forEach((kid, index) => {
      const span = (end - start) * (leaves.get(kid) ?? 1) / total
      place(kid, cursor, cursor + span, level === 0 ? index : branch)
      cursor += span
    })
  }
  place(root, -Math.PI / 2, Math.PI * 1.5, -1)
  const xs = [...placed.values()].map(entry => entry.x)
  const ys = [...placed.values()].map(entry => entry.y)
  return { placed, tree, cross, bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } }
}

/** Longest label drawn in full. */
const LABEL_CHARS = 26

/**
 * Shorten a label for its bubble.
 * @param label - full label.
 * @returns the label, cut with an ellipsis past {@link LABEL_CHARS}.
 */
function short(label: string): string {
  return label.length > LABEL_CHARS ? `${label.slice(0, LABEL_CHARS - 1)}…` : label
}

/** Props of {@link MindMap}. */
export interface MindMapProps {
  /** Id of the center concept. */
  readonly center: string
  readonly nodes: readonly MindMapNode[]
  readonly links: readonly MindMapLink[]
  /** Accessible name of the map. */
  readonly label: string
  /** Heading of the source chips in the detail panel. */
  readonly sourcesLabel: string
  /** Called with a source chip's text; chips are plain text when absent. */
  readonly onSource?: ((source: string) => void) | undefined
  /** Extra content under a selected concept's detail. */
  readonly renderDetail?: ((node: MindMapNode) => ReactNode) | undefined
}

/**
 * Render a mind map.
 * @param props - concepts, links, and labels.
 * @returns the map with its detail panel.
 */
export function MindMap({ center, nodes, links, label, sourcesLabel, onSource, renderDetail }: MindMapProps) {
  const layout = useMemo(() => layoutMindMap(center, nodes, links), [center, nodes, links])
  const [selected, setSelected] = useState<string | undefined>()
  const [hovered, setHovered] = useState<string | undefined>()
  const focus = hovered ?? selected
  const pad = 110
  const { minX, minY, maxX, maxY } = layout.bounds
  const width = maxX - minX + pad * 2
  const height = maxY - minY + pad * 1.2
  const touches = (link: MindMapLink): boolean => focus !== undefined && (link.from === focus || link.to === focus)
  const chosen = selected === undefined ? undefined : layout.placed.get(selected)?.node
  const path = (link: MindMapLink, curved: boolean): string => {
    const from = layout.placed.get(link.from)
    const to = layout.placed.get(link.to)
    if (from === undefined || to === undefined) return ''
    if (!curved) return `M${from.x},${from.y} L${to.x},${to.y}`
    // Cross links bow toward the center so they read as a different kind of line.
    const mx = (from.x + to.x) / 2 * 0.55
    const my = (from.y + to.y) / 2 * 0.55
    return `M${from.x},${from.y} Q${mx},${my} ${to.x},${to.y}`
  }
  return (
    <div className={css.map}>
      <svg
        className={css.canvas}
        viewBox={`${minX - pad} ${minY - pad * 0.6} ${width} ${height}`}
        role="img"
        aria-label={label}
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        <g className={css.links}>
          {layout.tree.map(link => (
            <path key={`t${link.from}-${link.to}`} d={path(link, false)} className={touches(link) ? `${css.edge} ${css.edgeFocus}` : css.edge} data-branch={layout.placed.get(link.to)?.branch} />
          ))}
          {layout.cross.map(link => (
            <path key={`c${link.from}-${link.to}`} d={path(link, true)} className={touches(link) ? `${css.cross} ${css.edgeFocus}` : css.cross} />
          ))}
        </g>
        <g>
          {[...layout.tree, ...layout.cross].filter(link => link.label !== undefined && link.label !== '' && (layout.placed.size <= QUIET_LABELS_ABOVE || touches(link))).map((link) => {
            const from = layout.placed.get(link.from)
            const to = layout.placed.get(link.to)
            if (from === undefined || to === undefined) return null
            return (
              <text key={`l${link.from}-${link.to}`} x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 6} className={touches(link) ? `${css.linkLabel} ${css.linkLabelFocus}` : css.linkLabel} textAnchor="middle">
                {short(link.label ?? '')}
              </text>
            )
          })}
        </g>
        <g>
          {[...layout.placed.values()].map((entry) => {
            const text = short(entry.node.label)
            const w = Math.max(64, text.length * (entry.depth === 0 ? 9.5 : 7.4) + 28)
            const h = entry.depth === 0 ? 40 : 30
            return (
              // The position is the outer group's SVG transform; the pop-in animation scales the inner
              // group, because a CSS transform on the same element would replace the position.
              <g key={entry.node.id} transform={`translate(${entry.x - w / 2} ${entry.y - h / 2})`}>
              <g
                className={css.node}
                data-depth={Math.min(entry.depth, 3)}
                data-branch={entry.branch < 0 ? 'center' : entry.branch % 6}
                data-selected={selected === entry.node.id}
                style={{ animationDelay: `${entry.depth * 120}ms` }}
                tabIndex={0}
                role="button"
                aria-label={entry.node.label}
                aria-pressed={selected === entry.node.id}
                onClick={() => { setSelected(selected === entry.node.id ? undefined : entry.node.id) }}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(selected === entry.node.id ? undefined : entry.node.id) } }}
                onPointerEnter={() => { setHovered(entry.node.id) }}
                onPointerLeave={() => { setHovered(undefined) }}
              >
                <title>{entry.node.label}</title>
                <rect width={w} height={h} rx={h / 2} className={css.bubble} />
                <text x={w / 2} y={h / 2 + 4.5} textAnchor="middle" className={css.nodeLabel}>{text}</text>
              </g>
              </g>
            )
          })}
        </g>
      </svg>
      {chosen === undefined ? null : (
        <div className={css.detail}>
          <p className={css.detailTitle}>{chosen.label}</p>
          {chosen.detail === undefined ? null : <p className={css.detailText}>{chosen.detail}</p>}
          {(chosen.sources ?? []).length === 0 ? null : (
            <div className={css.sources}>
              <span className={css.sourcesLabel}>{sourcesLabel}</span>
              {(chosen.sources ?? []).map(source => onSource === undefined
                ? <span key={source} className={css.source}>{source}</span>
                : <button key={source} type="button" className={css.source} onClick={() => { onSource(source) }}>{source}</button>)}
            </div>
          )}
          {renderDetail?.(chosen)}
        </div>
      )}
    </div>
  )
}
