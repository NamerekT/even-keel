import { describe, expect, it } from 'vitest'
import { BatchBuilder, launchMap } from './parse.js'
import { hashOf, ruleFileOf } from './rules.js'

const home = 'C:\\Users\\Jane'
const skills = new Map([['coding', ruleFileOf('C:/Users/Jane/.claude/skills/coding/SKILL.md', home)!]])

function build(lines: object[], rulesOnly = false) {
  const builder = new BatchBuilder({ account: 'global', launches: launchMap([]), rules: { home, skills }, rulesOnly })
  for (const line of lines) builder.push(JSON.stringify({ sessionId: 's1', timestamp: '2026-10-03T10:00:00.000Z', ...line }))
  return builder.batch
}

const attachment = (uuid: string, value: object) => ({ type: 'attachment', uuid, attachment: value })

describe('rule rows from a transcript', () => {
  it('takes the full text of loaded instruction files', () => {
    const batch = build([
      attachment('a1', {
        type: 'instructions',
        files: [
          { path: 'C:\\Users\\Jane\\.claude-accounts\\jane\\CLAUDE.md', type: 'User', content: '# Rules\r\n\r\nBe brief.\r\n' },
          { path: 'D:\\Work\\App\\.claude\\worktrees\\app-1\\CLAUDE.md', type: 'Project', content: '# App' },
          { path: 'C:\\Users\\Jane\\.claude\\projects\\D--Work-App\\memory\\MEMORY.md', type: 'AutoMem', content: '- note' },
        ],
      }),
    ])
    expect([...batch.ruleSeen.values()]).toEqual([
      { sessionId: 's1', key: '~/.claude/claude.md', hash: hashOf('# Rules\n\nBe brief.'), at: '2026-10-03T10:00:00.000Z' },
      { sessionId: 's1', key: '/work/app/claude.md', hash: hashOf('# App'), at: '2026-10-03T10:00:00.000Z' },
      expect.objectContaining({ key: '~/.claude/projects/d--work-app/memory/memory.md' }),
    ])
    expect(batch.ruleTexts.get(hashOf('# Rules\n\nBe brief.'))).toEqual({ hash: hashOf('# Rules\n\nBe brief.'), content: '# Rules\n\nBe brief.', lines: 3 })
    expect(batch.ruleFiles.get('/work/app/claude.md')).toMatchObject({ display: 'D:/Work/App/CLAUDE.md', scope: '/work/app' })
  })

  it('takes nested CLAUDE.md loaded mid-session', () => {
    const batch = build([
      attachment('a1', {
        type: 'nested_memory',
        path: 'D:\\Work\\App\\tally\\CLAUDE.md',
        content: { path: 'D:\\Work\\App\\tally\\CLAUDE.md', type: 'Project', content: '# Tally' },
      }),
    ])
    expect([...batch.ruleSeen.values()]).toEqual([expect.objectContaining({ key: '/work/app/tally/claude.md', hash: hashOf('# Tally') })])
  })

  it('takes descriptions of own skills from the listing only', () => {
    const batch = build([
      attachment('a1', { type: 'skill_listing', content: '- coding: Code rules.\n- simplify: Built in.', names: ['coding', 'simplify'], isInitial: true }),
    ])
    expect([...batch.ruleSeen.values()]).toEqual([
      expect.objectContaining({ key: '~/.claude/skills/coding/skill.md#description', hash: hashOf('Code rules.') }),
    ])
    expect(batch.ruleFiles.get('~/.claude/skills/coding/skill.md#description')).toMatchObject({
      display: '~/.claude/skills/coding/SKILL.md#description',
      kind: 'skill',
    })
  })

  it('takes the body of an invoked skill without arguments', () => {
    const skill = (id: string, args?: string) => ({
      type: 'assistant',
      uuid: `u-${id}`,
      message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: 'Skill', input: args === undefined ? { skill: 'coding' } : { skill: 'coding', args } }] },
    })
    const body = (id: string, text: string) => ({
      type: 'user',
      uuid: `b-${id}`,
      isMeta: true,
      sourceToolUseID: id,
      message: { role: 'user', content: [{ type: 'text', text: `Base directory for this skill: C:\\Users\\Jane\\.claude-accounts\\jane\\skills\\coding\n\n${text}` }] },
    })
    const batch = build([skill('t1'), body('t1', '# Coding\n'), skill('t2', 'fix it'), body('t2', '# Coding\n\n## User Request\n\nfix it'), body('t3', 'unknown')])
    expect([...batch.ruleSeen.values()]).toEqual([expect.objectContaining({ key: '~/.claude/skills/coding/skill.md', hash: hashOf('# Coding') })])
  })

  it('records edits of rule files with their size', () => {
    const batch = build([
      {
        type: 'assistant',
        uuid: 'u1',
        agentId: 'ag',
        message: {
          id: 'm1',
          content: [
            { type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: 'C:\\Users\\Jane\\.claude\\CLAUDE.md', old_string: 'a\nb', new_string: 'a\nc\nd' } },
            { type: 'tool_use', id: 'e2', name: 'Write', input: { file_path: 'C:\\Users\\Jane\\.claude\\skills\\x\\SKILL.md', content: 'one\ntwo\n' } },
            { type: 'tool_use', id: 'e3', name: 'Edit', input: { file_path: 'D:\\Work\\App\\src\\main.ts', old_string: 'a', new_string: 'b' } },
          ],
        },
      },
    ])
    expect([...batch.ruleEdits.values()]).toEqual([
      { toolUseId: 'e1', sessionId: 's1', agentId: 'ag', key: '~/.claude/claude.md', at: '2026-10-03T10:00:00.000Z', tool: 'Edit', added: 2, removed: 1 },
      { toolUseId: 'e2', sessionId: 's1', agentId: 'ag', key: '~/.claude/skills/x/skill.md', at: '2026-10-03T10:00:00.000Z', tool: 'Write', added: 2, removed: null },
    ])
  })

  it('records shell commands that write rule files, one row per file', () => {
    const batch = build([
      {
        type: 'assistant',
        uuid: 'u1',
        cwd: 'D:\\Work\\App',
        message: {
          id: 'm1',
          content: [
            { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: "sed -i 's/a/b/' ~/.claude/CLAUDE.md CLAUDE.md" } },
            { type: 'tool_use', id: 'b2', name: 'Bash', input: { command: 'cat ~/.claude/CLAUDE.md' } },
            { type: 'tool_use', id: 'b3', name: 'PowerShell', input: { command: 'Set-Content -Path "$HOME\\.githooks\\commit-msg" -Value x' } },
          ],
        },
      },
    ])
    expect([...batch.ruleEdits.values()]).toEqual([
      { toolUseId: 'b1', sessionId: 's1', agentId: null, key: '~/.claude/claude.md', at: '2026-10-03T10:00:00.000Z', tool: 'Bash', added: 0, removed: null },
      { toolUseId: 'b1:1', sessionId: 's1', agentId: null, key: '/work/app/claude.md', at: '2026-10-03T10:00:00.000Z', tool: 'Bash', added: 0, removed: null },
      expect.objectContaining({ toolUseId: 'b3', key: '~/.githooks/commit-msg', tool: 'PowerShell' }),
    ])
  })

  it('takes rule file versions from file-history backups once per backup', () => {
    const read: string[] = []
    const backups: Record<string, string> = {
      'C:/hist/s1/aaa@v1': '# Old\r\n',
      'C:/hist/s1/bbb@v1': '---\nname: x\n---\nBody',
    }
    const builder = new BatchBuilder({
      account: 'global',
      launches: launchMap([]),
      rules: { home, skills, history: { session: 's1', dir: 'C:/hist/s1', read: (path) => (read.push(path), backups[path] ?? null) } },
      rulesOnly: true,
    })
    const snapshot = (backupsOf: object) => JSON.stringify({ type: 'file-history-snapshot', messageId: 'm1', snapshot: { messageId: 'm1', trackedFileBackups: backupsOf } })
    const tracked = {
      'CLAUDE.md': { backupFileName: 'aaa@v1', version: 1, backupTime: '2026-09-10T10:00:00Z', realParentDir: 'C:\\Users\\Jane\\.claude' },
      'C:\\Users\\Jane\\.claude\\skills\\x\\SKILL.md': { backupFileName: 'bbb@v1', version: 1, backupTime: '2026-09-10T11:00:00.000Z', realParentDir: 'C:\\Users\\Jane\\.claude\\skills\\x' },
      'src/app.ts': { backupFileName: 'ccc@v1', version: 1, backupTime: '2026-09-10T11:00:00.000Z', realParentDir: 'D:\\Work\\App\\src' },
      'notes.md': { backupFileName: null, version: 1, backupTime: '2026-09-10T11:00:00.000Z', realParentDir: 'C:\\Users\\Jane\\.claude' },
    }
    builder.push(snapshot(tracked))
    builder.push(snapshot(tracked))
    expect(read).toEqual(['C:/hist/s1/aaa@v1', 'C:/hist/s1/bbb@v1'])
    expect([...builder.batch.ruleVersions.values()]).toEqual([
      { key: '~/.claude/claude.md', at: '2026-09-10T10:00:00.000Z', hash: hashOf('# Old'), source: 'file-history', ref: 's1/aaa@v1' },
      { key: '~/.claude/skills/x/skill.md', at: '2026-09-10T11:00:00.000Z', hash: hashOf('Body'), source: 'file-history', ref: 's1/bbb@v1' },
    ])
    expect(builder.batch.ruleTexts.get(hashOf('# Old'))?.content).toBe('# Old')
  })

  it('keeps only rule rows in rules-only mode', () => {
    const batch = build([attachment('a1', { type: 'instructions', files: [{ path: 'D:/Work/App/CLAUDE.md', content: '# App' }] })], true)
    expect(batch.lines.size).toBe(0)
    expect(batch.sessions.size).toBe(0)
    expect(batch.ruleSeen.size).toBe(1)
  })
})
