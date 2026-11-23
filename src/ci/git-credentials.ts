import type { GitCredential } from '../git/credentials.js'
import type { ProfileSet } from '../profiles/model.js'
import { ciToken, gitlabUrls } from './adapters.js'
import type { CiKind, RemoteProfiles } from './model.js'
import { ciTargets } from './remote.js'

/**
 * The user name a forge takes with a token over HTTPS: GitHub `x-access-token`, GitLab `oauth2` (both take any token
 * under it); Forgejo and Gitea read only the token, so the profile's login, else a placeholder.
 */
export function gitUser(kind: CiKind, login: string | null): string {
  if (kind === 'github') return 'x-access-token'
  if (kind === 'gitlab') return 'oauth2'
  return login ?? 'even-keel'
}

/** Where a project's remotes take their profile from: the same choice as its CI and pull requests (`ciToken`). */
export interface CredentialScope {
  /** None — no project yet (the clone of a new project's wizard): the forge's default profile. */
  project?: string
  tracker?: string
  chosen?: RemoteProfiles
}

/**
 * The token of each HTTPS remote's profile (BTN-1541), chosen as for the remote's CI (`ciToken`): a profile the project
 * chose for the forge, then the default on that host. A remote no profile has, or a turned-off one, is left out.
 */
export function gitCredentials(urls: readonly string[], set: ProfileSet, scope: CredentialScope = {}): GitCredential[] {
  const workflows = { forgejo: true, github: true, gitlab: true }
  return urls.flatMap((url) =>
    ciTargets([{ name: '', url }], workflows, gitlabUrls(set.profiles)).flatMap((target) => {
      const found = ciToken(target, set, scope.project, scope.tracker ?? '', scope.chosen)
      const profile = found === null ? undefined : set.profiles.find((each) => each.id === found.profile)
      if (found === null || profile === undefined) return []
      return [{ url, username: gitUser(target.kind, profile.login), password: found.token, profile: { id: profile.id, name: profile.name } }]
    }),
  )
}
