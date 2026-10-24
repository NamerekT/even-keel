import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { afterEdit, beforeStop, EMPTY_STATE, hookRuleFile, journalCheck, runHook, type HookPlace } from './rule-hook.js'

const home = 'C:\\Users\\Jane'
const session = '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0'
const place: HookPlace = { home, journal: 'D:/repo/state/rule-history.jsonl' }

const line = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 7,
    at: '2026-10-16T10:00Z',
    atPrecision: 'exact',
    sessions: ['0b1c2d3e'],
    files: [{ path: '~/.claude/CLAUDE.md', action: 'changed', summary: 'A rule' }],
    purpose: ['quality'],
    reason: 'Why',
    task: 'ABC-1',
    source: 'session',
    ...patch,
  })

const edit = (path: string) => ({ hook_event_name: 'PostToolUse', session_id: session, tool_name: 'Edit', tool_input: { file_path: path } })
const stop = (active = false) => ({ hook_event_name: 'Stop', session_id: session, stop_hook_active: active })

describe('hookRuleFile', () => {
  it('takes CLAUDE.md, skills, hooks, settings and agents', () => {
    expect(hookRuleFile('C:\\Users\\Jane\\.claude\\CLAUDE.md', home)).toMatchObject({ kind: 'claude_md', display: '~/.claude/CLAUDE.md' })
    expect(hookRuleFile('C:/Users/Jane/.claude-accounts/jane.doe/skills/coding/SKILL.md', home)).toMatchObject({ kind: 'skill' })
    expect(hookRuleFile('C:/Users/Jane/.claude/hooks/guard.mjs', home)).toMatchObject({ kind: 'hook' })
    expect(hookRuleFile('C:/Users/Jane/.githooks/pre-push', home)).toMatchObject({ kind: 'hook' })
    expect(hookRuleFile('C:/Users/Jane/.claude/settings.json', home)).toMatchObject({ kind: 'settings' })
    expect(hookRuleFile('C:/Users/Jane/.claude/agents/scout.md', home)).toMatchObject({ kind: 'agent' })
    expect(hookRuleFile('D:\\Work\\app\\.claude\\worktrees\\abc-1\\docs\\CLAUDE.md', home)).toMatchObject({ kind: 'claude_md', display: 'D:/Work/app/docs/CLAUDE.md' })
    expect(hookRuleFile('D:/Work/app/.claude/settings.local.json', home)).toMatchObject({ kind: 'settings' })
    expect(hookRuleFile('C:\\Users\\Jane\\.claude-skills\\coding\\SKILL.md', home)).toMatchObject({ kind: 'skill', display: '~/.claude/skills/coding/SKILL.md' })
    expect(hookRuleFile('C:/Users/Jane/.claude-skills/coding/SKILL.md', home)).toMatchObject({ kind: 'skill', display: '~/.claude/skills/coding/SKILL.md' })
  })

  it('leaves out memory and files that are no rules', () => {
    expect(hookRuleFile('C:/Users/Jane/.claude/projects/D--Work-app/memory/note.md', home)).toBeNull()
    expect(hookRuleFile('C:/Users/Jane/.claude-memory/D--Work-app/MEMORY.md', home)).toBeNull()
    expect(hookRuleFile('C:\\Users\\Jane\\.claude-memory\\D--Work-app\\MEMORY.md', home)).toBeNull()
    expect(hookRuleFile('D:/Work/app/src/main.ts', home)).toBeNull()
    expect(hookRuleFile('D:/Work/app/README.md', home)).toBeNull()
    expect(hookRuleFile('C:/Users/Jane/.githooks/hook.log', home)).toBeNull()
  })
})

describe('journalCheck', () => {
  it('finds the session by a prefix in sessions, as the server matches it', () => {
    expect(journalCheck(`${line({ sessions: ['ffff0000'] })}\n${line()}\n`, session)).toEqual({ logged: true, errors: [] })
    expect(journalCheck(line({ sessions: [session] }), session).logged).toBe(true)
  })

  it('is not logged without a line of the session', () => {
    expect(journalCheck('', session)).toEqual({ logged: false, errors: [] })
    expect(journalCheck(line({ sessions: ['ffff0000'] }), session)).toEqual({ logged: false, errors: [] })
    expect(journalCheck(line({ sessions: [''] }), session).logged).toBe(false)
  })

  it('names the broken lines of the session, not the others', () => {
    const text = `${line({ purpose: ['speed'] })}\n${line({ sessions: ['ffff0000'], purpose: ['speed'] })}\nnot json`
    const { logged, errors } = journalCheck(text, session)
    expect(logged).toBe(false)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^line 1: purpose must be one of/)
  })
})

describe('afterEdit', () => {
  it('reminds once per rule file and remembers it', () => {
    const first = afterEdit(edit('C:/Users/Jane/.claude/CLAUDE.md'), EMPTY_STATE, place)
    expect(first.state.files).toEqual(['~/.claude/CLAUDE.md'])
    expect(first.context).toContain('~/.claude/CLAUDE.md')
    expect(first.context).toContain(place.journal)
    expect(first.context).toContain(session)
    expect(first.context).toContain('economy, quality, process, infra')

    const again = afterEdit(edit('c:\\Users\\Jane\\.claude\\CLAUDE.md'), first.state, place)
    expect(again).toEqual({ state: first.state, context: null })

    const other = afterEdit(edit('C:/Users/Jane/.claude/skills/coding/SKILL.md'), first.state, place)
    expect(other.state.files).toEqual(['~/.claude/CLAUDE.md', '~/.claude/skills/coding/SKILL.md'])
    expect(other.context).toContain('~/.claude/skills/coding/SKILL.md')

    const stored = afterEdit(edit('C:\\Users\\Jane\\.claude-skills\\coding\\SKILL.md'), other.state, place)
    expect(stored).toEqual({ state: other.state, context: null })
    expect(afterEdit(edit('C:/Users/Jane/.claude-skills/coding/SKILL.md'), EMPTY_STATE, place).state.files).toEqual(['~/.claude/skills/coding/SKILL.md'])
  })

  it('stays silent on other files and other tools', () => {
    expect(afterEdit(edit('C:/Users/Jane/.claude/projects/x/memory/a.md'), EMPTY_STATE, place)).toEqual({ state: EMPTY_STATE, context: null })
    expect(afterEdit(edit('C:/Users/Jane/.claude-memory/x/a.md'), EMPTY_STATE, place)).toEqual({ state: EMPTY_STATE, context: null })
    expect(afterEdit({ ...edit('C:/Users/Jane/.claude/CLAUDE.md'), tool_name: 'Read' }, EMPTY_STATE, place).context).toBeNull()
  })
})

describe('beforeStop', () => {
  const edited = { files: ['~/.claude/CLAUDE.md'], blocked: [] }

  it('blocks once when the session changed rules and has no line', () => {
    const first = beforeStop(stop(), edited, '', place)
    expect(first.reason).toContain('~/.claude/CLAUDE.md')
    expect(first.reason).toContain(session)
    expect(first.state.blocked).toEqual(['~/.claude/CLAUDE.md'])

    expect(beforeStop(stop(), first.state, '', place).reason).toBeNull()
  })

  it('lets the stop pass when continuing from a stop hook, without rules or with a line', () => {
    expect(beforeStop(stop(true), edited, '', place).reason).toBeNull()
    expect(beforeStop(stop(), EMPTY_STATE, '', place).reason).toBeNull()
    expect(beforeStop(stop(), edited, line(), place).reason).toBeNull()
  })

  it('blocks again only for rule files changed after the last block', () => {
    const blocked = { files: ['~/.claude/CLAUDE.md', '~/.claude/settings.json'], blocked: ['~/.claude/CLAUDE.md'] }
    const next = beforeStop(stop(), blocked, null, place)
    expect(next.reason).toContain('~/.claude/settings.json')
    expect(next.state.blocked).toEqual(blocked.files)
  })

  it('names the broken lines of the session', () => {
    expect(beforeStop(stop(), edited, line({ atPrecision: 'minute' }), place).reason).toMatch(/line 1: atPrecision must be one of/)
  })
})

describe('runHook', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  it('keeps the session state between calls and reads the journal from the config', () => {
    dir = mkdtempSync(join(tmpdir(), 'rule-hook-'))
    writeFileSync(join(dir, 'tally.config.json'), JSON.stringify({ ruleHistory: 'log/rules.jsonl' }))
    const env = { TALLY_CONFIG: join(dir, 'tally.config.json'), EVEN_KEEL_STATE_DIR: join(dir, 'state') }
    const run = (input: unknown) => runHook(input, { root: dir!, env, home })

    const reminded = run(edit('C:/Users/Jane/.claude/CLAUDE.md'))
    expect(reminded).toMatchObject({ hookSpecificOutput: { hookEventName: 'PostToolUse' } })
    expect(JSON.stringify(reminded)).toContain(join(dir, 'log', 'rules.jsonl').replaceAll('\\', '/'))
    expect(run(edit('C:/Users/Jane/.claude/CLAUDE.md'))).toBeNull()
    expect(JSON.parse(readFileSync(join(dir, 'state', 'rule-hook', `${session}.json`), 'utf8'))).toEqual({ files: ['~/.claude/CLAUDE.md'], blocked: [] })

    expect(run(stop())).toMatchObject({ decision: 'block' })
    expect(run(stop())).toBeNull()
  })

  it('does nothing for a session that touched no rules or a strange session id', () => {
    dir = mkdtempSync(join(tmpdir(), 'rule-hook-'))
    const env = { TALLY_CONFIG: join(dir, 'missing.json'), EVEN_KEEL_STATE_DIR: join(dir, 'state') }
    expect(runHook(stop(), { root: dir, env, home })).toBeNull()
    expect(runHook({ ...edit('C:/Users/Jane/.claude/CLAUDE.md'), session_id: '../x' }, { root: dir, env, home })).toBeNull()
  })
})
