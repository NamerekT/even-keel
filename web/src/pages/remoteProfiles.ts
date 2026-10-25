import type { CiKind } from '../../../src/ci/model.js'
import type { ProfileView, RemoteRef } from '../../../src/state.js'

const GITHUB_HOST = 'github.com'

/** A Forgejo profile's host, as the service matches it against a remote's (`hostOf`). */
function hostOf(url: string): string | null {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * The profiles a project may choose for its remotes of each kind (BTN-231): the GitHub ones when it has a github.com
 * remote, the GitLab ones on GitLab hosts and the Forgejo ones on its remaining remotes' hosts.
 */
export function remoteChoices<P extends Pick<ProfileView, 'kind' | 'fields'>>(profiles: readonly P[], remotes: readonly RemoteRef[]): Record<CiKind, P[]> {
  const hosts = new Set(remotes.map((remote) => remote.id.split('/')[0]!))
  const labHost = (profile: P) => hostOf(profile.fields.find((field) => field.name === 'GITLAB_URL')?.value || 'https://gitlab.com')
  const labHosts = new Set(['gitlab.com', ...profiles.filter((profile) => profile.kind === 'gitlab').map(labHost)])
  return {
    github: hosts.has(GITHUB_HOST) ? profiles.filter((profile) => profile.kind === 'github') : [],
    gitlab: profiles.filter((profile) => profile.kind === 'gitlab' && hosts.has(labHost(profile) ?? '')),
    forgejo: profiles.filter((profile) => {
      const url = profile.fields.find((field) => field.name === 'FORGEJO_URL')?.value
      const host = profile.kind === 'forgejo' && url ? hostOf(url) : null
      return host !== null && host !== GITHUB_HOST && !labHosts.has(host) && hosts.has(host)
    }),
  }
}
