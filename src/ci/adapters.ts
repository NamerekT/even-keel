import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { GITHUB_TOKEN } from '../github/adapter.js'
import type { Git } from '../git/types.js'
import { defaultProfile, profileFor, type ProfileSet } from '../profiles/model.js'
import { forgejoSource } from './forgejo.js'
import { githubActionsSource } from './github.js'
import type { CiKind, CiSource } from './model.js'
import { ciTargets, remotesOf, type CiTarget } from './remote.js'

export const FORGEJO_TOKEN = 'FORGEJO_TOKEN'

/** The variable with the token of each CI: Forgejo's is the environment's, GitHub Actions' a GitHub profile's (`ciToken`). */
export const CI_TOKENS: Readonly<Record<CiKind, string>> = { forgejo: FORGEJO_TOKEN, github: GITHUB_TOKEN }

/** The variables of the CI layer, kept out of the sessions' environment. */
export const ciVariables = (): string[] => Object.values(CI_TOKENS)

export interface CiToken {
  token: string
  /** The profile it is of; `null` — of the environment. */
  profile: string | null
}

/**
 * The token of a project's CI (BTN-200): CI is a remote's, not the tracker's, so GitHub Actions take the project's
 * tracker profile when it is a GitHub one and the default GitHub profile otherwise; Forgejo — `FORGEJO_TOKEN`.
 */
export function ciToken(kind: CiKind, set: ProfileSet, projectId: string | undefined, tracker: string, env: NodeJS.ProcessEnv): CiToken | null {
  if (kind === 'forgejo') return env[FORGEJO_TOKEN] ? { token: env[FORGEJO_TOKEN], profile: null } : null
  const own = profileFor(set, projectId, tracker)
  const profile = own?.kind === 'github' ? own : defaultProfile(set, 'github')
  const token = profile?.values[GITHUB_TOKEN]
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
