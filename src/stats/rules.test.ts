import { describe, expect, it } from 'vitest'
import {
  compareOf,
  mergeMarks,
  parseChangeIds,
  parseCompareQuery,
  parseRulesQuery,
  ruleDiff,
  ruleSets,
  scopeProject,
  type RuleChangeRow,
  type RuleEditRow,
  type RuleSet,
} from './rules.js'

const places = {
  baton: [{ key: 'ABC', dir: '/repos/abc' }],
  folders: [
    { dir: '/repos/abc', label: 'ABC' },
    { dir: '/repos/abc/.claude/worktrees/abc-1', label: 'ABC' },
    { dir: '/work/tools', label: 'work' },
    { dir: '/work/tools/cli', label: 'work' },
  ],
}

describe('scopeProject', () => {
  it('leaves global rules without a project', () => {
    expect(scopeProject('global', places)).toBeNull()
  })

  it('puts a folder under the Baton project that holds it, else under the group of its folder', () => {
    expect(scopeProject('/repos/abc', places)).toBe('ABC')
    expect(scopeProject('/repos/abc/tools/art', places)).toBe('ABC')
    expect(scopeProject('/work/tools/cli', places)).toBe('work')
    expect(scopeProject('/elsewhere/notes', places)).toBe('notes')
  })

  it('finds the folder of a memory slug on any drive', () => {
    expect(scopeProject('slug:d--repos-abc--claude-worktrees-abc-1', places)).toBe('ABC')
    expect(scopeProject('slug:c--repos-abc', places)).toBe('ABC')
    expect(scopeProject('slug:c--work-tools', places)).toBe('work')
    expect(scopeProject('slug:x--gone', places)).toBe('x--gone')
  })
})

const file = { display: '~/.claude/CLAUDE.md', kind: 'claude_md' as const, project: null }

function change(id: string, key: string, at: string, added = 1, removed = 0): RuleChangeRow {
  return { id, key, at, added, removed, ...file }
}

function edit(sessionId: string, key: string, at: string, added = 2, removed: number | null = 1): RuleEditRow {
  return { sessionId, key, at, added, removed, ...file }
}

describe('ruleSets', () => {
  it('gives a change to the session that edited the file last before it', () => {
    const sets = ruleSets(
      [change('c1', 'k', '2026-09-10T12:00:00Z', 5, 3)],
      [edit('s1', 'k', '2026-09-10T09:00:00Z'), edit('s2', 'k', '2026-09-10T11:00:00Z'), edit('s3', 'k', '2026-09-10T13:00:00Z')],
      new Map([['s2', { task: 'ABC-7', title: 'Audit' }]]),
    )
    const s2 = sets.find((set) => set.id === 's:s2')!
    expect(s2).toMatchObject({ sessionId: 's2', task: 'ABC-7', title: 'Audit', at: '2026-09-10T11:00:00.000Z' })
    expect(s2.files).toEqual([{ key: 'k', ...file, added: 5, removed: 3, changes: ['c1'] }])
    expect(sets.find((set) => set.id === 's:s1')!.files[0]).toMatchObject({ added: 2, removed: 1, changes: [] })
    expect(sets.map((set) => set.id)).toEqual(['s:s1', 's:s2', 's:s3'])
  })

  it('leaves a change without a session when the last edit is older than three days', () => {
    const sets = ruleSets([change('c1', 'k', '2026-09-14T12:00:00Z')], [edit('s1', 'k', '2026-09-10T11:00:00Z')], new Map())
    expect(sets.map((set) => set.id)).toEqual(['s:s1', 'm:c1'])
    expect(sets[1]).toMatchObject({ sessionId: null, task: null, at: '2026-09-14T12:00:00.000Z' })
  })

  it('groups changes without a session that are less than 30 minutes apart', () => {
    const sets = ruleSets(
      [
        change('c1', 'a', '2026-09-10T10:00:00Z', 1, 0),
        change('c2', 'b', '2026-09-10T10:20:00Z', 2, 1),
        change('c3', 'a', '2026-09-10T10:45:00Z', 3, 2),
        change('c4', 'a', '2026-09-10T11:30:00Z'),
      ],
      [],
      new Map(),
    )
    expect(sets.map((set) => set.id)).toEqual(['m:c1', 'm:c4'])
    expect(sets[0]!.at).toBe('2026-09-10T10:45:00.000Z')
    expect(sets[0]!.files.map((each) => [each.key, each.added, each.removed, each.changes])).toEqual([
      ['a', 4, 2, ['c1', 'c3']],
      ['b', 2, 1, ['c2']],
    ])
  })

  it('counts a Write without removed lines as nothing removed', () => {
    const [set] = ruleSets([], [edit('s1', 'k', '2026-09-10T11:00:00Z', 7, null)], new Map())
    expect(set!.files[0]).toMatchObject({ added: 7, removed: 0 })
  })
})

function set(id: string, at: string, startAt = at): RuleSet {
  return { id, startAt, at, sessionId: null, task: null, title: null, files: [], note: null }
}

describe('mergeMarks', () => {
  const starts = ['2026-09-10T10:00:00Z', '2026-09-10T11:30:00Z', '2026-09-11T09:00:00Z', '2026-09-11T10:00:00Z'].map(Date.parse)

  it('merges sets with fewer sessions started between them than the minimum', () => {
    const marks = mergeMarks([set('a', '2026-09-10T10:00:00Z'), set('b', '2026-09-10T12:00:00Z'), set('c', '2026-09-11T12:00:00Z')], starts, 2)
    expect(marks.map((mark) => [mark.fromAt, mark.toAt, mark.sets.map((each) => each.id)])).toEqual([
      ['2026-09-10T10:00:00Z', '2026-09-10T12:00:00Z', ['a', 'b']],
      ['2026-09-11T12:00:00Z', '2026-09-11T12:00:00Z', ['c']],
    ])
  })

  it('spans a mark from the first edit of its first set to the last edit of its sets', () => {
    const marks = mergeMarks([set('a', '2026-09-10T10:30:00Z', '2026-09-10T09:00:00Z'), set('b', '2026-09-10T10:20:00Z', '2026-09-10T10:10:00Z')], starts, 2)
    expect(marks.map((mark) => [mark.fromAt, mark.toAt])).toEqual([['2026-09-10T09:00:00Z', '2026-09-10T10:30:00Z']])
  })

  it('keeps every set apart when enough sessions start between them', () => {
    expect(mergeMarks([set('a', '2026-09-10T10:00:00Z'), set('b', '2026-09-10T12:00:00Z')], starts, 1)).toHaveLength(2)
  })
})

describe('compareOf', () => {
  const side = {
    tasks: 6,
    sessions: 12,
    taskCost: 2.5,
    sessionsPerTask: 2,
    cost: 40,
    stuckCost: 10,
    calls: 200,
    errors: 10,
    denied: 4,
    entryTokens: 31000,
    requests: 400,
    contextTokens: 56_000_000,
    over150: 100,
    requestCost: 36,
  }
  const sides = { before: { from: '2026-09-03T00:00:00Z', to: '2026-09-10T00:00:00Z' }, after: { from: '2026-09-12T00:00:00Z', to: '2026-09-19T00:00:00Z' } }

  it('turns sums into shares', () => {
    const result = compareOf(sides, { before: side, after: { ...side, stuckCost: 0, calls: 0 } }, { minTasks: 5, minSessions: 10, days: 7 })
    expect(result.thin).toBe(false)
    expect(result.before).toMatchObject({ tasks: 6, sessions: 12, taskCost: 2.5, stuckShare: 0.25, errorShare: 0.05, deniedShare: 0.02, entryTokens: 31000 })
    expect(result.after).toMatchObject({ stuckShare: 0, errorShare: null, deniedShare: null })
  })

  it('averages context, the share over 150k and the price per main-thread request', () => {
    const result = compareOf(sides, { before: side, after: { ...side, requests: 0, contextTokens: 0, over150: 0, requestCost: 0 } }, { minTasks: 5, minSessions: 10, days: 7 })
    expect(result.before).toMatchObject({ requests: 400, meanContext: 140_000, over150Share: 0.25, requestCost: 0.09 })
    expect(result.after).toMatchObject({ requests: 0, meanContext: null, over150Share: null, requestCost: null })
  })

  it('hides the numbers when a side has fewer tasks or sessions than the minimum', () => {
    const result = compareOf(sides, { before: side, after: { ...side, sessions: 9 } }, { minTasks: 5, minSessions: 10, days: 7 })
    expect(result.thin).toBe(true)
    expect(result.after).toMatchObject({ tasks: 6, sessions: 9, taskCost: null, stuckShare: null, entryTokens: null, meanContext: null, requestCost: null })
    expect(result.before.taskCost).toBeNull()
  })

  it('treats a missing side as empty', () => {
    const result = compareOf(sides, { before: side }, { minTasks: 5, minSessions: 10, days: 7 })
    expect(result.after).toMatchObject({ tasks: 0, sessions: 0, from: '2026-09-12T00:00:00Z' })
    expect(result.thin).toBe(true)
  })
})

describe('ruleDiff', () => {
  it('diffs each file from the state before its first change to the state after its last', () => {
    const texts = new Map([
      ['h0', 'a\nb'],
      ['h1', 'a\nb\nc'],
      ['h2', 'a\nc'],
    ])
    const files = ruleDiff(
      [
        { key: 'k', display: 'K', kind: 'claude_md', at: '2026-09-10T10:00:00Z', oldHash: 'h0', newHash: 'h1' },
        { key: 'k', display: 'K', kind: 'claude_md', at: '2026-09-10T11:00:00Z', oldHash: 'h1', newHash: 'h2' },
        { key: 'n', display: 'N', kind: 'skill', at: '2026-09-10T10:30:00Z', oldHash: null, newHash: 'h0' },
      ],
      texts,
    )
    expect(files.map((each) => [each.key, each.added, each.removed])).toEqual([
      ['k', 1, 1],
      ['n', 2, 0],
    ])
    expect(files[0]!.hunks[0]!.lines).toEqual([' a', '-b', '+c'])
  })
})

describe('rule queries', () => {
  it('read projects and kinds', () => {
    expect(parseRulesQuery(new URLSearchParams('projects=ABC,work&kinds=skill,memory'))).toMatchObject({ projects: ['ABC', 'work'], kinds: ['skill', 'memory'] })
    expect(parseRulesQuery(new URLSearchParams(''))).toMatchObject({ projects: null, kinds: null, purposes: null })
    expect(() => parseRulesQuery(new URLSearchParams('kinds=prompt'))).toThrow(/kinds/)
  })

  it('read purposes', () => {
    expect(parseRulesQuery(new URLSearchParams('purposes=economy,quality'))).toMatchObject({ purposes: ['economy', 'quality'] })
    expect(() => parseRulesQuery(new URLSearchParams('purposes=speed'))).toThrow(/purposes/)
  })

  it('read the comparison moments and days', () => {
    const query = parseCompareQuery(new URLSearchParams('before=2026-09-10T10:00:00.000Z&after=2026-09-11T10:00:00.000Z&days=14&projects='))
    expect(query).toMatchObject({ before: '2026-09-10T10:00:00.000Z', after: '2026-09-11T10:00:00.000Z', days: 14, projects: [] })
    expect(parseCompareQuery(new URLSearchParams('before=2026-09-10T10:00:00Z&after=2026-09-10T10:00:00Z')).days).toBeNull()
    expect(() => parseCompareQuery(new URLSearchParams('before=yesterday&after=2026-09-11T10:00:00Z'))).toThrow(/before/)
    expect(() => parseCompareQuery(new URLSearchParams('before=2026-09-12T10:00:00Z&after=2026-09-11T10:00:00Z'))).toThrow(/after/)
    expect(() => parseCompareQuery(new URLSearchParams('before=2026-09-10T10:00:00Z&after=2026-09-11T10:00:00Z&days=0'))).toThrow(/days/)
  })

  it('read the change ids of a diff', () => {
    const id = 'a'.repeat(40)
    expect(parseChangeIds(new URLSearchParams(`changes=${id},${id}`))).toEqual([id, id])
    expect(() => parseChangeIds(new URLSearchParams('changes='))).toThrow(/changes/)
    expect(() => parseChangeIds(new URLSearchParams("changes=1';drop"))).toThrow(/changes/)
  })
})
