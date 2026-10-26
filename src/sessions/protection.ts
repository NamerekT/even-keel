/** Native deny rules are guardrails for matching tool calls, not an OS sandbox. */
export interface Protection {
  disabled: string[]
  claude: string[]
  codex: string[][]
  copilot: string[]
}

export const DEFAULT_PROTECTION: Protection = { disabled: [], claude: [], codex: [], copilot: [] }
export const PROTECTION_GROUPS = ['forcePush', 'mirrorPush', 'deleteRemote', 'deleteRoot', 'deleteHome', 'deleteParent', 'deleteTracker'] as const
const DELETE_TOOLS = ['issue', 'project', 'component', 'milestone', 'label', 'comment', 'attachment', 'issue_template', 'drawing', 'activity_reply', 'related_issue_space_target'].map(name => `delete_${name}`)

interface Rules { claude: string[]; codex: string[][]; copilot: string[] }
const commands = (patterns: string[], prefixes: string[][]): Rules => ({ claude: patterns.map(pattern => `Bash(${pattern})`), codex: prefixes, copilot: patterns.map(pattern => `shell(${pattern})`) })
const push = (flags: string[], remotes: readonly string[]) => commands(
  flags.flatMap(flag => [`git push ${flag}*`, `git push * ${flag}*`]),
  flags.flatMap(flag => [['git', 'push', flag], ...remotes.map(remote => ['git', 'push', remote, flag])]),
)
const remove = (targets: string[]) => commands(
  ['-rf', '-fr'].flatMap(flags => targets.map(target => `rm ${flags} ${target}*`)),
  ['-rf', '-fr'].flatMap(flags => targets.map(target => ['rm', flags, target])),
)

/** Codex matches literal argv prefixes; the remote names cover the usual `git push <remote> <flag>` order too. */
export function protectionRules(value: Protection = DEFAULT_PROTECTION, remotes: readonly string[] = []): Rules {
  const groups: Record<(typeof PROTECTION_GROUPS)[number], Rules> = {
    forcePush: push(['--force', '--force-with-lease', '-f'], remotes),
    mirrorPush: push(['--mirror'], remotes),
    deleteRemote: push(['--delete', '-d'], remotes),
    deleteRoot: remove(['/', 'C:', 'D:']),
    deleteHome: remove(['~', '$HOME']),
    deleteParent: remove(['..']),
    deleteTracker: { claude: DELETE_TOOLS.flatMap(name => [`mcp__plugin_huly_huly__${name}`, `mcp__huly__${name}`]), codex: [], copilot: DELETE_TOOLS.flatMap(name => [`plugin_huly_huly(${name})`, `huly(${name})`]) },
  }
  groups.forcePush.claude.push('Bash(git push * +*)')
  groups.forcePush.copilot.push('shell(git push * +*)')
  groups.deleteRemote.claude.push('Bash(git push * :*)')
  groups.deleteRemote.copilot.push('shell(git push * :*)')
  const enabled = PROTECTION_GROUPS.filter(group => !value.disabled.includes(group)).map(group => groups[group])
  const unique = <T>(values: T[]): T[] => [...new Map(values.map(value => [JSON.stringify(value), value])).values()]
  return {
    claude: unique([...enabled.flatMap(group => group.claude), ...value.claude]),
    codex: unique([...enabled.flatMap(group => group.codex), ...value.codex]),
    copilot: unique([...enabled.flatMap(group => group.copilot), ...value.copilot]),
  }
}
