import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { GITHUB_TOKEN } from '../github/adapter.js'
import type { Git } from '../git/types.js'
import { forgejoSource } from './forgejo.js'
import { githubActionsSource } from './github.js'
import type { CiKind, CiSource } from './model.js'
import { ciTargets, remotesOf, type CiTarget } from './remote.js'

export const FORGEJO_TOKEN = 'FORGEJO_TOKEN'

/** The variable with the token of each CI; GitHub Actions shares the token of the GitHub tracker. */
export const CI_TOKENS: Readonly<Record<CiKind, string>> = { forgejo: FORGEJO_TOKEN, github: GITHUB_TOKEN }

/** The variables of the CI layer, kept out of the sessions' environment. */
export const ciVariables = (): string[] => Object.values(CI_TOKENS)

export function ciSource(target: CiTarget, env: NodeJS.ProcessEnv, timeoutMs: number): CiSource | null {
  const token = env[CI_TOKENS[target.kind]]
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
