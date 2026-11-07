import { readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import type { AwsProfile, AwsProfiles } from './cloud.js'

/** The keys that make a profile's credentials expire within hours. */
const SHORT_LIVED_KEYS = ['sso_session', 'sso_start_url', 'login_session', 'aws_session_token']

type Sections = Map<string, Map<string, string>>

/** The AWS CLI's files where the SDK reads them: `AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE` move them. */
export function awsFiles(env: NodeJS.ProcessEnv): { config: string; credentials: string } {
  return {
    config: env.AWS_CONFIG_FILE ?? join(homedir(), '.aws', 'config'),
    credentials: env.AWS_SHARED_CREDENTIALS_FILE ?? join(homedir(), '.aws', 'credentials'),
  }
}

export function readAwsProfiles(env: NodeJS.ProcessEnv): AwsProfiles {
  const files = awsFiles(env)
  return { profiles: awsProfiles(readText(files.config), readText(files.credentials)), user: currentUser(), home: homedir() }
}

/**
 * The named profiles of both files, `default` first, the rest by name. In `config` a profile is `[profile name]` (the
 * default — `[default]`) and `[sso-session …]` is no profile; in `credentials` it is `[name]`.
 */
export function awsProfiles(config: string, credentials: string): AwsProfile[] {
  const merged = new Map<string, Map<string, string>>()
  const add = (name: string, keys: Map<string, string>) => merged.set(name, new Map([...(merged.get(name) ?? []), ...keys]))
  for (const [section, keys] of parseIni(config)) {
    const name = section === 'default' ? 'default' : /^profile\s+(.+)$/.exec(section)?.[1]?.trim()
    if (name !== undefined && name !== '') add(name, keys)
  }
  for (const [section, keys] of parseIni(credentials)) add(section, keys)
  return [...merged]
    .map(([name, keys]) => ({ name, region: keys.get('region') ?? null, shortLived: SHORT_LIVED_KEYS.some((key) => keys.has(key)) }))
    .sort((a, b) => Number(b.name === 'default') - Number(a.name === 'default') || a.name.localeCompare(b.name))
}

/** Whether the named profile's credentials expire within hours; false for one not found. */
export function shortLivedProfile(env: NodeJS.ProcessEnv, name: string): boolean {
  const files = awsFiles(env)
  return awsProfiles(readText(files.config), readText(files.credentials)).find((profile) => profile.name === name)?.shortLived ?? false
}

function parseIni(text: string): Sections {
  const sections: Sections = new Map()
  let current: Map<string, string> | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue
    const head = /^\[([^\]]+)\]$/.exec(line)
    if (head !== null) {
      const name = head[1]!.trim()
      current = sections.get(name) ?? new Map()
      sections.set(name, current)
      continue
    }
    const pair = /^([^=]+?)\s*=\s*(.*)$/.exec(line)
    if (pair !== null && current !== null && !/^\s/.test(raw)) current.set(pair[1]!.toLowerCase(), pair[2]!)
  }
  return sections
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/** The account Even Keel runs as: the one whose home holds `~/.aws`. */
export function currentUser(): string {
  try {
    return userInfo().username
  } catch {
    return ''
  }
}
