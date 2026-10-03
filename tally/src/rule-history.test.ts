import { describe, expect, it } from 'vitest'
import { backupOf, parseGitLog, transcriptSession } from './rule-history.js'

describe('transcriptSession', () => {
  it('is the file name of a session transcript and the parent session of a subagent one', () => {
    expect(transcriptSession('C:\\Users\\Jane\\.claude\\projects\\D--Work\\abc-1.jsonl')).toBe('abc-1')
    expect(transcriptSession('C:/Users/Jane/.claude/projects/D--Work/abc-1/subagents/agent-x.jsonl')).toBe('abc-1')
  })
})

describe('backupOf', () => {
  it('maps CLAUDE.md backups to CLAUDE.md at the file time', () => {
    expect(backupOf('CLAUDE.md.2026-09-07.bak')).toEqual({ target: 'CLAUDE.md', at: null })
    expect(backupOf('CLAUDE (backup).md')).toEqual({ target: 'CLAUDE.md', at: null })
  })

  it('maps .claude.json backups to .claude.json at the time in the name', () => {
    expect(backupOf('.claude.json.backup.1791060624117')).toEqual({ target: '.claude.json', at: new Date(1791060624117).toISOString() })
    expect(backupOf('.claude.json.corrupted.1789148388446')).toEqual({ target: '.claude.json', at: new Date(1789148388446).toISOString() })
  })

  it('skips other files', () => {
    expect(backupOf('settings.json.bak')).toBeNull()
    expect(backupOf('.claude.json.backup.x')).toBeNull()
  })
})

describe('parseGitLog', () => {
  it('reads commits with their changed files, a deletion having no text', () => {
    const out = [
      '\u0000aaa 2026-09-10T12:00:00+03:00',
      '',
      'M\tCLAUDE.md',
      'A\t.claude/skills/x/SKILL.md',
      '\u0000bbb 2026-09-09T08:00:00Z',
      '',
      'D\tdocs/CLAUDE.md',
      '',
    ].join('\n')
    expect(parseGitLog(out)).toEqual([
      { sha: 'aaa', at: '2026-09-10T09:00:00.000Z', files: [{ path: 'CLAUDE.md', deleted: false }, { path: '.claude/skills/x/SKILL.md', deleted: false }] },
      { sha: 'bbb', at: '2026-09-09T08:00:00.000Z', files: [{ path: 'docs/CLAUDE.md', deleted: true }] },
    ])
  })

  it('reads an empty log', () => {
    expect(parseGitLog('')).toEqual([])
  })
})
