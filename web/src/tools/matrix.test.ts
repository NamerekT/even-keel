import { describe, expect, it } from 'vitest'
import type { McpRow, SettingRow, ToolsView } from '../../../src/tools/model.js'
import { filterRows, hiddenSkills, mcpMatrix, mcpState, problemCount, problemsOf, scopeMarks, settingMatrix, sharedProblems, tone, usedScopes } from './matrix.js'

function row(kind: SettingRow['kind'], name: string, values: SettingRow['values'], session = values.chain ?? values.project ?? values.user ?? null): SettingRow {
  return { kind, name, values, session }
}

function mcp(name: string, extra: Partial<McpRow> = {}): McpRow {
  return { name, scope: 'user', plugin: null, disabled: false, worktree: true, ...extra }
}

function view(project: string, settings: SettingRow[], more: Partial<ToolsView> = {}): ToolsView {
  return { project, repo: `D:\\work\\${project}`, trim: true, settings, mcp: [], accounts: [], received: null, ...more }
}

describe('settingMatrix', () => {
  it('puts the rows of every project side by side, missing ones as null', () => {
    const a = view('A', [row('plugin', 'huly', { project: 'on' }), row('plugin', 'design', { user: 'off' })])
    const b = view('B', [row('plugin', 'huly', { project: 'off' })])
    const rows = settingMatrix([a, b], ['plugin'])
    expect(rows.map((each) => each.name)).toEqual(['design', 'huly'])
    expect(rows[0]!.cells).toEqual([a.settings[1], null])
    expect(rows[1]!.cells).toEqual([a.settings[0], b.settings[0]])
  })

  it('keeps only the asked kinds, in kind order', () => {
    const a = view('A', [row('mode', 'defaultMode', { chain: 'auto' }), row('sync', 'syncClaudeAiSkills', { chain: 'off' }), row('skill', 'loop', { chain: 'user-invocable-only' })])
    expect(settingMatrix([a], ['sync', 'mode']).map((each) => each.name)).toEqual(['syncClaudeAiSkills', 'defaultMode'])
  })
})

describe('filterRows', () => {
  const a = view('A', [row('plugin', 'huly', { project: 'on' }), row('plugin', 'design', { user: 'off' }), row('plugin', 'playwright', { user: 'on' })])
  const b = view('B', [row('plugin', 'huly', { project: 'on' }), row('plugin', 'design', { user: 'on' })])
  const rows = settingMatrix([a, b], ['plugin'])

  it('keeps only the rows that differ between projects', () => {
    expect(filterRows(rows, { query: '', onlyDiff: true }).map((each) => each.name)).toEqual(['design', 'playwright'])
  })

  it('finds by name, ignoring case', () => {
    expect(filterRows(rows, { query: 'PLAY', onlyDiff: false }).map((each) => each.name)).toEqual(['playwright'])
  })

  it('counts a row that does not reach the session apart from a missing one', () => {
    const lost = settingMatrix([view('A', [row('permission', 'Bash(x)', { local: 'allow' })]), view('B', [])], ['permission'])
    expect(filterRows(lost, { query: '', onlyDiff: true })).toHaveLength(1)
  })
})

describe('mcpMatrix', () => {
  it('matches servers by scope, plugin and name', () => {
    const a = view('A', [], { mcp: [mcp('db', { scope: 'local', worktree: false }), mcp('huly', { scope: 'plugin', plugin: 'huly' })] })
    const b = view('B', [], { mcp: [mcp('huly', { scope: 'plugin', plugin: 'huly' })] })
    const rows = mcpMatrix([a, b])
    expect(rows.map((each) => [each.name, each.cells.map((cell) => cell && mcpState(cell))])).toEqual([
      ['db', ['outside', null]],
      ['huly', ['on', 'on']],
    ])
  })

  it('names a disabled server before one outside the worktree', () => {
    expect(mcpState(mcp('db', { disabled: true, worktree: false }))).toBe('disabled')
  })
})

describe('scopeMarks', () => {
  it('marks the scope that wins, the same, the overridden and the unread one', () => {
    const marks = scopeMarks(row('plugin', 'playwright', { user: 'on', project: 'off', local: 'on', chain: 'off' }))
    expect(marks).toEqual([
      { scope: 'user', value: 'on', effect: 'overridden' },
      { scope: 'project', value: 'off', effect: 'same' },
      { scope: 'local', value: 'on', effect: 'unread' },
      { scope: 'chain', value: 'off', effect: 'wins' },
    ])
  })

  it('has no winner for a row that does not reach the session', () => {
    expect(scopeMarks(row('permission', 'Bash(x)', { local: 'allow' }))).toEqual([{ scope: 'local', value: 'allow', effect: 'unread' }])
  })
})

describe('usedScopes', () => {
  it('lists the scopes any cell of the rows has a value in, in the fixed order', () => {
    const a = view('A', [row('permission', 'Bash(x)', { local: 'allow' }), row('permission', 'Agent', { user: 'deny' })])
    const b = view('B', [row('permission', 'Bash(x)', { project: 'allow' })])
    expect(usedScopes(settingMatrix([a, b], ['permission']))).toEqual(['user', 'project', 'local'])
  })

  it('is empty without rows', () => {
    expect(usedScopes([])).toEqual([])
  })
})

describe('problemsOf', () => {
  it('collects what does not reach the session, claude.ai skills and broken servers', () => {
    const lost = row('permission', 'Bash(x)', { local: 'allow' })
    const found = problemsOf(
      view('A', [row('plugin', 'huly', { project: 'on' }), lost], {
        mcp: [mcp('db', { scope: 'local', worktree: false }), mcp('old', { worktree: false, disabled: true })],
        received: {
          sessionId: null,
          cwd: null,
          at: null,
          version: null,
          mode: null,
          listingChars: 0,
          tools: [],
          skills: [
            { name: 'coding', source: 'user' },
            { name: 'anthropic-skills:pdf', source: 'claudeai' },
          ],
          mcp: [
            { name: 'huly', tools: 90, failed: false },
            { name: 'forgejo', tools: 0, failed: true },
          ],
        },
      }),
    )
    expect(found).toEqual({ unreached: [lost], claudeai: ['anthropic-skills:pdf'], mcpFailed: ['forgejo'], mcpOutside: ['db'] })
    expect(problemCount(found)).toBe(4)
  })

  it('finds nothing in a clean view without a session', () => {
    expect(problemCount(problemsOf(view('A', [row('plugin', 'huly', { project: 'on' })])))).toBe(0)
  })
})

describe('sharedProblems', () => {
  it('lists each problem once with the projects that have it', () => {
    const lost = (value: string) => row('permission', 'Bash(x)', { local: value })
    const a = view('A', [lost('allow')], { mcp: [mcp('db', { worktree: false })] })
    const b = view('B', [lost('allow')])
    const c = view('C', [row('plugin', 'huly', { project: 'on' })])
    expect(sharedProblems([a, b, c])).toEqual([
      { kind: 'unreached', name: 'Bash(x)', projects: ['A', 'B'], row: a.settings[0] },
      { kind: 'mcpOutside', name: 'db', projects: ['A'], row: null },
    ])
  })
})

describe('hiddenSkills', () => {
  it('counts each skill hidden by Even Keel once across projects', () => {
    const hidden = { chain: 'user-invocable-only' }
    const a = view('A', [row('skill', 'loop', hidden), row('skill', 'init', hidden), row('skill', 'dataviz', { chain: 'on' })])
    const b = view('B', [row('skill', 'loop', hidden), row('skill', 'schedule', hidden)])
    expect(hiddenSkills([a, b])).toBe(3)
  })
})

describe('tone', () => {
  it('colors a value by what it does to the session', () => {
    expect([tone('on'), tone('allow'), tone('off'), tone('deny'), tone('user-invocable-only'), tone('ask'), tone(null), tone('auto')]).toEqual([
      'on',
      'on',
      'off',
      'off',
      'hidden',
      'ask',
      'lost',
      'plain',
    ])
  })
})
