/** Unified-diff parsing and review-feedback formatting. */

import { describe, expect, it } from 'vitest'
import { formatFeedback, parsePatch } from '../src/client/diff.ts'

const PATCH = [
  'diff --git a/src/a.txt b/src/a.txt',
  'index 1111111..2222222 100644',
  '--- a/src/a.txt',
  '+++ b/src/a.txt',
  '@@ -1,3 +1,3 @@ header',
  ' one',
  '-two',
  '+TWO',
  ' three',
  '\\ No newline at end of file',
  'diff --git a/old.md b/old.md',
  'deleted file mode 100644',
  '--- a/old.md',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-gone',
  'diff --git a/img.png b/img.png',
  'Binary files /dev/null and b/img.png differ',
  '',
].join('\n')

describe('parsePatch', () => {
  it('numbers context, added, and deleted lines per hunk and flags binary files', () => {
    const files = parsePatch(PATCH)
    expect(files.map(file => [file.path, file.binary, file.hunks.length])).toEqual([['src/a.txt', false, 1], ['old.md', false, 1], ['img.png', true, 0]])
    expect(files[0]!.hunks[0]).toEqual({
      header: '@@ -1,3 +1,3 @@ header',
      lines: [
        { kind: 'context', oldNumber: 1, newNumber: 1, text: 'one' },
        { kind: 'del', oldNumber: 2, text: 'two' },
        { kind: 'add', newNumber: 2, text: 'TWO' },
        { kind: 'context', oldNumber: 3, newNumber: 3, text: 'three' },
      ],
    })
    expect(files[1]!.hunks[0]!.lines).toEqual([{ kind: 'del', oldNumber: 1, text: 'gone' }])
  })

  it('ignores text before the first file and returns nothing for an empty patch', () => {
    expect(parsePatch('warning: stray\n+not a file')).toEqual([])
    expect(parsePatch('')).toEqual([])
    expect(parsePatch('diff --git weird')[0]!.path).toBe('weird')
  })
})

describe('formatFeedback', () => {
  it('lists each comment with its file, line, and quoted code', () => {
    expect(formatFeedback([
      { path: 'src/a.txt', line: { kind: 'add', newNumber: 2, text: '  TWO ' }, text: 'Keep lower case.\nMatch the style.' },
      { path: 'old.md', line: { kind: 'del', oldNumber: 1, text: 'gone' }, text: 'Restore this file.' },
      { path: 'x', line: { kind: 'context', text: 'y' }, text: 'z' },
    ])).toBe([
      'Review comments on your changes in this worktree:',
      '',
      '1. src/a.txt, line 2: `TWO`\n   Keep lower case.\n   Match the style.',
      '',
      '2. old.md, removed line 1: `gone`\n   Restore this file.',
      '',
      '3. x, line ?: `y`\n   z',
      '',
      'Address each comment, then summarize what you changed.',
    ].join('\n'))
  })
})
