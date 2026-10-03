import { describe, expect, it } from 'vitest'
import { parseImports } from './rule-imports.js'

const line = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 4,
    at: '2026-09-09T19:37Z',
    atPrecision: 'exact',
    sessions: ['36e679eb'],
    files: [{ path: '~/.githooks/pre-push', action: 'changed', summary: 'Push guard' }],
    purpose: ['infra'],
    reason: 'Hooks',
    task: null,
    source: 'notes',
    ...patch,
  })

describe('parseImports', () => {
  it('reads one set per line with its hash', () => {
    const { rows, errors } = parseImports(`${line()}\n\n${line({ id: 5, until: '2026-09-10T13:33Z', task: 'ABC-7' })}\n`)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      hash: expect.stringMatching(/^[0-9a-f]{40}$/),
      id: '4',
      at: '2026-09-09T19:37:00.000Z',
      until: null,
      precision: 'exact',
      sessions: ['36e679eb'],
      files: [{ path: '~/.githooks/pre-push', action: 'changed', summary: 'Push guard', precision: null, at: null }],
      purpose: ['infra'],
      reason: 'Hooks',
      task: null,
      source: 'notes',
    })
    expect(rows[1]).toMatchObject({ id: '5', until: '2026-09-10T13:33:00.000Z', task: 'ABC-7' })
    expect(rows[0]!.hash).not.toBe(rows[1]!.hash)
  })

  it('keeps a file time and precision of its own', () => {
    const files = [{ path: '~/.claude/CLAUDE.md', action: 'changed', summary: 'By hand', atPrecision: 'day', at: '2026-09-21' }]
    expect(parseImports(line({ files })).rows[0]!.files[0]).toMatchObject({ precision: 'day', at: '2026-09-21T00:00:00.000Z' })
  })

  it('skips bad lines and says which', () => {
    const text = [
      'not json',
      line({ at: 'yesterday' }),
      line({ atPrecision: 'week' }),
      line({ purpose: ['speed'] }),
      line({ files: [{ path: 'x', action: 'moved', summary: '' }] }),
      line({ sessions: 'abc' }),
      line({ until: '2026-09-01T00:00Z' }),
      line(),
    ].join('\n')
    const { rows, errors } = parseImports(text)
    expect(rows).toHaveLength(1)
    expect(errors.map((each) => each.line)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(errors[3]!.message).toMatch(/purpose/)
  })

  it('drops repeated lines', () => {
    expect(parseImports(`${line()}\n${line()}`).rows).toHaveLength(1)
  })
})
