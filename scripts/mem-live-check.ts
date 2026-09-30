/** Real end-to-end check against a local LM Studio embeddings server. */
import { Context } from '@deepseek-ai/cordis'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Memory } from '../packages/memory/memory/src/index.ts'

const home = mkdtempSync(join(tmpdir(), 'mem-live-'))
const source = join(home, 'notes')
mkdirSync(source, { recursive: true })
writeFileSync(join(source, 'note.md'), '# Meeting\n\nWe discussed the Armada construction schedule and the cafe redesign.')
writeFileSync(join(source, 'paper.tex'), '\\documentclass{article}\n\\begin{document}\nThe Galois theory proof uses field extensions.\\end{document}\n')

const ctx = new Context()
ctx.provide('tools', { register: () => () => {} } as never)
const memory = new Memory(ctx, { home })
await memory.setSettings({
  baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'text-embedding-all-minilm-l6-v2-embedding',
  apiKey: '',
  graphEnabled: false,
  collections: [{ id: 'default', name: 'Test', sources: [source] }],
})

const indexed = await memory.index({}, AbortSignal.timeout(120_000))
console.log('indexed:', { documents: indexed.documents, chunks: indexed.chunks, dimensions: indexed.dimensions, failures: indexed.failures })

const found = await memory.search({ query: 'Galois field extensions' }, AbortSignal.timeout(60_000))
console.log('hits:', found.hits.map(h => ({ source: h.source.split('/').pop(), score: Number(h.score.toFixed(3)), text: h.text.slice(0, 60) })))

await ctx.fiber.dispose()
