/** Native deny rules are guardrails for matching tool calls, not an OS sandbox. */
export interface Protection {
  disabled: string[]
  claude: string[]
  codex: string[][]
  copilot: string[]
  opencode: string[]
}

export const DEFAULT_PROTECTION: Protection = { disabled: [], claude: [], codex: [], copilot: [], opencode: [] }
export const PROTECTION_GROUPS = ['forcePush', 'mirrorPush', 'deleteRemote', 'deleteRoot', 'deleteHome', 'deleteParent', 'deleteHuly', 'deleteGithub', 'deleteGitlab', 'deleteLinear', 'deleteJira'] as const
export type ProtectionGroup = (typeof PROTECTION_GROUPS)[number]
/** Each tracker's own group, by the adapter's key: the MCP gateway refuses the delete calls of its server (BTN-541). */
export const TRACKER_GROUPS: Readonly<Record<string, ProtectionGroup>> = { huly: 'deleteHuly', github: 'deleteGithub', gitlab: 'deleteGitlab', linear: 'deleteLinear', jira: 'deleteJira' }

/**
 * A call that deletes a record: a tool named with the word `delete` (`delete_issue`, `deleteComment`), one with
 * `method: "delete"` (GitHub's `label_write`), or a dispatcher (Huly's `invoke_tool`) calling such a tool (BTN-641).
 */
export function deletesRecord(tool: string, args: unknown): boolean {
  const words = tool.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)
  const fields = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
  if (words.includes('delete') || (typeof fields.method === 'string' && fields.method.toLowerCase() === 'delete')) return true
  const dispatcher = words.includes('tool') && ['invoke', 'call', 'execute', 'run'].some(word => words.includes(word))
  const nested = [fields.toolName, fields.tool_name, ...(dispatcher ? [fields.name, fields.tool] : [])].find(name => typeof name === 'string')
  return typeof nested === 'string' && deletesRecord(nested, parsed(fields.arguments ?? fields.args ?? fields.params ?? fields.input))
}

/** Huly's `invoke_tool` takes its `arguments` as an object or as their JSON text. */
function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}
const DELETE_TOOLS = ['issue', 'project', 'component', 'milestone', 'label', 'comment', 'attachment', 'issue_template', 'drawing', 'activity_reply', 'related_issue_space_target'].map(name => `delete_${name}`)

interface Rules { claude: string[]; codex: string[][]; copilot: string[]; opencode: { bash: string[]; tools: string[] } }
/** Copilot, like Codex, matches a command's leading words (`shell(<prefix>:*)`); a `*` anywhere else matches nothing. */
const commands = (patterns: string[], prefixes: string[][]): Rules => ({ claude: patterns.map(pattern => `Bash(${pattern})`), codex: prefixes, copilot: prefixes.map(prefix => `shell(${prefix.join(' ')}:*)`), opencode: { bash: patterns, tools: [] } })
/**
 * Git's global options (`-C <dir>`, `-c <k=v>`, `--git-dir=…`, `--no-pager`) go before `push` (BTN-642). Patterns take
 * any of them as `git -* push`; a prefix has no wildcard, so Codex and Copilot get only these literal spellings.
 */
const GIT_GLOBALS = [[], ['-C', '.'], ['--no-pager']]
const push = (flags: string[], remotes: readonly string[]) => commands(
  ['git', 'git -*'].flatMap(git => flags.flatMap(flag => [`${git} push ${flag}*`, `${git} push * ${flag}*`])),
  GIT_GLOBALS.flatMap(global => flags.flatMap(flag => [['git', ...global, 'push', flag], ...remotes.map(remote => ['git', ...global, 'push', remote, flag])])),
)
const remove = (targets: string[]) => commands(
  ['-rf', '-fr'].flatMap(flags => targets.map(target => `rm ${flags} ${target}*`)),
  ['-rf', '-fr'].flatMap(flags => targets.map(target => ['rm', flags, target])),
)
/**
 * Codex compares whole arguments, so `C:\` or `+main` slips past `C:` or `-f`. These spellings stay Codex's: Claude's
 * patterns already cover them, and Copilot's parsing of a `:` or `*` inside a prefix was never checked.
 */
const codexOnly = (prefixes: string[][]): Rules => ({ claude: [], codex: prefixes, copilot: [], opencode: { bash: [], tools: [] } })
const removeSpelled = (targets: string[]) => codexOnly(['-rf', '-fr'].flatMap(flags => targets.map(target => ['rm', flags, target])))
const refspec = (forms: string[], remotes: readonly string[]) => codexOnly(remotes.flatMap(remote => forms.map(form => ['git', 'push', remote, form])))
const merge = (...parts: Rules[]): Rules => ({ claude: parts.flatMap(part => part.claude), codex: parts.flatMap(part => part.codex), copilot: parts.flatMap(part => part.copilot), opencode: { bash: parts.flatMap(part => part.opencode.bash), tools: parts.flatMap(part => part.opencode.tools) } })

/**
 * Codex and Copilot match literal command prefixes; the remote names cover the usual `git push <remote> <flag>` order too,
 * and with the project's main branch Codex also gets the refspecs that force-push or delete it.
 */
export function protectionRules(value: Protection = DEFAULT_PROTECTION, remotes: readonly string[] = [], branch?: string, hulyServers: readonly string[] = ['plugin_huly_huly', 'huly']): Rules {
  const refspecs = (forms: (branch: string) => string[]) => refspec(branch === undefined ? [] : forms(branch), remotes)
  // Only Huly has native rules too; the other trackers' deletes are refused by the gateway alone (native ones: BTN-611).
  const gateway = (): Rules => ({ claude: [], codex: [], copilot: [], opencode: { bash: [], tools: [] } })
  const groups: Record<ProtectionGroup, Rules> = {
    forcePush: merge(push(['--force', '--force-with-lease', '-f'], remotes), refspecs(main => [`+${main}`, `+HEAD:${main}`, `+${main}:${main}`, `+${main}:refs/heads/${main}`, `+HEAD:refs/heads/${main}`])),
    mirrorPush: push(['--mirror'], remotes),
    deleteRemote: merge(push(['--delete', '-d'], remotes), refspecs(main => [`:${main}`, `:refs/heads/${main}`])),
    deleteRoot: merge(remove(['/', 'C:', 'D:']), removeSpelled(['C:\\', 'D:\\', 'C:/', 'D:/', '/*'])),
    deleteHome: merge(remove(['~', '$HOME']), removeSpelled(['~/', '~/*', '$HOME/', '$HOME/*'])),
    deleteParent: merge(remove(['..']), removeSpelled(['../', '../*'])),
    deleteGithub: gateway(),
    deleteGitlab: gateway(),
    deleteLinear: gateway(),
    deleteJira: gateway(),
    deleteHuly: { claude: DELETE_TOOLS.flatMap(name => [`mcp__plugin_huly_huly__${name}`, `mcp__huly__${name}`]), codex: [], copilot: DELETE_TOOLS.flatMap(name => [`plugin_huly_huly(${name})`, `huly(${name})`]), opencode: { bash: [], tools: hulyServers.flatMap(server => DELETE_TOOLS.map(name => `${server}_${name}`)) } },
  }
  for (const git of ['git', 'git -*']) {
    groups.forcePush.claude.push(`Bash(${git} push * +*)`)
    groups.deleteRemote.claude.push(`Bash(${git} push * :*)`)
    groups.forcePush.opencode.bash.push(`${git} push * +*`)
    groups.deleteRemote.opencode.bash.push(`${git} push * :*`)
  }
  const enabled = PROTECTION_GROUPS.filter(group => !value.disabled.includes(group)).map(group => groups[group])
  const unique = <T>(values: T[]): T[] => [...new Map(values.map(value => [JSON.stringify(value), value])).values()]
  return {
    claude: unique([...enabled.flatMap(group => group.claude), ...value.claude]),
    codex: unique([...enabled.flatMap(group => group.codex), ...value.codex]),
    copilot: unique([...enabled.flatMap(group => group.copilot), ...value.copilot]),
    opencode: {
      bash: unique([...enabled.flatMap(group => group.opencode.bash), ...value.opencode]),
      tools: unique(enabled.flatMap(group => group.opencode.tools)),
    },
  }
}
