import { fileURLToPath } from 'node:url'
import { remotesOf } from '../ci/remote.js'
import type { Git } from '../git/types.js'
import { pathKey, pathsOf } from '../paths.js'
import type { RemoteRef } from '../state.js'

const SERVER = /^(?:[^@/\\]+@)?([^:/\\]{2,}):(?!\/\/)(.+)$/

/**
 * One repository however a checkout names it: the remote's name, credentials, the port, `.git` and the case do not
 * count. A local remote (a bare repository on disk) is its resolved path, relative ones from `repo`.
 */
export function remoteRef(url: string, repo: string, platform: NodeJS.Platform = process.platform): RemoteRef | null {
  let host: string
  let path: string
  const scp = url.includes('://') ? null : SERVER.exec(url)
  if (scp !== null) {
    host = scp[1]!
    path = scp[2]!
  } else if (url.includes('://')) {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    if (parsed.protocol === 'file:') return localRef(fileURLToPath(parsed, { windows: platform === 'win32' }), repo, platform)
    host = parsed.hostname
    path = decodeURIComponent(parsed.pathname)
  } else return url.trim() === '' ? null : localRef(url, repo, platform)
  const parts = path.replace(/\/+$/, '').replace(/\.git$/, '').split('/').filter(Boolean)
  if (host === '' || parts.length === 0) return null
  return { id: `${host}/${parts.join('/')}`.toLowerCase(), path: parts.slice(-2).join('/') }
}

function localRef(path: string, repo: string, platform: NodeJS.Platform): RemoteRef {
  const paths = pathsOf(platform)
  const resolved = paths.resolve(repo, path)
  return { id: pathKey(resolved, platform), path: paths.basename(resolved).replace(/\.git$/, '') }
}

/** The repositories a checkout's remotes point at, each once; none when git cannot read the folder. */
export async function checkoutRemotes(git: Git, repo: string): Promise<RemoteRef[]> {
  const urls = await git(repo, ['config', '--get-regexp', '^remote\\..*\\.url$'])
  if (urls.code !== 0) return []
  const refs = new Map<string, RemoteRef>()
  for (const { url } of remotesOf(urls.out)) {
    const ref = remoteRef(url, repo)
    if (ref !== null && !refs.has(ref.id)) refs.set(ref.id, ref)
  }
  return [...refs.values()]
}

/** The remotes of each project's checkout for the page, read again when the config changes and on the CI's interval. */
export class ProjectRemotes {
  view: Record<string, RemoteRef[]> = {}

  constructor(private readonly git: Git) {}

  /** Reads the remotes of `projects` (folder by key); true when the view changed. */
  async apply(projects: Record<string, string>): Promise<boolean> {
    const entries = await Promise.all(
      Object.entries(projects).map(async ([key, repo]) => [key, await checkoutRemotes(this.git, repo).catch(() => [])] as const),
    )
    const view = Object.fromEntries(entries)
    if (JSON.stringify(view) === JSON.stringify(this.view)) return false
    this.view = view
    return true
  }
}
