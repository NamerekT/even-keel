import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { runHook } from './rule-hook.js'

const session = 'instruction-size-check'
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(name = 'CLAUDE.md') {
  const root = mkdtempSync(join(process.cwd(), '.temp', 'instruction-size-'))
  roots.push(root)
  const path = join(root, name)
  mkdirSync(join(path, '..'), { recursive: true })
  const env = { EVEN_KEEL_STATE_DIR: join(root, 'state'), TALLY_CONFIG: join(root, 'missing.json') }
  mkdirSync(env.EVEN_KEEL_STATE_DIR, { recursive: true })
  const run = (input: object) => runHook({ session_id: session, ...input }, { root, home: root, env })
  const edit = (before: string | null, after: string, tool = 'Edit') => {
    writeFileSync(path, after)
    return run({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input: { file_path: path }, tool_response: { originalFile: before, type: before === null ? 'create' : 'update' } })
  }
  const stop = (active = false) => run({ hook_event_name: 'Stop', stop_hook_active: active })
  const log = () => writeFileSync(join(root, 'state', 'rule-history.jsonl'), JSON.stringify({
    id: 1, at: '2026-10-27T10:00Z', atPrecision: 'exact', sessions: [session],
    files: [{ path, action: 'changed', summary: 'Rules' }], purpose: ['quality'], reason: 'Why', task: '', source: 'session',
  }))
  return { root, path, env, edit, stop, log }
}

mkdirSync(join(process.cwd(), '.temp'), { recursive: true })

describe('instruction size hook', () => {
  it.each(['CLAUDE.md', 'nested/AGENTS.md', '.claude/CLAUDE.md', '.claude/nested/CLAUDE.md', '.codex/AGENTS.md'])(
    'warns about growth above the byte ceiling in %s, even after its journal row was added', (name) => {
      const f = fixture(name)
      const first = f.edit('a'.repeat(12999), 'a'.repeat(13000))
      expect(JSON.stringify(first)).not.toContain('13000-byte ceiling')
      f.log()
      const grown = f.edit('a'.repeat(13000), 'a'.repeat(13001))
      expect(JSON.stringify(grown)).toContain('13000-byte ceiling')
      expect(JSON.stringify(grown)).toContain('JSDoc')
      expect(JSON.stringify(grown)).toContain('Only the user')
      const blocked = f.stop()
      expect(blocked).toMatchObject({ decision: 'block' })
      expect(JSON.stringify(blocked)).toContain('13000-byte ceiling')
      expect(JSON.stringify(blocked)).not.toContain('has no line')
      expect(f.stop()).toBeNull()
    },
  )

  it('measures UTF-8 bytes and warns for new files written with Write', () => {
    const f = fixture()
    expect(JSON.stringify(f.edit(null, 'я'.repeat(6501), 'Write'))).toContain('13002 bytes')
    expect(f.stop()).toMatchObject({ decision: 'block' })
  })

  it('lets reductions and equal-size edits of oversized files pass without a size warning', () => {
    const f = fixture()
    f.edit('a'.repeat(15000), 'a'.repeat(15001))
    f.log()
    expect(f.edit('a'.repeat(15001), 'a'.repeat(14000), 'MultiEdit')).toBeNull()
    expect(f.stop()).toBeNull()
    expect(f.edit('a'.repeat(14000), 'b'.repeat(14000))).toBeNull()
    expect(f.stop()).toBeNull()
    const saved = JSON.parse(readFileSync(join(f.root, 'state', 'rule-hook', `${session}.json`), 'utf8'))
    expect(saved.oversized ?? {}).toEqual({})
  })

  it('clears a pending warning after repair and warns about later growth', () => {
    const f = fixture()
    f.edit('a'.repeat(13000), 'a'.repeat(13001))
    f.log()
    expect(f.stop(true)).toBeNull()
    expect(f.edit('a'.repeat(13001), 'a'.repeat(13000))).toBeNull()
    expect(f.stop()).toBeNull()
    f.edit('a'.repeat(13000), 'a'.repeat(13002))
    expect(f.stop()).toMatchObject({ decision: 'block' })
    f.edit('a'.repeat(13002), 'a'.repeat(13003))
    expect(f.stop()).toBeNull()
  })

  it('keeps the ceiling limited to instruction files', () => {
    const f = fixture('.claude/skills/example/SKILL.md')
    expect(JSON.stringify(f.edit('', 'a'.repeat(15000)))).not.toContain('ceiling')
    f.log()
    expect(f.stop()).toBeNull()
  })

  it('combines size and journal reminders without blocking the edit', () => {
    const f = fixture()
    expect(f.edit('a'.repeat(14000), 'a'.repeat(14001), 'MultiEdit')).toHaveProperty('hookSpecificOutput')
    const blocked = JSON.stringify(f.stop())
    expect(blocked).toContain('has no line')
    expect(blocked).toContain('13000-byte ceiling')
    expect(f.stop()).toBeNull()
  })

  it('reads old session state and detects later growth of an already reminded file', () => {
    const f = fixture()
    const stateDir = join(f.root, 'state', 'rule-hook')
    mkdirSync(stateDir)
    const display = f.path.replaceAll('\\', '/').replace(/\/\.claude\/worktrees\/[^/]+(?=\/|$)/i, '')
    writeFileSync(join(stateDir, `${session}.json`), JSON.stringify({ files: [display], blocked: [display] }))
    f.log()
    expect(JSON.stringify(f.edit('a'.repeat(13000), 'a'.repeat(13001)))).toContain('13000-byte ceiling')
    expect(f.stop()).toMatchObject({ decision: 'block' })
  })

  it('routes AGENTS.md through the executable and persists a silent reduction', () => {
    const f = fixture('AGENTS.md')
    const execute = (input: object) => {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/rule-hook.mjs', import.meta.url))], {
        input: JSON.stringify({ session_id: session, ...input }), encoding: 'utf8',
        env: { ...process.env, ...f.env }, timeout: 15000,
      })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      return result.stdout === '' ? null : JSON.parse(result.stdout)
    }
    const edit = (before: string, after: string) => {
      writeFileSync(f.path, after)
      return execute({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: f.path }, tool_response: { originalFile: before } })
    }
    expect(JSON.stringify(edit('a'.repeat(13000), 'a'.repeat(14000)))).toContain('13000-byte ceiling')
    f.log()
    expect(execute({ hook_event_name: 'Stop' })).toMatchObject({ decision: 'block' })
    expect(execute({ hook_event_name: 'Stop' })).toBeNull()
    expect(edit('a'.repeat(14000), 'a'.repeat(13500))).toBeNull()
    expect(execute({ hook_event_name: 'Stop' })).toBeNull()
  })
})
