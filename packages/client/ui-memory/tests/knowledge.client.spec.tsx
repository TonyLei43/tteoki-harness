// @vitest-environment jsdom
/** The Knowledge panel: knowledge-base tabs, search, memory notes, and indexing. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { KnowledgePanel } from '../src/client/KnowledgePanel.tsx'
import { groupDocuments, typeCounts } from '../src/client/KnowledgeBrowser.tsx'
import { fileType, foldHits, folderOf, groupOf, hitPage, isMarkdown, loadHit, meterCells, resultMap } from '../src/client/KnowledgePanel.tsx'
import type { KnowledgePanelInjected, KnowledgePanelProps } from '../src/client/KnowledgePanel.tsx'
import { en } from '../src/client/knowledge-locales.ts'

const SESSION = 's1' as SessionId

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const COLLECTIONS = [
  { id: 'academic', name: 'Academic', sources: [], description: 'UW statistics coursework' },
  { id: 'ai', name: 'AI', sources: [] },
]
const STATUS = { documents: 7, chunks: 20, entities: 0, relations: 0, collections: [{ id: 'academic', documents: 5 }, { id: 'ai', documents: 2 }], failures: [] }
const SEARCH = {
  hits: [{ source: '/uw/STAT 534/hw4.pdf', collection: 'academic', heading: 'Page 3', text: 'Metropolis-Hastings step', score: 0.757 }],
  entities: [{ name: 'MCMC', type: 'concept', description: 'd', relations: [] }],
}

function renderPanel(overrides: Partial<KnowledgePanelInjected> = {}, sessionId?: string) {
  const injected: KnowledgePanelInjected = {
    load: async () => ({ collections: COLLECTIONS, status: STATUS }),
    search: vi.fn(async () => SEARCH),
    index: vi.fn(async () => ({ ...STATUS, skipped: 3, failures: [{ path: '/uw/quiz6.pdf', message: 'the PDF needs OCR' }] })),
    listNotes: vi.fn(async (collection: string) => collection === 'academic' ? ['STAT 534 HW4'] : []),
    readNote: vi.fn(async () => '# HW4\n\nNotation'),
    writeNote: vi.fn(async () => {}),
    previewPage: vi.fn(async () => 'data:image/png;base64,iVBORw=='),
    readDocument: vi.fn(async () => ({ text: '# HW4\n\nNotation', truncated: false })),
    listDocuments: vi.fn(async (collection: string) => ({
      collection,
      roots: ['/uw', '/home/.dsh/memory/kb/academic/memories'],
      documents: [
        { path: '/uw/Spring 2026/STAT 534/hw4.pdf', modified: Date.UTC(2026, 4, 1), chunks: 12 },
        { path: '/uw/Spring 2026/STAT 534/Lectures/lec1.md', modified: Date.UTC(2026, 3, 1), chunks: 5 },
        { path: '/uw/Spring 2026/STAT 559/notes.tex', modified: Date.UTC(2026, 3, 2), chunks: 30 },
        { path: '/home/.dsh/memory/kb/academic/memories/exam plan.md', modified: Date.UTC(2026, 8, 1), chunks: 1 },
      ],
    })),
    ...overrides,
  }
  const list = {
    byId: {
      decoy: { id: 'decoy', retainedBy: {} },
      ...sessionId === undefined ? {} : { [sessionId]: { id: sessionId, retainedBy: { mainView: 1 } } },
    },
  }
  render(<KnowledgePanel {...({
    t,
    ...injected,
    useSessions: <S,>(select: (state: SessionListState) => S) => select(list as unknown as SessionListState),
  } as unknown as KnowledgePanelProps)} />)
  return injected
}

/** Run a search and click the first hit's card to open its preview. */
async function openFirstHit(query = 'mhmc'): Promise<void> {
  fireEvent.change(await screen.findByRole('textbox', { name: en.searchPlaceholder }), { target: { value: query } })
  fireEvent.click(screen.getByRole('button', { name: en.search }))
  fireEvent.click((await screen.findAllByRole('button', { name: /\.(?:pdf|md|txt)/ }))[0]!)
}

describe('KnowledgePanel', () => {
  it('lists knowledge bases with document counts and scopes search to the selected one', async () => {
    const injected = renderPanel()
    const tabs = within(screen.getByRole('navigation', { name: en.bases }))
    expect((await tabs.findByRole('button', { name: /Academic\s*5/ })).getAttribute('aria-pressed')).toBe('false')
    expect(tabs.getByRole('button', { name: /All\s*7/ }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.change(screen.getByRole('textbox', { name: en.searchPlaceholder }), { target: { value: 'metropolis' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    await waitFor(() => { expect(injected.search).toHaveBeenCalledWith('metropolis', undefined) })
    expect(await screen.findByText('hw4.pdf · Page 3')).toBeTruthy()
    expect(screen.getByText('/uw/STAT 534/hw4.pdf')).toBeTruthy()
    expect(screen.getByText(`${en.related}: MCMC`)).toBeTruthy()

    fireEvent.click(tabs.getByRole('button', { name: /Academic/ }))
    expect(screen.getByText('UW statistics coursework')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: en.searchPlaceholder }) as HTMLInputElement).placeholder).toBe('Search Academic')
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    await waitFor(() => { expect(injected.search).toHaveBeenLastCalledWith('metropolis', ['academic']) })
  })

  it('previews the page a hit came from', async () => {
    const injected = renderPanel()
    fireEvent.change(await screen.findByRole('textbox', { name: en.searchPlaceholder }), { target: { value: 'mh' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    fireEvent.click(await screen.findByRole('button', { name: en.previewPage }))
    expect((await screen.findByRole('img', { name: `${en.pageAlt} 3` })).getAttribute('src')).toBe('data:image/png;base64,iVBORw==')
    expect(injected.previewPage).toHaveBeenCalledWith('/uw/STAT 534/hw4.pdf', 3)
    fireEvent.click(screen.getByRole('button', { name: en.hidePreview }))
    expect(screen.queryByRole('img')).toBeNull()
    cleanup()
    renderPanel({ previewPage: vi.fn(async () => { throw new Error('gone') }) })
    fireEvent.change(await screen.findByRole('textbox', { name: en.searchPlaceholder }), { target: { value: 'mh' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    fireEvent.click(await screen.findByRole('button', { name: en.previewPage }))
    expect(await screen.findByText(en.previewFailed)).toBeTruthy()
  })

  it('opens a Markdown document in the right preview pane through the current session', async () => {
    const hit = { source: '/notes/stat.md', collection: 'academic', text: 'MCMC', score: 0.8 }
    const injected = renderPanel({ search: vi.fn(async () => ({ hits: [hit], entities: [] })) }, 's1')
    await openFirstHit()
    const pane = await screen.findByRole('complementary', { name: en.previewTitle })
    expect(within(pane).getByRole('heading', { name: 'HW4' })).toBeTruthy()
    expect(within(pane).getByText('/notes/stat.md')).toBeTruthy()
    expect(injected.readDocument).toHaveBeenCalledWith('s1', '/notes/stat.md', expect.any(AbortSignal))
  })

  it('renders a plain-text document and reports truncation', async () => {
    const hit = { source: '/notes/plain.txt', collection: 'academic', text: 'note', score: 0.5 }
    renderPanel({
      search: vi.fn(async () => ({ hits: [hit], entities: [] })),
      readDocument: vi.fn(async () => ({ text: 'line one', truncated: true })),
    }, 's1')
    await openFirstHit()
    const pane = await screen.findByRole('complementary', { name: en.previewTitle })
    expect(within(pane).getByText('line one')).toBeTruthy()
    expect(within(pane).getByText(en.previewTruncated)).toBeTruthy()
  })

  it('falls back to the indexed passage without a session or a readable file', async () => {
    const hit = { source: '/notes/plain.txt', collection: 'academic', text: 'passage text', score: 0.4 }
    renderPanel({ search: vi.fn(async () => ({ hits: [hit], entities: [] })) })
    await openFirstHit()
    let pane = await screen.findByRole('complementary', { name: en.previewTitle })
    expect(within(pane).getByText(en.previewNoSession)).toBeTruthy()
    expect(within(pane).getByText('passage text')).toBeTruthy()

    cleanup()
    renderPanel({
      search: vi.fn(async () => ({ hits: [hit], entities: [] })),
      readDocument: vi.fn(async () => { throw new Error('binary') }),
    }, 's1')
    await openFirstHit()
    pane = await screen.findByRole('complementary', { name: en.previewTitle })
    expect(within(pane).getByText(en.previewUnavailable)).toBeTruthy()
  })

  it('renders a page hit on the right without a session', async () => {
    const injected = renderPanel()
    await openFirstHit()
    const pane = await screen.findByRole('complementary', { name: en.previewTitle })
    expect(within(pane).getByRole('img', { name: `${en.pageAlt} 3` })).toBeTruthy()
    expect(injected.previewPage).toHaveBeenCalledWith('/uw/STAT 534/hw4.pdf', 3)
  })

  it('shows a hint before any result is selected and switches back to the notes', async () => {
    renderPanel()
    expect(await screen.findByRole('textbox', { name: en.searchPlaceholder })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.previewTitle }))
    expect(screen.getByText(en.previewHint)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.notesTitle }))
    expect(screen.queryByText(en.previewHint)).toBeNull()
  })

  it('ignores a preview that settles after another result is selected', async () => {
    const hits = [
      { source: '/a/first.md', collection: 'academic', text: 'one', score: 0.9 },
      { source: '/a/second.md', collection: 'academic', text: 'two', score: 0.8 },
    ]
    let settle: (value: { text: string; truncated: boolean }) => void = () => {}
    const readDocument = vi.fn(((_session: string, path: string) => path.endsWith('first.md')
      ? new Promise<{ text: string; truncated: boolean }>((resolve) => { settle = resolve })
      : Promise.resolve({ text: 'second body', truncated: false })))
    renderPanel({ search: vi.fn(async () => ({ hits, entities: [] })), readDocument }, 's1')
    await openFirstHit()
    fireEvent.click(screen.getByRole('button', { name: /second\.md/ }))
    expect(await screen.findByText('second body')).toBeTruthy()
    settle({ text: 'first body', truncated: false })
    await Promise.resolve()
    expect(screen.queryByText('first body')).toBeNull()
  })

  it('shows no results and ignores an empty query', async () => {
    const injected = renderPanel({ search: vi.fn(async () => ({ hits: [], entities: [] })) })
    expect(await screen.findByText(en.searchHint)).toBeTruthy()
    fireEvent.submit(screen.getByRole('textbox', { name: en.searchPlaceholder }).closest('form')!)
    expect(injected.search).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: en.searchPlaceholder }), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    expect(await screen.findByText(en.noResults)).toBeTruthy()
  })

  it('reads, edits, and creates memory notes in the selected knowledge base', async () => {
    const injected = renderPanel()
    expect(await screen.findByText(en.pickBase)).toBeTruthy()
    fireEvent.click(await within(screen.getByRole('navigation', { name: en.bases })).findByRole('button', { name: /Academic/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'STAT 534 HW4' }))
    const editor = await screen.findByRole('textbox', { name: en.noteContent }) as HTMLTextAreaElement
    expect(editor.value).toBe('# HW4\n\nNotation')
    expect(injected.readNote).toHaveBeenCalledWith('academic', 'STAT 534 HW4')
    fireEvent.change(editor, { target: { value: 'updated' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveNote }))
    await waitFor(() => { expect(injected.writeNote).toHaveBeenCalledWith('academic', 'STAT 534 HW4', 'updated') })

    fireEvent.click(screen.getByRole('button', { name: en.newNote }))
    const save = screen.getByRole('button', { name: en.saveNote }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: en.noteName }), { target: { value: ' Exam plan ' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.noteContent }), { target: { value: 'Review MLE' } })
    fireEvent.click(save)
    await waitFor(() => { expect(injected.writeNote).toHaveBeenLastCalledWith('academic', 'Exam plan', 'Review MLE') })
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    expect(screen.queryByRole('textbox', { name: en.noteContent })).toBeNull()

    fireEvent.click(within(screen.getByRole('navigation', { name: en.bases })).getByRole('button', { name: /^AI/ }))
    expect(await screen.findByText(en.noNotes)).toBeTruthy()
  })

  it('indexes the selected scope and lists failures', async () => {
    const injected = renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: en.indexAll }))
    await waitFor(() => { expect(injected.index).toHaveBeenCalledWith(undefined) })
    expect(await screen.findByText('1 document(s) could not be indexed')).toBeTruthy()
    expect(screen.getByText('/uw/quiz6.pdf')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('navigation', { name: en.bases })).getByRole('button', { name: /Academic/ }))
    fireEvent.click(screen.getByRole('button', { name: en.indexOne }))
    await waitFor(() => { expect(injected.index).toHaveBeenLastCalledWith(['academic']) })
  })

  it('reports load and action failures', async () => {
    renderPanel({ load: async () => { throw new Error('down') } })
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    cleanup()
    renderPanel({ search: async () => { throw new Error('down') } })
    fireEvent.change(await screen.findByRole('textbox', { name: en.searchPlaceholder }), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
  })
})

describe('redesigned panel', () => {
  it('opens a knowledge base\'s files from its card, filters them, and previews one', async () => {
    const injected = renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Academic.*5 documents.*UW statistics coursework/ }))
    expect((screen.getByRole('textbox', { name: en.searchPlaceholder }) as HTMLInputElement).placeholder).toBe('Search Academic')
    const browser = await screen.findByRole('region', { name: 'Files in Academic' })
    expect(injected.listDocuments).toHaveBeenCalledWith('academic')
    expect(await within(browser).findByText('4 documents')).toBeTruthy()
    const group = within(browser).getByRole('button', { name: /uw \/ Spring 2026 \/ STAT 534\s*2/ })
    expect(group.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(group)
    expect(within(browser).getByText('Lectures')).toBeTruthy()
    fireEvent.click(within(browser).getByRole('button', { name: /hw4\.pdf/ }))
    const pane = await screen.findByRole('complementary', { name: en.previewTitle })
    expect(await within(pane).findByRole('img', { name: `${en.pageAlt} 1` })).toBeTruthy()
    expect(injected.previewPage).toHaveBeenCalledWith('/uw/Spring 2026/STAT 534/hw4.pdf', 1)

    fireEvent.change(within(browser).getByRole('textbox', { name: en.filterFiles }), { target: { value: 'notes' } })
    expect(within(browser).getByRole('button', { name: /notes\.tex/ })).toBeTruthy()
    expect(within(browser).queryByRole('button', { name: /hw4\.pdf/ })).toBeNull()
    fireEvent.change(within(browser).getByRole('textbox', { name: en.filterFiles }), { target: { value: 'zzz' } })
    expect(within(browser).getByText(en.noFileMatches)).toBeTruthy()
    fireEvent.change(within(browser).getByRole('textbox', { name: en.filterFiles }), { target: { value: '' } })
    fireEvent.click(within(within(browser).getByRole('group', { name: en.fileTypes })).getByRole('button', { name: /MD\s*2/ }))
    expect(within(browser).getAllByRole('button', { name: /uw \/|memories/ }).length).toBeGreaterThan(0)

    fireEvent.click(within(browser).getByRole('button', { name: en.indexOne }))
    await waitFor(() => { expect(injected.index).toHaveBeenCalledWith(['academic']) })
    await waitFor(() => { expect(injected.listDocuments).toHaveBeenCalledTimes(2) })
    fireEvent.click(within(browser).getByText(en.backToSearch))
    expect(screen.queryByRole('region', { name: 'Files in Academic' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Browse Academic files →' }))
    expect(await screen.findByRole('region', { name: 'Files in Academic' })).toBeTruthy()
  })

  it('reports an empty knowledge base and a failed file list', async () => {
    renderPanel({ listDocuments: vi.fn(async () => ({ collection: 'ai', roots: [], documents: [] })) })
    fireEvent.click(await screen.findByRole('button', { name: /^AI.*documents/ }))
    expect(await screen.findByText(en.noFiles)).toBeTruthy()
    cleanup()
    renderPanel({ listDocuments: vi.fn(async () => { throw new Error('down') }) })
    fireEvent.click(await screen.findByRole('button', { name: /^AI.*documents/ }))
    expect(await screen.findByText(en.error)).toBeTruthy()
  })

  it('switches a search between the result list and the map, and opens a document from the map', async () => {
    renderPanel({}, 'session-1')
    fireEvent.change(await screen.findByRole('textbox', { name: en.searchPlaceholder }), { target: { value: 'metropolis' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    expect(await screen.findByText('1 matching passages')).toBeTruthy()
    expect(screen.getByRole('meter', { name: '76% match' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: en.viewMap }))
    expect(screen.getByRole('img', { name: 'Where “metropolis” shows up in your notes' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'hw4' }))
    fireEvent.click(screen.getByRole('button', { name: '/uw/STAT 534/hw4.pdf' }))
    expect(await screen.findByRole('complementary', { name: en.previewTitle })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: en.viewList }))
    expect(screen.getByText('hw4.pdf · Page 3')).toBeTruthy()
  })
})

describe('browser helpers', () => {
  const list = {
    collection: 'academic',
    roots: ['/uw', '/uw/sub'],
    documents: [
      { path: '/uw/a.md', modified: 0, chunks: 1 },
      { path: '/uw/Spring/STAT 534/Lectures/deep/x.pdf', modified: 0, chunks: 2 },
      { path: '/uw/sub/b.pdf', modified: 0, chunks: 3 },
      { path: '/elsewhere/c.tex', modified: 0, chunks: 4 },
    ],
  }

  it('groups files two folders below their deepest root and filters by text and type', () => {
    expect(groupDocuments(list, '', 'all').map(group => [group.label, group.files.map(file => `${file.name}|${file.sub}`)])).toEqual([
      ['elsewhere', ['c.tex|']],
      ['sub', ['b.pdf|']],
      ['uw', ['a.md|']],
      ['uw / Spring / STAT 534', ['x.pdf|Lectures / deep']],
    ])
    expect(groupDocuments(list, 'STAT', 'all').flatMap(group => group.files.map(file => file.name))).toEqual(['x.pdf'])
    expect(groupDocuments(list, '', 'PDF').flatMap(group => group.files.map(file => file.name))).toEqual(['b.pdf', 'x.pdf'])
    expect(typeCounts(list.documents)).toEqual([['PDF', 2], ['MD', 1], ['TEX', 1]])
  })
})

describe('result helpers', () => {
  it('tags file types, names folders, and scales the match meter', () => {
    expect(['a.pdf', 'b.md', 'c.tex', 'd.nbn', 'e.ipynb', 'f', 'g.docx'].map(fileType)).toEqual(['PDF', 'MD', 'TEX', 'NOTE', 'NB', 'DOC', 'DOCX'])
    expect(folderOf('/uw/STAT 534/hw4.pdf')).toBe('STAT 534')
    expect(folderOf('hw4.pdf')).toBe('')
    expect(groupOf('/UW - Graduate/Spring 2026/STAT 559/Lecture Notes/notes.pdf')).toBe('STAT 559')
    expect(groupOf('/vault/UW/STAT_512_Lectures/lec.md')).toBe('STAT 512')
    expect(groupOf('/vault/AI/agents/notes.md')).toBe('agents')
    expect([0.2, 0.37, 0.5, 0.75, 0.95].map(meterCells)).toEqual([1, 2, 3, 5, 5])
  })

  it('folds copies of one passage into its best hit, naming the other folders', () => {
    const hits = [
      { source: '/uw/Lecture Notes/notes.pdf', collection: 'academic', heading: 'Page 1', text: 'Same  passage', score: 0.8 },
      { source: '/uw/Other Notes/notes.pdf', collection: 'academic', heading: 'Page 1', text: 'Same passage', score: 0.79 },
      { source: '/uw/Lecture Notes/copy.pdf', collection: 'academic', text: 'same passage', score: 0.7 },
      { source: '/uw/STAT 538/lec.md', collection: 'academic', text: 'Different', score: 0.6 },
    ]
    expect(foldHits(hits).map(entry => [entry.hit.source, entry.alsoIn])).toEqual([
      ['/uw/Lecture Notes/notes.pdf', ['Other Notes']],
      ['/uw/STAT 538/lec.md', []],
    ])
  })

  it('maps a search around its query, grouped by folder, one node per document', () => {
    const hits = [
      { source: '/uw/STAT 534/hw4.pdf', collection: 'academic', heading: 'Page 3', text: 'x'.repeat(300), score: 0.8 },
      { source: '/uw/STAT 534/hw4.pdf', collection: 'academic', heading: 'Page 4', text: 'again', score: 0.7 },
      { source: '/uw/STAT 538/lec1.md', collection: 'academic', text: 'lecture', score: 0.6 },
      { source: 'loose.md', collection: 'ai', text: 'loose', score: 0.5 },
    ]
    const map = resultMap('mcmc', hits)
    expect(map.nodes.map(node => node.id)).toEqual(['query', 'folder:STAT 534', 'doc:/uw/STAT 534/hw4.pdf', 'folder:STAT 538', 'doc:/uw/STAT 538/lec1.md', 'folder:ai', 'doc:loose.md'])
    expect(map.nodes[2]?.detail).toHaveLength(221)
    expect(map.links).toContainEqual({ from: 'folder:STAT 534', to: 'doc:/uw/STAT 534/hw4.pdf', label: 'Page 3' })
    expect(map.links).toContainEqual({ from: 'folder:STAT 538', to: 'doc:/uw/STAT 538/lec1.md' })
  })
})

describe('preview helpers', () => {
  it('classifies Markdown sources and reads hit pages', () => {
    expect(isMarkdown('/vault/Notes.MD')).toBe(true)
    expect(isMarkdown('/vault/notes.txt')).toBe(false)
    expect(hitPage('Page 12')).toBe(12)
    expect(hitPage(undefined)).toBeUndefined()
  })

  it('falls back to the document text when a page cannot be rendered', async () => {
    const readers = {
      previewPage: vi.fn(async () => { throw new Error('no page previews') }),
      readDocument: vi.fn(async () => ({ text: 'body', truncated: false })),
    }
    const hit = { source: '/a/b.md', collection: 'c', heading: 'Page 1', text: 't', score: 1 }
    await expect(loadHit(hit, SESSION, readers, new AbortController().signal))
      .resolves.toEqual({ kind: 'text', text: 'body', markdown: true, truncated: false })
  })
})
