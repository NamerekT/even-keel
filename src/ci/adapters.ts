import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { GITHUB_TOKEN } from '../github/adapter.js'
import { GITLAB_TOKEN, GITLAB_URL, webUrl } from '../gitlab/api.js'
import type { Git } from '../git/types.js'
import { defaultProfile, profileFor, type ProfileSet, type TrackerProfile } from '../profiles/model.js'
import { FORGEJO_TOKEN, FORGEJO_URL, hostOf } from './forgejo-profile.js'
import { forgejoSource } from './forgejo.js'
import { githubActionsSource } from './github.js'
import { gitlabSource } from './gitlab.js'
import type { CiKind, CiSource, RemoteProfiles } from './model.js'
import { ciTargets, remotesOf, type CiTarget } from './remote.js'

/** The variable with the token of each CI in its profile's values. */
export const CI_TOKENS: Readonly<Record<CiKind, string>> = { forgejo: FORGEJO_TOKEN, github: GITHUB_TOKEN, gitlab: GITLAB_TOKEN }

/** The variables of the CI layer, kept out of the sessions' environment. */
export const ciVariables = (): string[] => [...Object.values(CI_TOKENS), FORGEJO_URL, GITLAB_URL]

export interface CiToken {
  token: string
  /** The profile it is of. */
  profile: string
}

/**
 * An explicit remote profile wins. GitHub otherwise takes the project's GitHub profile or the default. GitLab takes
 * the project's GitLab profile for the installation, then its default there; Forgejo takes its default on that host.
 */
export function ciToken(
  target: Pick<CiTarget, 'kind' | 'web'>,
  set: ProfileSet,
  projectId: string | undefined,
  tracker: string,
  chosen: RemoteProfiles = {},
): CiToken | null {
  let profile: TrackerProfile | undefined
  if (target.kind === 'forgejo') {
    const host = hostOf(target.web)
    const onHost = set.profiles.filter((each) => each.kind === 'forgejo' && host !== null && hostOf(each.values[FORGEJO_URL] ?? '') === host)
    profile = onHost.find((each) => each.id === chosen.forgejo) ?? onHost.find((each) => each.isDefault) ?? onHost[0]
  } else if (target.kind === 'gitlab') {
    const own = profileFor(set, projectId, tracker)
    const installation = new URL(target.web).href.replace(/\/+$/, '')
    const onInstallation = set.profiles.filter((each) => each.kind === 'gitlab' && new URL(webUrl(each.values)).href.replace(/\/+$/, '') === installation)
    profile = onInstallation.find((each) => each.id === chosen.gitlab) ?? onInstallation.find((each) => each.id === own?.id) ?? onInstallation.find((each) => each.isDefault) ?? onInstallation[0]
  } else {
    const own = profileFor(set, projectId, tracker)
    profile = set.profiles.find((each) => each.kind === 'github' && each.id === chosen.github) ?? (own?.kind === 'github' ? own : defaultProfile(set, 'github'))
  }
  const token = profile?.values[CI_TOKENS[target.kind]]
  return profile !== undefined && token ? { token, profile: profile.id } : null
}

export function ciSource(target: CiTarget, token: string | null, timeoutMs: number): CiSource | null {
  if (!token) return null
  if (target.kind === 'gitlab') return gitlabSource({ ...target, token }, timeoutMs)
  return target.kind === 'github'
    ? githubActionsSource({ owner: target.owner, repo: target.repo, token }, timeoutMs)
    : forgejoSource({ web: target.web, owner: target.owner, repo: target.repo, token }, timeoutMs)
}

/** The remotes with configuration for their forge's CI, using current profiles to identify self-managed GitLab. */
export async function projectTargets(git: Git, repo: string, profiles: readonly TrackerProfile[] = []): Promise<CiTarget[]> {
  const urls = await git(repo, ['config', '--get-regexp', '^remote\\..*\\.url$'])
  if (urls.code !== 0) return []
  const [forgejo, github] = await Promise.all([hasWorkflows(join(repo, '.forgejo', 'workflows')), hasWorkflows(join(repo, '.github', 'workflows'))])
  const gitlab = await stat(join(repo, '.gitlab-ci.yml')).then((file) => file.isFile(), () => false)
  return ciTargets(remotesOf(urls.out), { forgejo, github, gitlab }, gitlabUrls(profiles))
}

export const gitlabUrls = (profiles: readonly TrackerProfile[]): string[] => profiles.filter((profile) => profile.kind === 'gitlab').map((profile) => webUrl(profile.values))

async function hasWorkflows(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).some((name) => /\.ya?ml$/.test(name))
  } catch {
    return false
  }
}
