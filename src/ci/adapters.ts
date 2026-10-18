import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { GITHUB_TOKEN } from '../github/adapter.js'
import type { Git } from '../git/types.js'
import { defaultProfile, profileFor, type ProfileSet, type TrackerProfile } from '../profiles/model.js'
import { FORGEJO_TOKEN, FORGEJO_URL, hostOf } from './forgejo-profile.js'
import { forgejoSource } from './forgejo.js'
import { githubActionsSource } from './github.js'
import type { CiKind, CiSource } from './model.js'
import { ciTargets, remotesOf, type CiTarget } from './remote.js'

/** The variable with the token of each CI in its profile's values: a Forgejo profile's or a GitHub one's (`ciToken`). */
export const CI_TOKENS: Readonly<Record<CiKind, string>> = { forgejo: FORGEJO_TOKEN, github: GITHUB_TOKEN }

/** The variables of the CI layer, kept out of the sessions' environment. */
export const ciVariables = (): string[] => [...Object.values(CI_TOKENS), FORGEJO_URL]

export interface CiToken {
  token: string
  /** The profile it is of. */
  profile: string
}

/**
 * The token of a project's CI: CI is a remote's, not the tracker's. GitHub Actions take the project's tracker profile
 * when it is a GitHub one and the default GitHub profile otherwise (BTN-200); Forgejo — the Forgejo profile on the
 * remote's host, the default one when several are (BTN-201).
 */
export function ciToken(target: Pick<CiTarget, 'kind' | 'web'>, set: ProfileSet, projectId: string | undefined, tracker: string): CiToken | null {
  let profile: TrackerProfile | undefined
  if (target.kind === 'forgejo') {
    const host = hostOf(target.web)
    const onHost = set.profiles.filter((each) => each.kind === 'forgejo' && host !== null && hostOf(each.values[FORGEJO_URL] ?? '') === host)
    profile = onHost.find((each) => each.isDefault) ?? onHost[0]
  } else {
    const own = profileFor(set, projectId, tracker)
    profile = own?.kind === 'github' ? own : defaultProfile(set, 'github')
  }
  const token = profile?.values[CI_TOKENS[target.kind]]
  return profile !== undefined && token ? { token, profile: profile.id } : null
}

export function ciSource(target: CiTarget, token: string | null, timeoutMs: number): CiSource | null {
  if (!token) return null
  return target.kind === 'github'
    ? githubActionsSource({ owner: target.owner, repo: target.repo, token }, timeoutMs)
    : forgejoSource({ web: target.web, owner: target.owner, repo: target.repo, token }, timeoutMs)
}

/** The CIs of a repository: its remotes on GitHub or Forgejo that have workflows to run. */
export async function projectTargets(git: Git, repo: string): Promise<CiTarget[]> {
  const urls = await git(repo, ['config', '--get-regexp', '^remote\\..*\\.url$'])
  if (urls.code !== 0) return []
  const [forgejo, github] = await Promise.all([hasWorkflows(join(repo, '.forgejo', 'workflows')), hasWorkflows(join(repo, '.github', 'workflows'))])
  return ciTargets(remotesOf(urls.out), { forgejo, github })
}

async function hasWorkflows(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).some((name) => /\.ya?ml$/.test(name))
  } catch {
    return false
  }
}
