import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RemoteGit } from './remote-run.js'
import { remoteUrls } from './remote-urls.js'
import type { Git, GitDenied, GitResult } from './types.js'

/**
 * A token the service gives its own git for one HTTPS remote (BTN-1541, `docs/ci/layer.md`, "Git over HTTPS"): the
 * profile's token as the password, under the forge's user name.
 */
export interface GitCredential {
  /** The remote's address without a user, a query or a trailing slash: the pattern of git's `credential.<url>`. */
  url: string
  username: string
  password: string
  /** The profile the token is of, named when the remote refuses a push. */
  profile: { id: string; name: string }
}

/** The credentials of a folder's remotes (`credentialUrl` of each); a remote with no profile is left out. */
export type CredentialsOf = (folder: string, urls: readonly string[]) => Promise<readonly GitCredential[]>

/** The subcommands that reach a remote; a `git sync` alias is one too. */
const REMOTE_COMMANDS: ReadonlySet<string> = new Set(['push', 'fetch', 'pull', 'ls-remote', 'sync'])

/**
 * Where a credentialed call looks for its hooks: a path under this module's own file, which no one can make a folder.
 * A hook would run with the token in its environment, and a session can point `core.hooksPath` anywhere it writes.
 */
const NO_HOOKS = join(fileURLToPath(import.meta.url), 'no-hooks')

/**
 * The address git matches a `credential.<url>` pattern against: an HTTPS remote's, without the user part. Plain
 * `http:` would send the token in clear text, and SSH remotes keep their keys: `null` for both.
 */
export function credentialUrl(url: string): string | null {
  if (!/^https:\/\//i.test(url.trim())) return null
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  return parsed.hostname === '' ? null : `https://${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`
}

/** The HTTPS addresses among the output of `git config --get-regexp ^remote\..*\.url$`, each once. */
export function credentialUrls(out: string): string[] {
  const urls = out.split('\n').map((line) => credentialUrl(line.trim().split(/\s+/).slice(1).join(' ')))
  return [...new Set(urls.filter((url) => url !== null))]
}

/**
 * The helper of credential `index`: it answers git's `get` from the call's own environment and ignores `store` and
 * `erase`, so nothing is written anywhere.
 */
const helperOf = (index: number): string =>
  `!f() { if test "$1" = get; then printf 'username=%s\\npassword=%s\\n' "$EVEN_KEEL_GIT_USERNAME_${index}" "$EVEN_KEEL_GIT_PASSWORD_${index}"; fi; }; f`

/**
 * The environment of one git call that gives it the credentials (`GIT_CONFIG_COUNT`, git 2.31+; an older git ignores
 * it and works with its own helper). Each remote's helpers are reset first, so a helper of the user's or of the
 * repository never sees the remote, and hooks are off for the call. Entries already in `env` are kept before these.
 */
export function credentialEnv(credentials: readonly GitCredential[], env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const start = Math.max(0, Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10) || 0)
  const entries: [string, string][] = [['core.hooksPath', NO_HOOKS]]
  const values: Record<string, string> = {}
  credentials.forEach((credential, index) => {
    entries.push([`credential.${credential.url}.helper`, ''], [`credential.${credential.url}.helper`, helperOf(index)])
    values[`EVEN_KEEL_GIT_USERNAME_${index}`] = credential.username
    values[`EVEN_KEEL_GIT_PASSWORD_${index}`] = credential.password
  })
  entries.forEach(([key, value], at) => {
    values[`GIT_CONFIG_KEY_${start + at}`] = key
    values[`GIT_CONFIG_VALUE_${start + at}`] = value
  })
  values.GIT_CONFIG_COUNT = String(start + entries.length)
  return values
}

/** What a forge says when the token reached it but may not write: GitHub, GitLab, Forgejo and Gitea, then curl's 403. */
const READ_ONLY = /Write access to repository not granted|Permission to \S+ denied|permission denied for writing|not allowed to push|The requested URL returned error: 403/i

/** The profile whose token a refused push used: the one whose address git named, else the first. `null` — not a refusal of writing. */
export function deniedOf(result: GitResult, credentials: readonly GitCredential[]): GitDenied | null {
  if (result.code === 0 || credentials.length === 0 || !READ_ONLY.test(result.out)) return null
  const named = credentials.find((each) => result.out.toLowerCase().includes(each.url.toLowerCase())) ?? credentials[0]!
  return { profile: named.profile.id, name: named.profile.name, url: named.url }
}

/**
 * Remote git (`ls-remote`, `clone`) given its remote by address, not by a folder's config: an HTTPS address among its
 * arguments gets the token of its profile for the call, as `withCredentials` does. A clone keeps no token: its origin
 * is the address as typed.
 */
export function credentialedRemote(git: RemoteGit, credentialsOf: (urls: readonly string[]) => Promise<readonly GitCredential[]>, env: NodeJS.ProcessEnv = process.env): RemoteGit {
  return async (args, options) => {
    const urls = [...new Set(args.map(credentialUrl).filter((url) => url !== null))]
    const credentials = urls.length === 0 ? [] : await credentialsOf(urls).catch(() => [])
    if (credentials.length === 0) return git(args, options)
    return git(args, { ...options, env: { ...options?.env, ...credentialEnv(credentials, env) } })
  }
}

/**
 * Git whose calls to a remote get the token of the remote's profile for the call (BTN-1541): only the HTTPS remotes
 * `credentialsOf` knows; the rest, SSH included, work with what git has of its own. Other calls go as they are. A
 * push refused for writing is made once more on git's own credentials; refused again, it carries the profile
 * (`GitResult.denied`).
 */
export function withCredentials(git: Git, credentialsOf: CredentialsOf, env: NodeJS.ProcessEnv = process.env): Git {
  return async (cwd, args, extra) => {
    if (!REMOTE_COMMANDS.has(args[0] ?? '')) return git(cwd, args, extra)
    const listed = await remoteUrls(git, cwd)
    const urls = listed.code === 0 ? credentialUrls(listed.out) : []
    const credentials = urls.length === 0 ? [] : await credentialsOf(cwd, urls).catch(() => [])
    if (credentials.length === 0) return git(cwd, args, extra)
    const result = await git(cwd, args, { ...extra, ...credentialEnv(credentials, { ...env, ...extra }) })
    const denied = args[0] === 'push' || args[0] === 'sync' ? deniedOf(result, credentials) : null
    if (denied === null) return result
    // A read-only token of the CI must not take away a push git's own helper could make, as before BTN-1541.
    const own = await git(cwd, args, extra)
    return own.code === 0 ? own : { ...result, denied }
  }
}
