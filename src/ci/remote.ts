import type { CiKind } from './model.js'
import { Skipped } from '../github/trust.js'
import { hostOf } from './host.js'

export interface RemoteRepo {
  host: string
  /** The server's web address: the API and the runs page hang off it. */
  web: string
  owner: string
  repo: string
}

export interface Remote {
  name: string
  url: string
}

export interface CiTarget extends Omit<RemoteRepo, 'host'> {
  kind: CiKind
  remote: string
}

/** A remote on a forge Even Keel has no adapter for (EKR-8): no CI is watched on it and no pull request opened. */
export interface UnsupportedRemote {
  kind: null
  remote: string
  host: string
}

/** Public forges of a kind with no adapter yet; a new adapter takes its host out of here. */
const UNSUPPORTED_HOSTS: ReadonlySet<string> = new Set(['bitbucket.org'])

/**
 * Public GitHub and GitLab hosts, then self-managed GitLab hosts identified by profiles. Unknown hosts stay Forgejo.
 */
export function remoteKind(host: string, gitlabUrls: readonly string[] = []): CiKind | null {
  const lower = host.toLowerCase()
  if (lower === 'github.com') return 'github'
  if (lower === 'gitlab.com' || gitlabUrls.some((url) => hostOf(url) === lower)) return 'gitlab'
  return UNSUPPORTED_HOSTS.has(lower) ? null : 'forgejo'
}

/** Workflow folders and the root `.gitlab-ci.yml` file. */
export interface Workflows {
  forgejo: boolean
  github: boolean
  gitlab?: boolean
}

const SCP = /^[\w.-]+@([\w.-]+):(.+)$/

export function parseRemote(url: string): RemoteRepo | null {
  let host: string
  let web: string
  let path: string
  const scp = SCP.exec(url)
  if (scp !== null && !url.includes('://')) {
    host = scp[1]!
    web = `https://${host}`
    path = scp[2]!
  } else {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    host = parsed.hostname
    if (host === '' || parsed.protocol === 'file:') return null
    path = parsed.pathname
    if (parsed.protocol === 'ssh:') web = `https://${host}`
    else if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const parts = path.split('/').filter(Boolean)
      web = `${parsed.protocol}//${parsed.host}${parts.length > 2 ? `/${parts.slice(0, -2).join('/')}` : ''}`
    } else return null
  }
  const parts = path.replace(/\.git\/?$/, '').split('/').filter(Boolean)
  if (parts.length < 2) return null
  return { host, web, owner: parts.at(-2)!, repo: parts.at(-1)! }
}

/** The output of `git config --get-regexp ^remote\..*\.url$`. */
export function remotesOf(out: string): Remote[] {
  return out
    .split('\n')
    .map((line) => /^remote\.(.+)\.url\s+(.+)$/.exec(line.trim()))
    .filter((match) => match !== null)
    .map((match) => ({ name: match[1]!, url: match[2]! }))
}

// GitHub runs only `.github/workflows`; Forgejo runs `.forgejo/workflows` and falls back to `.github/workflows` when it
// has none of its own.
export function ciTargets(remotes: Remote[], workflows: Workflows, gitlabUrls: readonly string[] = []): CiTarget[] {
  return remotes.flatMap<CiTarget>(({ name, url }) => {
    const parsed = parseRemote(url)
    if (parsed === null) return []
    const { host, ...repo } = parsed
    const kind = remoteKind(host, gitlabUrls)
    if (kind === null) return []
    if (kind === 'gitlab') {
      const gitlab = gitlabRepo(url, host, gitlabUrls)
      return workflows.gitlab && gitlab ? [{ kind, remote: name, ...gitlab }] : []
    }
    const runs = kind === 'github' ? workflows.github : workflows.forgejo || workflows.github
    return runs ? [{ kind, remote: name, ...repo }] : []
  })
}

const ambiguousGitlab = new Skipped((line) => console.log(line))

/** GitLab groups are part of the project path; the longest matching installation prefix belongs to the server. */
export function gitlabRepo(url: string, host: string, bases: readonly string[]): Omit<RemoteRepo, 'host'> | null {
  const scp = url.includes('://') ? null : SCP.exec(url)
  const parsed = scp ? null : new URL(url)
  const path = `/${(scp ? scp[2]! : parsed!.pathname).replace(/^\/+/, '')}`.replace(/\.git\/?$/, '')
  // SSH paths start at the project namespace; only HTTP remotes carry the installation prefix.
  const web = parsed !== null && parsed.protocol !== 'ssh:'
  const candidates = bases.filter((base) => hostOf(base) === host.toLowerCase()).map((base) => {
    const parsed = new URL(base)
    return { web: `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`, prefix: parsed.pathname.replace(/\/+$/, '') }
  })
  const matching = web ? candidates.filter(({ prefix }) => path.startsWith(`${prefix}/`)).sort((a, b) => b.prefix.length - a.prefix.length) : candidates
  if (web && candidates.length && !matching.length) return null
  const base = new URL(matching[0]?.web ?? (web ? parsed.origin : `https://${host}`))
  const prefix = base.pathname.replace(/\/+$/, '')
  const installations = [...new Set(candidates.map(({ web }) => web))]
  if (!web && installations.length > 1) {
    ambiguousGitlab.note(JSON.stringify(installations), `gitlab: ambiguous SSH remote on ${host}; using ${installations[0]} (first of ${installations.join(', ')})`)
  }
  const parts = path.slice(web ? prefix.length : 0).split('/').filter(Boolean).map(decodeURIComponent)
  if (parts.length < 2) return null
  return { web: `${base.origin}${prefix}`, owner: parts.slice(0, -1).join('/'), repo: parts.at(-1)! }
}
