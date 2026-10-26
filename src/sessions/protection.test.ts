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
    const args = copilotArgs({ name: 'ABC-1', model: null, protection }, 'task', { cwd: 'example', dirs: [], disabled: [] }, { id: 'session', resume: false })
    expect(args).toContain('--allow-all-tools')
    expect(args.slice(args.indexOf('write(.env)') - 1, args.indexOf('write(.env)') + 1)).toEqual(['--deny-tool', 'write(.env)'])
  })
  it('enables the destructive-action groups by default for every supported agent', () => {
    const rules = protectionRules(DEFAULT_PROTECTION)
    expect(rules.claude).toContain('Bash(git push * --force*)')
    expect(rules.codex).toContainEqual(['git', 'push', '--force'])
    expect(rules.copilot).toContain('shell(git push * --force*)')
    expect(rules.claude).toContain('mcp__plugin_huly_huly__delete_issue')
  })

  it('disables one group, keeps the rest and adds native rules without duplicates', () => {
    const rules = protectionRules({ disabled: ['forcePush'], claude: ['Write(.env)', 'Write(.env)'], codex: [['terraform', 'destroy']], copilot: ['write(.env)'] })
    expect(rules.claude.some(rule => rule.includes('--force'))).toBe(false)
    expect(rules.codex).toContainEqual(['terraform', 'destroy'])
    expect(rules.claude.filter(rule => rule === 'Write(.env)')).toHaveLength(1)
    expect(rules.copilot).toContain('write(.env)')
    expect(rules.claude).toContain('Bash(git push * --mirror*)')
  })
})
