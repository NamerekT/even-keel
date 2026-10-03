import { describe, expect, it } from 'vitest'
import { filterSets, importKind, importProjects, withImports, type RuleImport } from './rule-imports.js'
import type { RuleSet } from './rules.js'

const places = {
  baton: [
    { key: 'CBL', dir: '/projects/git/private/gamma' },
    { key: 'GS', dir: '/projects/gs' },
  ],
  folders: [{ dir: '/work/notes', label: 'notes' }],
}

function imported(patch: Partial<RuleImport> = {}): RuleImport {
  return {
    id: '7',
    at: '2026-09-20T22:10:00.000Z',
    until: '2026-09-20T22:30:00.000Z',
    precision: 'exact',
    sessions: ['ce41ada1'],
    files: [{ path: '~/.claude/skills/huly-tracker/SKILL.md', action: 'changed', summary: 'Shorter', precision: null, at: null }],
    purpose: ['economy'],
    reason: 'Fewer tokens',
    task: 'CBL-178',
    source: 'notes',
    ...patch,
  }
}

function set(id: string, startAt: string, at: string, patch: Partial<RuleSet> = {}): RuleSet {
  const sessionId = id.startsWith('s:') ? id.slice(2) : null
  const files = [{ key: '~/.claude/claude.md', display: '~/.claude/CLAUDE.md', kind: 'claude_md' as const, project: null, added: 1, removed: 0, changes: [] }]
  return { id, startAt, at, sessionId, task: null, title: null, files, note: null, ...patch }
}

describe('importKind', () => {
  it('guesses the kind from the path', () => {
    expect(importKind('~/.claude/CLAUDE.md')).toBe('claude_md')
    expect(importKind('Gamma/CLAUDE.md и docs')).toBe('claude_md')
    expect(importKind('~/.claude/skills/recon')).toBe('skill')
    expect(importKind('memory/MEMORY.md (Gamma)')).toBe('memory')
    expect(importKind('~/.githooks/pre-push')).toBe('hook')
    expect(importKind('~/.claude/hooks/context-checkpoint.mjs')).toBe('hook')
    expect(importKind('~/.claude.json')).toBe('settings')
    expect(importKind('Gamma/.claude/settings.local.json')).toBe('settings')
    expect(importKind('~/.claude/agents/*')).toBe('agent')
    expect(importKind('~/.claude/agents/reviewer.md, skills/recon')).toBe('agent')
    expect(importKind('~/.claude/tools/session-stats.py')).toBe('settings')
  })
})

describe('importProjects', () => {
  it('leaves home paths global and finds projects by folder name, key or group', () => {
    expect(importProjects('~/.claude/CLAUDE.md', places)).toEqual([null])
    expect(importProjects('Gamma/.claude/settings.json', places)).toEqual(['CBL'])
    expect(importProjects('<проект>/CLAUDE.md (CBL, GS, NBC)', places)).toEqual(['CBL', 'GS'])
    expect(importProjects('memory/MEMORY.md (notes)', places)).toEqual(['notes'])
    expect(importProjects('Elsewhere/CLAUDE.md', places)).toEqual([null])
  })
})

describe('withImports', () => {
  it('gives a matching transcript set the purpose, reason and task of the import', () => {
    const sets = withImports([set('s:ce41ada1-0000', '2026-09-20T22:12:00.000Z', '2026-09-20T22:25:00.000Z')], [imported()], places)
    expect(sets).toHaveLength(1)
    expect(sets[0]).toMatchObject({ task: 'CBL-178', note: { importId: '7', purpose: ['economy'], reason: 'Fewer tokens', drift: null } })
  })

  it('keeps the own task of a transcript set', () => {
    const [only] = withImports([set('s:ce41ada1', '2026-09-20T22:12:00.000Z', '2026-09-20T22:25:00.000Z', { task: 'BTN-3' })], [imported()], places)
    expect(only!.task).toBe('BTN-3')
  })

  it('accepts a transcript set within the precision of the import', () => {
    const day = imported({ precision: 'day', until: null, at: '2026-09-20T00:00:00.000Z' })
    const [only] = withImports([set('s:ce41ada1', '2026-09-20T20:00:00.000Z', '2026-09-20T21:00:00.000Z')], [day], places)
    expect(only!.note!.drift).toBeNull()
  })

  it('keeps both and marks the drift when the times disagree', () => {
    const sets = withImports([set('s:ce41ada1', '2026-09-21T01:00:00.000Z', '2026-09-21T01:30:00.000Z')], [imported()], places)
    expect(sets.map((each) => each.id)).toEqual(['i:7', 's:ce41ada1'])
    expect(sets[1]!.note!.drift).toBe(2.5 * 3_600_000)
    expect(sets[0]!.note!.drift).toBe(2.5 * 3_600_000)
    expect(sets[1]!.task).toBeNull()
  })

  it('makes a set of its own from an import with no transcript set', () => {
    const files = [
      { path: '~/.githooks/git-sync.sh', action: 'added' as const, summary: 'Sync', precision: null, at: null },
      { path: '<проект>/CLAUDE.md (CBL, GS)', action: 'changed' as const, summary: 'Tasks', precision: null, at: null },
    ]
    const [own] = withImports([], [imported({ id: '16', sessions: ['085622aa'], files })], places)
    expect(own).toMatchObject({ id: 'i:16', startAt: '2026-09-20T22:10:00.000Z', at: '2026-09-20T22:30:00.000Z', sessionId: null, task: 'CBL-178' })
    expect(own!.files.map((each) => [each.display, each.kind, each.project, each.changes])).toEqual([
      ['~/.githooks/git-sync.sh', 'hook', null, []],
      ['<проект>/CLAUDE.md (CBL, GS)', 'claude_md', 'CBL', []],
      ['<проект>/CLAUDE.md (CBL, GS)', 'claude_md', 'GS', []],
    ])
    expect(own!.note!.files).toEqual(files)
  })
})

describe('filterSets', () => {
  const hook = { key: 'h', display: '~/.githooks/x', kind: 'hook' as const, project: null, added: 0, removed: 0, changes: [] }
  const local = { key: 'c', display: 'Gamma/CLAUDE.md', kind: 'claude_md' as const, project: 'CBL', added: 1, removed: 0, changes: [] }
  const note = { importId: '1', at: '2026-09-20T22:10:00.000Z', until: null, precision: 'exact' as const, purpose: ['infra' as const], reason: '', task: null, files: [], drift: null }
  const sets = [
    set('s:a', '2026-09-20T10:00:00.000Z', '2026-09-20T10:00:00.000Z', { files: [hook, local] }),
    set('i:1', '2026-09-20T11:00:00.000Z', '2026-09-20T11:00:00.000Z', { files: [hook], note }),
  ]

  it('keeps files of the asked kinds and projects, global ones always', () => {
    expect(filterSets(sets, { kinds: ['claude_md'], projects: null, purposes: null }).map((each) => [each.id, each.files.length])).toEqual([['s:a', 1]])
    expect(filterSets(sets, { kinds: null, projects: ['GS'], purposes: null }).map((each) => [each.id, each.files.length])).toEqual([
      ['s:a', 1],
      ['i:1', 1],
    ])
  })

  it('hides sets without one of the asked purposes', () => {
    expect(filterSets(sets, { kinds: null, projects: null, purposes: ['infra'] }).map((each) => each.id)).toEqual(['i:1'])
    expect(filterSets(sets, { kinds: null, projects: null, purposes: ['economy'] })).toEqual([])
  })
})
