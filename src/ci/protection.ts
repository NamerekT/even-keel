import { matchesGlob } from 'node:path'
import type { CiTarget } from './remote.js'
import type { RemoteProtection } from './protection-model.js'

/** Only reads the server; a failure or an inaccessible API never becomes a claim that a branch is protected. */
export async function branchProtection(target: CiTarget, branch: string, token: string | null, fetcher: typeof fetch = fetch): Promise<RemoteProtection> {
  const { web, owner, repo, kind, remote } = target
  const repository = `${web}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  const base: RemoteProtection = { remote, branch, status: 'unknown', bypass: false, url: kind === 'gitlab' ? `${repository}/-/settings/repository` : `${repository}/settings/${kind === 'github' ? 'rules' : 'branches'}` }
  const get = async (url: string) => {
    const result = await fetcher(url, { headers: { accept: 'application/json', 'user-agent': 'even-keel', ...(token === null ? {} : { authorization: `${kind === 'forgejo' ? 'token' : 'Bearer'} ${token}` }) }, signal: AbortSignal.timeout(10_000), redirect: 'error' })
    return { status: result.status, value: result.ok ? await result.json() as Record<string, any> : null }
  }
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  try {
    if (kind === 'github') {
      const root = `https://api.github.com${path}`
      const [classic, current, rules] = await Promise.all([
        get(`${root}/branches/${encodeURIComponent(branch)}/protection`),
        get(`${root}/branches/${encodeURIComponent(branch)}`),
        get(`${root}/rules/branches/${encodeURIComponent(branch)}?per_page=100`),
      ])
      const types = Array.isArray(rules.value) ? new Set(rules.value.map(rule => rule.type)) : new Set()
      const force = types.has('non_fast_forward') || classic.value?.allow_force_pushes?.enabled === false || classic.value?.lock_branch?.enabled === true
      const deletion = types.has('deletion') || classic.value?.allow_deletions?.enabled === false || classic.value?.lock_branch?.enabled === true
      if (force && deletion) return { ...base, status: 'protected', bypass: types.size > 0 || classic.value?.enforce_admins?.enabled !== true }
      if (current.value?.protected === false && rules.status === 200) return { ...base, status: 'unprotected' }
      if (classic.status === 200 && rules.status === 200) return { ...base, status: 'unprotected' }
      return base
    }
    if (kind !== 'forgejo' || token === null) return base
    const rules: Record<string, any>[] = []
    for (let page = 1; page <= 20; page++) {
      const answer = await get(`${web}/api/v1${path}/branch_protections?limit=50&page=${page}`)
      if (answer.status !== 200 || !Array.isArray(answer.value)) return base
      rules.push(...answer.value)
      if (answer.value.length < 50) break
      if (page === 20) return base
    }
    const name = (rule: Record<string, any>) => rule.rule_name ?? rule.branch_name
    const exact = rules.filter(rule => name(rule) === branch)
    const matching = exact.length > 0 ? exact : rules.filter(rule => typeof name(rule) === 'string' && matchesGlob(branch, name(rule)))
    if (matching.length === 0) return { ...base, status: 'unprotected' }
    const verdicts = new Set(matching.map(rule => rule.enable_force_push === true ? 'unprotected' : rule.enable_force_push === false ? 'protected' : 'unknown'))
    return { ...base, status: verdicts.size === 1 ? [...verdicts][0]! : 'unknown', bypass: matching.some(rule => rule.apply_to_admins !== true || rule.enable_force_push_allowlist === true) }
  } catch { return base }
}
