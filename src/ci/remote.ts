import type { CiKind } from './model.js'

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

/** Which workflow folders the repository has: `.forgejo/workflows` and `.github/workflows`. */
export interface Workflows {
  forgejo: boolean
  github: boolean
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

// GitHub runs only `.github/workflows`; any other host is taken for Forgejo, which runs `.forgejo/workflows`
// and falls back to `.github/workflows` when it has none of its own.
export function ciTargets(remotes: Remote[], workflows: Workflows): CiTarget[] {
  return remotes.flatMap(({ name, url }) => {
    const parsed = parseRemote(url)
    if (parsed === null) return []
    const { host, ...repo } = parsed
    const kind: CiKind = host === 'github.com' ? 'github' : 'forgejo'
    const runs = kind === 'github' ? workflows.github : workflows.forgejo || workflows.github
    return runs ? [{ kind, remote: name, ...repo }] : []
  })
}
