import { describe, expect, it } from 'vitest'
import { canon, ruleFileOf, skillBody, skillDescriptions, stripFrontmatter } from './rules.js'

const home = 'C:\\Users\\Jane'

describe('ruleFileOf', () => {
  it('folds account copies onto the global ~/.claude', () => {
    const global = ruleFileOf('C:\\Users\\Jane\\.claude\\CLAUDE.md', home)
    const account = ruleFileOf('c:\\Users\\Jane\\.claude-accounts\\jane.doe\\CLAUDE.md', home)
    expect(global).toEqual({ key: '~/.claude/claude.md', display: '~/.claude/CLAUDE.md', kind: 'claude_md', scope: 'global' })
    expect(account).toEqual(global)
  })

  it('knows skills, hooks and agents under the config folder', () => {
    expect(ruleFileOf('C:/Users/Jane/.claude/skills/coding/SKILL.md', home)).toMatchObject({ kind: 'skill', display: '~/.claude/skills/coding/SKILL.md' })
    expect(ruleFileOf('C:/Users/Jane/.claude-accounts/a/hooks/check.mjs', home)).toMatchObject({ kind: 'hook', key: '~/.claude/hooks/check.mjs' })
    expect(ruleFileOf('C:/Users/Jane/.claude/agents/reviewer.md', home)).toMatchObject({ kind: 'agent', scope: 'global' })
  })

  it('keeps settings per account', () => {
    expect(ruleFileOf('C:/Users/Jane/.claude/settings.json', home)).toMatchObject({ kind: 'settings', key: '~/.claude/settings.json' })
    expect(ruleFileOf('C:/Users/Jane/.claude-accounts/jane.doe/settings.json', home)).toMatchObject({
      kind: 'settings',
      key: '~/.claude-accounts/jane.doe/settings.json',
      display: '~/.claude-accounts/jane.doe/settings.json',
    })
  })

  it('scopes memory to its project slug', () => {
    const memory = ruleFileOf('C:\\Users\\Jane\\.claude-accounts\\a\\projects\\D--Projects-Baton\\memory\\MEMORY.md', home)
    expect(memory).toEqual({
      key: '~/.claude/projects/d--projects-baton/memory/memory.md',
      display: '~/.claude/projects/D--Projects-Baton/memory/MEMORY.md',
      kind: 'memory',
      scope: 'slug:d--projects-baton',
    })
  })

  it('ignores the rest of the config folder', () => {
    expect(ruleFileOf('C:/Users/Jane/.claude/projects/x/session.jsonl', home)).toBeNull()
    expect(ruleFileOf('C:/Users/Jane/.claude/plugins/cache/p/skills/a/SKILL.md', home)).toBeNull()
    expect(ruleFileOf('C:/Users/Jane/.claude/projects/x/memory/notes.txt', home)).toBeNull()
    expect(ruleFileOf('C:/Users/Jane/.claude/skills/synced/abc/pdf/SKILL.md', home)).toBeNull()
    expect(ruleFileOf('C:/Users/Jane/.claude/skills/.trash/123/SKILL.md', home)).toBeNull()
  })

  it('maps worktree files onto the main checkout', () => {
    const file = ruleFileOf('D:\\Projects\\Baton\\.claude\\worktrees\\btn-50\\CLAUDE.md', home)
    expect(file).toEqual({ key: '/projects/baton/claude.md', display: 'D:/Projects/Baton/CLAUDE.md', kind: 'claude_md', scope: '/projects/baton' })
    expect(ruleFileOf('C:/Projects/Baton/CLAUDE.md', home)?.key).toBe(file!.key)
    expect(ruleFileOf('D:/Projects/Baton/tally/CLAUDE.md', home)).toMatchObject({ kind: 'claude_md', scope: '/projects/baton/tally' })
  })

  it('knows project skills, agents and settings', () => {
    expect(ruleFileOf('D:/Projects/Game/.claude/skills/unity/SKILL.md', home)).toMatchObject({ kind: 'skill', scope: '/projects/game' })
    expect(ruleFileOf('D:/Projects/Game/.claude/agents/a.md', home)).toMatchObject({ kind: 'agent', scope: '/projects/game' })
    expect(ruleFileOf('D:/Projects/Game/.claude/settings.json', home)).toMatchObject({ kind: 'settings', scope: '/projects/game' })
    expect(ruleFileOf('D:/Projects/Game/.claude/settings.local.json', home)).toBeNull()
    expect(ruleFileOf('D:/Projects/Game/README.md', home)).toBeNull()
  })
})

describe('texts', () => {
  it('canonicalizes line ends and outer whitespace', () => {
    expect(canon('\r\n# A\r\n\r\nb\r\n')).toBe('# A\n\nb')
  })

  it('strips the frontmatter of a skill', () => {
    expect(stripFrontmatter('---\nname: a\ndescription: b\n---\n\n# Body\n')).toBe('# Body')
    expect(stripFrontmatter('# No frontmatter')).toBe('# No frontmatter')
  })

  it('reads the directory and body of an invoked skill', () => {
    expect(skillBody('Base directory for this skill: C:\\Users\\Jane\\.claude\\skills\\coding\n\n# Coding\n\nRules')).toEqual({
      dir: 'C:\\Users\\Jane\\.claude\\skills\\coding',
      body: '# Coding\n\nRules',
    })
    expect(skillBody('Something else')).toBeNull()
  })

  it('splits a skill listing into descriptions by name', () => {
    const content = '- coding: Rules for code.\n  Second line.\n- huly-tracker: Tracker - with - dashes\n- other: x'
    expect(skillDescriptions(content, ['coding', 'huly-tracker', 'other'])).toEqual(
      new Map([
        ['coding', 'Rules for code.\n  Second line.'],
        ['huly-tracker', 'Tracker - with - dashes'],
        ['other', 'x'],
      ]),
    )
  })
})
