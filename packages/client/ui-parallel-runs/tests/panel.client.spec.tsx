// @vitest-environment jsdom
/** The parallel runs panel: start, compare, review, merge, and discard. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeLaneId, WorktreeRun, WorktreeRunId } from '@deepseek-ai/dsh-api-remotes/client'
import { ParallelRunsPanel } from '../src/client/ParallelRunsPanel.tsx'
import type { ParallelRunsInjected, ParallelRunsPanelProps } from '../src/client/ParallelRunsPanel.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const RUN: WorktreeRun = {
  id: 'r1' as WorktreeRunId,
  repo: '/repos/stat534',
  base: 'abcdef1234567890',
  baseRef: 'main',
  prompt: 'Speed up the MH sampler\nKeep the API',
  createdAt: 0,
  lanes: [
    { id: 'academic' as WorktreeLaneId, label: 'Academic', preset: 'academic', path: '/w/academic', branch: 'agents/r1-academic', sessionId: 's1' },
    { id: 'standard' as WorktreeLaneId, label: 'Standard', path: '/w/standard', branch: 'agents/r1-standard' },
  ],
}

const DIFF = {
  files: [{ path: 'hw4.R', additions: 1, deletions: 1 }],
  patch: 'diff --git a/hw4.R b/hw4.R\n--- a/hw4.R\n+++ b/hw4.R\n@@ -1,2 +1,2 @@\n x <- 1\n-y <- 2\n+y <- 3\n',
  truncated: false,
}

function renderPanel(overrides: Partial<ParallelRunsInjected> = {}) {
  const injected: ParallelRunsInjected = {
    listRuns: vi.fn(async () => [RUN]),
    listPresets: vi.fn(async () => [{ id: 'academic', name: 'Academic' }, { id: 'ai' }]),
    startRun: vi.fn(async () => ({ ...RUN, id: 'r2' as WorktreeRunId, prompt: 'New task' })),
    diff: vi.fn(async () => DIFF),
    merge: vi.fn(async () => ({ ...RUN, mergedLane: 'academic' as WorktreeLaneId })),
    discard: vi.fn(async () => {}),
    sendFeedback: vi.fn(async () => {}),
    openSession: vi.fn(),
    ...overrides,
  }
  render(<ParallelRunsPanel {...({ t, ...injected } as unknown as ParallelRunsPanelProps)} />)
  return injected
}

describe('ParallelRunsPanel', () => {
  it('starts a run with one preset per lane', async () => {
    const injected = renderPanel({ listRuns: vi.fn(async () => []) })
    expect(await screen.findByText(en.noRuns)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.newRun }))
    const start = screen.getByRole('button', { name: en.start }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText(en.repoHint), { target: { value: ' /repos/stat534 ' } })
    fireEvent.change(screen.getByPlaceholderText(en.promptHint), { target: { value: 'New task' } })
    await screen.findAllByRole('option', { name: 'Academic' })
    fireEvent.change(screen.getByRole('combobox', { name: `${en.lanes} 1` }), { target: { value: 'academic' } })
    fireEvent.click(screen.getByRole('button', { name: en.addLane }))
    fireEvent.click(screen.getAllByRole('button', { name: en.removeLane })[1]!)
    fireEvent.click(start)
    await waitFor(() => { expect(injected.startRun).toHaveBeenCalledWith('/repos/stat534', 'New task', [{ label: 'Academic', preset: 'academic' }, { label: en.noPreset }]) })
    expect(await screen.findByText('New task')).toBeTruthy()
  })

  it('shows lanes, opens a session, reviews a diff, and sends comments to the lane agent', async () => {
    const injected = renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Speed up the MH sampler/ }))
    expect(screen.getByText(`/repos/stat534 — from main at abcdef12`)).toBeTruthy()
    const lanes = screen.getAllByRole('article')
    expect(within(lanes[1]!).getByText(en.noSession)).toBeTruthy()
    const academic = within(lanes[0]!)
    fireEvent.click(academic.getByRole('button', { name: en.openSession }))
    expect(injected.openSession).toHaveBeenCalledWith('s1')

    fireEvent.click(academic.getByRole('button', { name: en.viewDiff }))
    expect(await academic.findByText('hw4.R')).toBeTruthy()
    expect(academic.getByText('1 files · +1 −1')).toBeTruthy()
    fireEvent.click(academic.getByRole('button', { name: `${en.comment}: hw4.R:+2` }))
    fireEvent.change(academic.getByRole('textbox', { name: en.commentPlaceholder }), { target: { value: 'Why 3?' } })
    fireEvent.click(academic.getByRole('button', { name: en.addComment }))
    expect(academic.getByText('1 comment(s) for this lane')).toBeTruthy()
    fireEvent.click(academic.getByRole('button', { name: en.sendFeedback }))
    await waitFor(() => { expect(injected.sendFeedback).toHaveBeenCalledWith('s1', expect.stringContaining('1. hw4.R, line 2: `y <- 3`\n   Why 3?')) })
    expect(await academic.findByText(en.sent)).toBeTruthy()

    fireEvent.click(academic.getByRole('button', { name: en.refresh }))
    await waitFor(() => { expect(injected.diff).toHaveBeenCalledTimes(2) })
    fireEvent.click(academic.getByRole('button', { name: en.hideDiff }))
    expect(academic.queryByText('hw4.R')).toBeNull()
  })

  it('removes a drafted comment and cancels a draft', async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Speed up/ }))
    const academic = within(screen.getAllByRole('article')[0]!)
    fireEvent.click(academic.getByRole('button', { name: en.viewDiff }))
    fireEvent.click(await academic.findByRole('button', { name: `${en.comment}: hw4.R:1` }))
    fireEvent.click(academic.getByRole('button', { name: en.cancel }))
    expect(academic.queryByRole('textbox', { name: en.commentPlaceholder })).toBeNull()
    fireEvent.click(academic.getByRole('button', { name: `${en.comment}: hw4.R:+2` }))
    fireEvent.change(academic.getByRole('textbox', { name: en.commentPlaceholder }), { target: { value: 'x' } })
    fireEvent.click(academic.getByRole('button', { name: en.addComment }))
    fireEvent.click(academic.getByRole('button', { name: en.removeComment }))
    expect(academic.queryByRole('button', { name: en.sendFeedback })).toBeNull()
  })

  it('merges one lane after confirmation and hides merge for the others', async () => {
    const injected = renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Speed up/ }))
    const academic = within(screen.getAllByRole('article')[0]!)
    fireEvent.click(academic.getByRole('button', { name: en.merge }))
    const message = academic.getByRole('textbox', { name: en.mergeMessage }) as HTMLInputElement
    expect(message.value).toBe('Academic: Speed up the MH sampler')
    fireEvent.click(academic.getByRole('button', { name: 'Merge into main' }))
    await waitFor(() => { expect(injected.merge).toHaveBeenCalledWith('r1', 'academic', 'Academic: Speed up the MH sampler') })
    expect(await academic.findByText('Merged into main.')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: en.merge })).toHaveLength(0)
  })

  it('discards a run after confirmation and reports failures', async () => {
    const injected = renderPanel({ merge: vi.fn(async () => { throw new Error('git merge failed: conflict') }) })
    fireEvent.click(await screen.findByRole('button', { name: /Speed up/ }))
    const academic = within(screen.getAllByRole('article')[0]!)
    fireEvent.click(academic.getByRole('button', { name: en.merge }))
    fireEvent.click(academic.getByRole('button', { name: 'Merge into main' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The request failed: git merge failed: conflict')

    fireEvent.click(screen.getByRole('button', { name: en.discard }))
    fireEvent.click(screen.getByRole('button', { name: en.confirmDiscard }))
    await waitFor(() => { expect(injected.discard).toHaveBeenCalledWith('r1') })
    expect(await screen.findByText(en.noRuns)).toBeTruthy()
  })

  it('reports a failed start and a failed load', async () => {
    renderPanel({ listRuns: vi.fn(async () => { throw new Error('offline') }) })
    expect((await screen.findByRole('alert')).textContent).toBe('The request failed: offline')
    cleanup()
    renderPanel({ startRun: vi.fn(async () => { throw new Error('not a git repository') }) })
    fireEvent.click(await screen.findByRole('button', { name: en.newRun }))
    fireEvent.change(screen.getByPlaceholderText(en.repoHint), { target: { value: '/tmp' } })
    fireEvent.change(screen.getByPlaceholderText(en.promptHint), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: en.start }))
    expect((await screen.findByRole('alert')).textContent).toBe('The request failed: not a git repository')
  })
})
