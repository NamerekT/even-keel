import { homedir, hostname, userInfo } from 'node:os'
import { bannedOf } from '../badge/privacy.js'
import type { EvenKeelConfig } from '../config.js'
import type { EvenKeelState } from '../state.js'

/** What the machine itself says of its user, besides the service's state. */
export interface MachineFacts {
  user: string | null
  host: string | null
  home: string | null
  env: NodeJS.ProcessEnv
}

/** The name and e-mail a repository commits as (`git config`); `null` — unset. */
export interface GitIdentity {
  name: string | null
  email: string | null
}

export function machineFacts(env: NodeJS.ProcessEnv = process.env): MachineFacts {
  const safe = (read: () => string): string | null => {
    try {
      return read()
    } catch {
      return null
    }
  }
  return { user: safe(() => userInfo().username), host: safe(hostname), home: safe(homedir), env }
}

/** A person's or a company's name as a whole and by its words. */
const words = (name: string | null | undefined): (string | null | undefined)[] => [name, ...(name ?? '').split(/\s+/)]

/** The user's folder in a path: the segment after `Users` or `home`, which a service running as another user still has. */
function userOfPath(path: string | null | undefined): string | null {
  return /(?:^|[\\/])(?:Users|home)[\\/]([^\\/]+)/i.exec(path ?? '')?.[1] ?? null
}

const lastSegment = (path: string | null | undefined): string | null => (path ?? '').split(/[\\/]/).filter((part) => part !== '').at(-1) ?? null

/**
 * The strings the badge of `project` must not carry (BTN-931, layer 1), from the live state and config: the agents'
 * accounts and their folders, the machine's user and name, the trackers' and CIs' profiles with their addresses and
 * logins, the addresses the page is reached by, the git identities and every other project. Read anew for each state,
 * so a changed setting applies at the next push.
 */
export function bannedFor(state: EvenKeelState, config: EvenKeelConfig, project: string, machine: MachineFacts, identity: GitIdentity | null): string[] {
  const values: (string | null | undefined)[] = []
  const account = state.account
  for (const entry of account?.accounts ?? []) {
    values.push(entry.key, entry.lastEmail, entry.formerEmail, entry.status?.email, ...words(entry.name), ...words(entry.status?.orgName))
  }
  for (const app of account?.apps ?? []) values.push(app.account, lastSegment(app.dir), userOfPath(app.dir))
  for (const entry of account?.pool ?? []) values.push(entry.account)
  for (const folder of Object.values(config.accounts ?? {})) values.push(folder)

  const { env } = machine
  values.push(machine.user, machine.host, lastSegment(machine.home), userOfPath(machine.home), env.USERNAME, env.USER, env.LOGNAME, env.COMPUTERNAME, env.HOSTNAME)
  for (const name of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME']) values.push(lastSegment(env[name]), userOfPath(env[name]))
  values.push(env.EVEN_KEEL_HOST, ...(config.allowedHosts ?? []))

  for (const profile of state.profiles?.profiles ?? []) {
    values.push(profile.name, profile.login)
    for (const field of profile.fields) if (!field.secret) values.push(field.value)
  }
  const urls = state.trackerUrls
  for (const url of [urls?.default, ...Object.values(urls?.projects ?? {}), ...Object.values(urls?.pages ?? {})]) values.push(url)

  values.push(...words(state.git?.name), state.git?.email, ...words(identity?.name), identity?.email)

  const own = [config.keys?.[project], state.projectKeys?.[project], config.names?.[project], state.taskPrefixes?.[project], config.trackerProjects?.[project]]
  for (const other of Object.keys(config.projects ?? {})) {
    if (other === project) continue
    values.push(config.keys?.[other], config.names?.[other], state.taskPrefixes?.[other], config.trackerProjects?.[other], userOfPath(config.projects[other]))
  }
  values.push(userOfPath(config.projects?.[project]))
  return bannedOf(values, own)
}
