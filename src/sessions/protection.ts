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
/** Copilot, like Codex, matches a command's leading words (`shell(<prefix>:*)`); a `*` anywhere else matches nothing. */
const commands = (patterns: string[], prefixes: string[][]): Rules => ({ claude: patterns.map(pattern => `Bash(${pattern})`), codex: prefixes, copilot: prefixes.map(prefix => `shell(${prefix.join(' ')}:*)`) })
const push = (flags: string[], remotes: readonly string[]) => commands(
  flags.flatMap(flag => [`git push ${flag}*`, `git push * ${flag}*`]),
  flags.flatMap(flag => [['git', 'push', flag], ...remotes.map(remote => ['git', 'push', remote, flag])]),
)
const remove = (targets: string[]) => commands(
  ['-rf', '-fr'].flatMap(flags => targets.map(target => `rm ${flags} ${target}*`)),
  ['-rf', '-fr'].flatMap(flags => targets.map(target => ['rm', flags, target])),
)
/**
 * Codex compares whole arguments, so `C:\` or `+main` slips past `C:` or `-f`. These spellings stay Codex's: Claude's
 * patterns already cover them, and Copilot's parsing of a `:` or `*` inside a prefix was never checked.
 */
const codexOnly = (prefixes: string[][]): Rules => ({ claude: [], codex: prefixes, copilot: [] })
const removeSpelled = (targets: string[]) => codexOnly(['-rf', '-fr'].flatMap(flags => targets.map(target => ['rm', flags, target])))
const refspec = (forms: string[], remotes: readonly string[]) => codexOnly(remotes.flatMap(remote => forms.map(form => ['git', 'push', remote, form])))
const merge = (...parts: Rules[]): Rules => ({ claude: parts.flatMap(part => part.claude), codex: parts.flatMap(part => part.codex), copilot: parts.flatMap(part => part.copilot) })

/**
 * Codex and Copilot match literal command prefixes; the remote names cover the usual `git push <remote> <flag>` order too,
 * and with the project's main branch Codex also gets the refspecs that force-push or delete it.
 */
export function protectionRules(value: Protection = DEFAULT_PROTECTION, remotes: readonly string[] = [], branch?: string): Rules {
  const refspecs = (forms: (branch: string) => string[]) => refspec(branch === undefined ? [] : forms(branch), remotes)
  const groups: Record<(typeof PROTECTION_GROUPS)[number], Rules> = {
    forcePush: merge(push(['--force', '--force-with-lease', '-f'], remotes), refspecs(main => [`+${main}`, `+HEAD:${main}`, `+${main}:${main}`, `+${main}:refs/heads/${main}`, `+HEAD:refs/heads/${main}`])),
    mirrorPush: push(['--mirror'], remotes),
    deleteRemote: merge(push(['--delete', '-d'], remotes), refspecs(main => [`:${main}`, `:refs/heads/${main}`])),
    deleteRoot: merge(remove(['/', 'C:', 'D:']), removeSpelled(['C:\\', 'D:\\', 'C:/', 'D:/', '/*'])),
    deleteHome: merge(remove(['~', '$HOME']), removeSpelled(['~/', '~/*', '$HOME/', '$HOME/*'])),
    deleteParent: merge(remove(['..']), removeSpelled(['../', '../*'])),
    deleteTracker: { claude: DELETE_TOOLS.flatMap(name => [`mcp__plugin_huly_huly__${name}`, `mcp__huly__${name}`]), codex: [], copilot: DELETE_TOOLS.flatMap(name => [`plugin_huly_huly(${name})`, `huly(${name})`]) },
  }
  groups.forcePush.claude.push('Bash(git push * +*)')
  groups.deleteRemote.claude.push('Bash(git push * :*)')
  const enabled = PROTECTION_GROUPS.filter(group => !value.disabled.includes(group)).map(group => groups[group])
  const unique = <T>(values: T[]): T[] => [...new Map(values.map(value => [JSON.stringify(value), value])).values()]
  return {
    claude: unique([...enabled.flatMap(group => group.claude), ...value.claude]),
    codex: unique([...enabled.flatMap(group => group.codex), ...value.codex]),
    copilot: unique([...enabled.flatMap(group => group.copilot), ...value.copilot]),
  }
}
