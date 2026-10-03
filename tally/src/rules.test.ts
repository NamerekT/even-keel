import { describe, expect, it } from 'vitest'
import { canon, claudeJsonRules, ruleFileOf, shellRuleFiles, skillBody, skillDescriptions, stripFrontmatter } from './rules.js'

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

  it('takes a skill folder for no file', () => {
    expect(ruleFileOf('C:/Users/Jane/.claude/skills/recon', home)).toBeNull()
    expect(ruleFileOf('C:/Users/Jane/.claude/skills/recon/', home)).toBeNull()
    expect(ruleFileOf('C:/Users/Jane/.claude-accounts/a/skills/recon', home)).toBeNull()
    expect(ruleFileOf('D:/Projects/Game/.claude/skills/unity', home)).toBeNull()
    expect(ruleFileOf('D:/Projects/Game/.claude/skills/unity/refs/api.md', home)).toMatchObject({ kind: 'skill' })
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
    expect(ruleFileOf('D:/Projects/Game/.claude/settings.local.json', home)).toMatchObject({
      kind: 'settings',
      key: '/projects/game/.claude/settings.local.json',
      scope: '/projects/game',
    })
    expect(ruleFileOf('D:/Projects/Game/README.md', home)).toBeNull()
  })

  it('knows git hooks in the home folder', () => {
    expect(ruleFileOf('C:\\Users\\Jane\\.githooks\\commit-msg', home)).toEqual({
      key: '~/.githooks/commit-msg',
      display: '~/.githooks/commit-msg',
      kind: 'hook',
      scope: 'global',
    })
    expect(ruleFileOf('C:/Users/Jane/.githooks/lib/huly.mjs', home)).toMatchObject({ kind: 'hook', key: '~/.githooks/lib/huly.mjs' })
    expect(ruleFileOf('C:/Users/Jane/.githooks/node_modules/x/index.js', home)).toBeNull()
    for (const name of ['hook.log', 'package.json', 'package-lock.json', 'config.env.bak-move', 'pre-push.bak']) {
      expect(ruleFileOf(`C:/Users/Jane/.githooks/${name}`, home)).toBeNull()
    }
    expect(ruleFileOf('C:/Users/Jane/.githooks/config.env', home)).toMatchObject({ kind: 'hook' })
  })

  it('keeps .claude.json per account like settings', () => {
    expect(ruleFileOf('C:/Users/Jane/.claude.json', home)).toEqual({ key: '~/.claude.json', display: '~/.claude.json', kind: 'settings', scope: 'global' })
    expect(ruleFileOf('C:/Users/Jane/.claude-accounts/jane.doe/.claude.json', home)).toMatchObject({
      kind: 'settings',
      key: '~/.claude-accounts/jane.doe/.claude.json',
    })
    expect(ruleFileOf('C:/Users/Jane/.claude/.claude.json', home)).toMatchObject({ key: '~/.claude/.claude.json' })
  })
})

describe('shellRuleFiles', () => {
  const cwd = 'D:\\Work\\App'
  const keys = (command: string) => shellRuleFiles(command, cwd, home).map((file) => file.key)

  it('finds rule files a writing command names', () => {
    expect(keys('cat > ~/.claude/skills/coding/SKILL.md <<EOF\nx\nEOF')).toEqual(['~/.claude/skills/coding/skill.md'])
    expect(keys('cp /c/Users/Jane/.claude/CLAUDE.md "C:\\Users\\Jane\\.claude-accounts\\a\\CLAUDE.md"')).toEqual(['~/.claude/claude.md'])
    expect(keys("python - <<'PY'\nopen('.claude/settings.json', 'w').write('{}')\nPY")).toEqual(['/work/app/.claude/settings.json'])
    expect(keys('Remove-Item $env:USERPROFILE\\.claude\\agents\\old.md')).toEqual(['~/.claude/agents/old.md'])
    expect(keys('echo x >> tally/CLAUDE.md')).toEqual(['/work/app/tally/claude.md'])
  })

  it('ignores commands that only read, globs and unknown files', () => {
    expect(keys('cat ~/.claude/CLAUDE.md | head')).toEqual([])
    expect(keys('rm ~/.claude/agents/*')).toEqual([])
    expect(keys('rm src/main.ts')).toEqual([])
    expect(keys('git commit -m "edit CLAUDE.md" && git push')).toEqual([])
  })

  it('finds no rule file in a command on a skill folder', () => {
    expect(keys('rm -rf ~/.claude/skills/recon')).toEqual([])
    expect(keys('cp -r ~/.claude/skills/coding C:/Projects/Game/.claude/skills/coding/')).toEqual([])
    expect(keys('cp -r ~/.claude/skills/coding/SKILL.md .claude/skills/coding/SKILL.md')).toEqual([
      '~/.claude/skills/coding/skill.md',
      '/work/app/.claude/skills/coding/skill.md',
    ])
  })
})

describe('claudeJsonRules', () => {
  it('keeps only MCP servers and per-project servers and allowed tools, with secret values redacted', () => {
    const raw = JSON.stringify({
      numStartups: 41,
      mcpServers: { huly: { command: 'node', args: ['x.js'], env: { HULY_TOKEN: 'secret' } } },
      projects: {
        'D:/Projects/Game': { allowedTools: ['Bash(git:*)'], mcpServers: { web: { url: 'https://example.com', headers: { Authorization: 'Bearer x' } } }, lastCost: 3 },
        'D:/Projects/Empty': { allowedTools: [], mcpServers: {}, lastCost: 1 },
      },
    })
    const rules = JSON.parse(claudeJsonRules(raw)!)
    expect(rules).toEqual({
      mcpServers: { huly: { args: ['x.js'], command: 'node', env: { HULY_TOKEN: '***' } } },
      projects: {
        'D:/Projects/Game': { allowedTools: ['Bash(git:*)'], mcpServers: { web: { headers: { Authorization: '***' }, url: 'https://example.com' } } },
      },
    })
    expect(claudeJsonRules(raw)).toContain('\n  "mcpServers"')
  })

  it('gives the same text whatever the counters and key order', () => {
    const a = claudeJsonRules(JSON.stringify({ a: 1, projects: { p: { allowedTools: ['X'], b: 2 } } }))
    const b = claudeJsonRules(JSON.stringify({ projects: { p: { b: 3, allowedTools: ['X'] } }, a: 9 }))
    expect(a).toBe(b)
  })

  it('returns null for broken JSON', () => {
    expect(claudeJsonRules('{ nope')).toBeNull()
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
