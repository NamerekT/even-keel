import { describe, expect, it } from 'vitest'
import { DEFAULT_PROTECTION, deletesRecord, guardsOwnAddress, PROTECTION_GROUPS, protectionRules, TRACKER_GROUPS } from './protection.js'
import { chainSettings } from '../tools/panel.js'
import { ADAPTERS } from '../tracker/adapters.js'
import { turnArgs as copilotArgs } from '../copilot/cli.js'
import { sessionConfig as openCodeConfig } from '../opencode/cli.js'

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

  it('leaves Even Keel\'s address to the agent-bridge hook: on by default, no native rule of its own', () => {
    expect(guardsOwnAddress(DEFAULT_PROTECTION)).toBe(true)
    expect(guardsOwnAddress({ ...DEFAULT_PROTECTION, disabled: ['ownAddress'] })).toBe(false)
    const without = protectionRules({ ...DEFAULT_PROTECTION, disabled: ['ownAddress'] })
    expect(protectionRules(DEFAULT_PROTECTION)).toEqual(without)
  })

  it('keeps the native Huly rules with the Huly group only: the other trackers are the gateway\'s', () => {
    expect(protectionRules({ ...DEFAULT_PROTECTION, disabled: ['deleteHuly'] }).claude.some(rule => rule.includes('huly'))).toBe(false)
    expect(protectionRules({ ...DEFAULT_PROTECTION, disabled: ['deleteGithub', 'deleteGitlab', 'deleteLinear', 'deleteJira', 'deleteForgejo'] }).claude).toContain('mcp__plugin_huly_huly__delete_issue')
    expect(Object.values(TRACKER_GROUPS).every(group => PROTECTION_GROUPS.includes(group))).toBe(true)
    expect(Object.keys(TRACKER_GROUPS).sort()).toEqual(Object.keys(ADAPTERS).filter(name => ADAPTERS[name]!.own !== true).sort())
  })

  it('knows a deleting call by a word of the tool name or by a delete method', () => {
    for (const tool of ['delete_issue', 'delete_issue_link', 'deleteComment', 'jira-delete-issue', 'DELETE_LABEL']) expect(deletesRecord(tool, {})).toBe(true)
    for (const tool of ['preview_deletion', 'remove_issue_label', 'undeleted_items', 'update_issue', 'label_write']) expect(deletesRecord(tool, { method: 'update' })).toBe(false)
    expect(deletesRecord('label_write', { method: 'delete', name: 'bug' })).toBe(true)
    expect(deletesRecord('label_write', null)).toBe(false)
  })

  it('knows the delete methods of gitea-mcp, which name what they delete', () => {
    for (const method of ['delete_comment', 'delete_attachment', 'delete_repo_label', 'DELETE_LABEL', 'deleteComment']) expect(deletesRecord('issue_write', { method })).toBe(true)
    for (const method of ['add_dependency', 'remove_label', 'undeleted', 'edit_comment']) expect(deletesRecord('issue_write', { method })).toBe(false)
  })

  it('looks into the tool a dispatcher such as Huly\'s invoke_tool calls', () => {
    expect(deletesRecord('invoke_tool', { toolName: 'delete_comment', arguments: { project: 'TSK', commentId: 'c1' } })).toBe(true)
    expect(deletesRecord('invoke_tool', { toolName: 'label_write', arguments: { method: 'delete', name: 'bug' } })).toBe(true)
    expect(deletesRecord('invoke_tool', { toolName: 'label_write', arguments: '{"method":"delete"}' })).toBe(true)
    expect(deletesRecord('call_tool', { name: 'deleteIssue', args: {} })).toBe(true)
    expect(deletesRecord('invoke_tool', { toolName: 'invoke_tool', arguments: { toolName: 'delete_issue' } })).toBe(true)
    expect(deletesRecord('invoke_tool', { toolName: 'list_comments', arguments: { project: 'TSK' } })).toBe(false)
    expect(deletesRecord('invoke_tool', { toolName: 'label_write', arguments: '{"method":"update"}' })).toBe(false)
    expect(deletesRecord('create_label', { name: 'delete-me' })).toBe(false)
  })

  it('reads a tool name only in a dispatcher call, not in a read such as get_tool_schema', () => {
    expect(deletesRecord('get_tool_schema', { toolName: 'delete_comment' })).toBe(false)
    expect(deletesRecord('describe_tool', { tool_name: 'delete_issue' })).toBe(false)
    expect(deletesRecord('executeWrite', { name: 'deleteComment', inputs: {} })).toBe(true)
  })

  it('takes Jira\'s executeDestructive as a delete whatever operation it runs', () => {
    for (const name of ['manageJiraProjectVersion', 'removeConfluenceContentPermissions', undefined]) expect(deletesRecord('executeDestructive', { name, inputs: {} })).toBe(true)
    for (const tool of ['executeWrite', 'executeRead']) expect(deletesRecord(tool, { name: 'createJiraIssue', inputs: {} })).toBe(false)
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

  it('gives Copilot only the configured main branch force-refspecs on each remote', () => {
    const rules = protectionRules(DEFAULT_PROTECTION, ['origin', 'github'], 'release/v1')
    for (const remote of ['origin', 'github']) {
      for (const form of ['+release/v1', '+HEAD:release/v1', '+release/v1:release/v1', '+release/v1:refs/heads/release/v1', '+HEAD:refs/heads/release/v1']) {
        expect(rules.copilot).toContain(`shell(git push ${remote} ${form}:*)`)
      }
    }
    expect(rules.copilot).not.toContain('shell(git push:*)')
    expect(rules.copilot).not.toContain('shell(git push origin +HEAD:refs/heads/main:*)')
    expect(rules.copilot).not.toContain('shell(git push origin :release/v1:*)')
    for (const rules of [
      protectionRules(DEFAULT_PROTECTION, ['origin']),
      protectionRules(DEFAULT_PROTECTION, [], 'release/v1'),
      protectionRules({ ...DEFAULT_PROTECTION, disabled: ['forcePush'] }, ['origin'], 'release/v1'),
    ]) expect(rules.copilot.some(rule => rule.includes(' +'))).toBe(false)
  })

  it('passes main-branch protection on both a fresh Copilot turn and a resume', () => {
    for (const resume of [false, true]) {
      const args = copilotArgs({ name: 'ABC-1', model: null, mainBranch: 'release/v1', protection: DEFAULT_PROTECTION }, 'task', { cwd: 'example', dirs: [], disabled: [], remotes: ['origin'] }, { id: 'session', resume })
      const rule = 'shell(git push origin +HEAD:refs/heads/release/v1:*)'
      expect(args.slice(args.indexOf(rule) - 1, args.indexOf(rule) + 1)).toEqual(['--deny-tool', rule])
    }
  })

  it('denies a push behind git\'s global options without touching an ordinary push or commit', () => {
    const rules = protectionRules(DEFAULT_PROTECTION, ['origin'])
    const matches = (value: string, pattern: string) => new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replaceAll('*', '.*') + '$').test(value)
    const denied = (command: string) => rules.opencode.bash.some(pattern => matches(command, pattern))
      && rules.claude.some(rule => rule.startsWith('Bash(') && matches(command, rule.slice(5, -1)))
    for (const command of ['git -C . push --force probe HEAD:refs/heads/x', 'git -C /repo push origin -f', 'git -c core.x=y --no-pager push --mirror origin', 'git --git-dir=.git push origin --delete x', 'git -C . push origin +x', 'git -C . push origin :x', 'git -C . push --force-with-lease']) expect(denied(command), command).toBe(true)
    for (const command of ['git -C . push origin feature', 'git -C . push origin HEAD:refs/heads/x', 'git commit -m "push --force is denied"', 'git push origin feature']) {
      expect(rules.opencode.bash.some(pattern => matches(command, pattern)), command).toBe(false)
      expect(rules.claude.some(rule => rule.startsWith('Bash(') && matches(command, rule.slice(5, -1))), command).toBe(false)
    }
    for (const global of [['-C', '.'], ['--no-pager']]) {
      expect(rules.codex).toContainEqual(['git', ...global, 'push', '--force'])
      expect(rules.codex).toContainEqual(['git', ...global, 'push', 'origin', '-d'])
      expect(rules.copilot).toContain(`shell(git ${global.join(' ')} push origin --mirror:*)`)
    }
  })

  describe('a project without git (BTN-1052)', () => {
    const matches = (value: string, pattern: string) => new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replaceAll('*', '.*') + '$').test(value)
    const allOff = { ...DEFAULT_PROTECTION, disabled: [...PROTECTION_GROUPS] }
    const banned = (rules: ReturnType<typeof protectionRules>, command: string) => {
      const argv = command.split(' ')
      return {
        claude: rules.claude.some(rule => rule.startsWith('Bash(') && matches(command, rule.slice(5, -1))),
        powershell: rules.claude.some(rule => rule.startsWith('PowerShell(') && matches(command, rule.slice(11, -1))),
        codex: rules.codex.some(prefix => prefix.every((word, index) => argv[index] === word)),
        copilot: rules.copilot.some(rule => rule.startsWith('shell(') && rule.endsWith(':*)') && (command + ' ').startsWith(rule.slice(6, -3) + ' ')),
        opencode: rules.opencode.bash.some(pattern => matches(command, pattern)),
      }
    }
    const every = { claude: true, powershell: true, codex: true, copilot: true, opencode: true }
    const none = { claude: false, powershell: false, codex: false, copilot: false, opencode: false }

    it('denies every agent any git call, whatever the Protection groups say', () => {
      const rules = protectionRules(allOff, [], undefined, undefined, true)
      for (const command of ['git', 'git status', 'git -C x status', 'git --no-pager log', 'git -c core.x=y --git-dir=.git commit -m x', 'git.exe status', 'git.exe -C x status']) {
        expect(banned(rules, command), command).toEqual(every)
      }
      for (const command of ['gitk', 'github status', 'npm run git', 'cat .git/config']) expect(banned(rules, command), command).toEqual(none)
    })

    it('has no such rule for a project with git', () => {
      for (const rules of [protectionRules(DEFAULT_PROTECTION, ['origin'], 'main'), protectionRules(allOff)]) {
        for (const command of ['git status', 'git -C x status', 'git --no-pager log']) expect(banned(rules, command), command).toEqual(none)
      }
    })

    it('reaches Claude\'s settings, Copilot\'s arguments and OpenCode\'s config only with git off', () => {
      const claude = (noGit: boolean) => JSON.parse(chainSettings('example', {}, false, [], 'home', null, [], allOff, null, noGit)).permissions.deny as string[]
      expect(claude(true)).toEqual(expect.arrayContaining(['Bash(git *)', 'PowerShell(git *)']))
      expect(claude(false)).toEqual([])
      const copilot = (outsideRepo: boolean) => copilotArgs({ name: 'ABC-1', model: null, protection: allOff, outsideRepo }, 'task', { cwd: 'example', dirs: [], disabled: [], remotes: [] }, { id: 'session', resume: false })
      expect(copilot(true)).toContain('shell(git:*)')
      expect(copilot(false)).not.toContain('--deny-tool')
      const opencode = (outsideRepo: boolean) => JSON.parse(openCodeConfig({ protection: allOff, outsideRepo }, [], [])).permission.bash as Record<string, string> | undefined
      expect(opencode(true)).toMatchObject({ 'git *': 'deny', git: 'deny' })
      expect(opencode(false)).toBeUndefined()
    })
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
