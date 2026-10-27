import { describe, expect, it } from 'vitest'
import { DEFAULT_PROTECTION, protectionRules } from './protection.js'
import { chainSettings } from '../tools/panel.js'
import { turnArgs as copilotArgs } from '../copilot/cli.js'

describe('session protection', () => {
  it('passes native deny rules with trimming both on and off and with Copilot allow-all enabled', () => {
    const protection = { ...DEFAULT_PROTECTION, claude: ['Write(.env)'], copilot: ['write(.env)'] }
    for (const trim of [true, false]) {
      const settings = JSON.parse(chainSettings('example', {}, trim, [], 'home', null, [], protection))
      expect(settings.permissions.deny).toContain('Write(.env)')
      expect(settings.permissions.deny).toContain('Bash(git push --force*)')
    }
    const args = copilotArgs({ name: 'ABC-1', model: null, protection }, 'task', { cwd: 'example', dirs: [], disabled: [], remotes: ['origin'] }, { id: 'session', resume: false })
    expect(args).toContain('--allow-all-tools')
    expect(args).toContain('shell(git push origin --force:*)')
    expect(args.slice(args.indexOf('write(.env)') - 1, args.indexOf('write(.env)') + 1)).toEqual(['--deny-tool', 'write(.env)'])
  })
  it('enables the destructive-action groups by default for every supported agent', () => {
    const rules = protectionRules(DEFAULT_PROTECTION)
    expect(rules.claude).toContain('Bash(git push * --force*)')
    expect(rules.codex).toContainEqual(['git', 'push', '--force'])
    expect(rules.copilot).toContain('shell(git push --force:*)')
    expect(rules.claude).toContain('mcp__plugin_huly_huly__delete_issue')
  })

  it('writes Copilot rules as command prefixes, its only wildcard being a trailing :*', () => {
    const rules = protectionRules(DEFAULT_PROTECTION, ['origin'])
    expect(rules.copilot.filter(rule => rule.replace(/:\*\)$/, ')').includes('*'))).toEqual([])
    expect(rules.copilot).toEqual(expect.arrayContaining(['shell(git push -f:*)', 'shell(git push origin -f:*)', 'shell(rm -rf /:*)', 'shell(rm -fr ~:*)', 'plugin_huly_huly(delete_issue)']))
  })

  it('forbids on Codex the main branch refspecs on every remote and the other spellings of rm targets', () => {
    const rules = protectionRules(DEFAULT_PROTECTION, ['origin', 'github'], 'dev')
    for (const remote of ['origin', 'github']) {
      expect(rules.codex).toContainEqual(['git', 'push', remote, '+dev'])
      expect(rules.codex).toContainEqual(['git', 'push', remote, '+HEAD:dev'])
      expect(rules.codex).toContainEqual(['git', 'push', remote, ':dev'])
      for (const form of ['+dev:dev', '+dev:refs/heads/dev', '+HEAD:refs/heads/dev', ':refs/heads/dev']) expect(rules.codex).toContainEqual(['git', 'push', remote, form])
    }
    for (const flags of ['-rf', '-fr']) {
      for (const target of ['C:\\', 'D:\\', 'C:/', 'D:/', '~/', '~/*', '$HOME/', '$HOME/*', '../', '../*', '/*']) expect(rules.codex).toContainEqual(['rm', flags, target])
    }
    expect(rules.codex).not.toContainEqual(['git', 'push', 'origin', '+main'])
  })

  it('keeps the refspec rules with their groups', () => {
    const rules = protectionRules({ ...DEFAULT_PROTECTION, disabled: ['forcePush'] }, ['origin'], 'main')
    expect(rules.codex).not.toContainEqual(['git', 'push', 'origin', '+main'])
    expect(rules.codex).toContainEqual(['git', 'push', 'origin', ':main'])
    expect(protectionRules(DEFAULT_PROTECTION, ['origin']).codex.some(rule => rule[3]?.startsWith('+'))).toBe(false)
  })

  it('disables one group, keeps the rest and adds native rules without duplicates', () => {
    const rules = protectionRules({ disabled: ['forcePush'], claude: ['Write(.env)', 'Write(.env)'], codex: [['terraform', 'destroy']], copilot: ['write(.env)'], opencode: [] })
    expect(rules.claude.some(rule => rule.includes('--force'))).toBe(false)
    expect(rules.codex).toContainEqual(['terraform', 'destroy'])
    expect(rules.claude.filter(rule => rule === 'Write(.env)')).toHaveLength(1)
    expect(rules.copilot).toContain('write(.env)')
    expect(rules.claude).toContain('Bash(git push * --mirror*)')
  })
})
