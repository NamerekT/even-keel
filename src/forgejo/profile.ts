import { FORGEJO_TOKEN, FORGEJO_URL } from '../ci/forgejo-profile.js'
import type { TrackerProject } from '../tracker/source.js'
import { ForgejoApi } from './api.js'

/** The most a `projects` answer lists, and the pages of the account's repositories looked through for it. */
const LIMIT = 50
const PAGES = 10

interface Repository {
  full_name: string
  name: string
  has_issues?: boolean
}

/**
 * The repositories the token's account owns, collaborates on or reaches through its organizations whose `owner/name` or
 * name has `query` in it, newest first by Forgejo's order; one with issues turned off is no tracker.
 */
export async function forgejoProjects(values: Readonly<Record<string, string>>, query: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<TrackerProject[]> {
  const api = new ForgejoApi(values[FORGEJO_URL] ?? '', values[FORGEJO_TOKEN] ?? '', timeoutMs, fetchImpl)
  const wanted = query.trim().toLowerCase()
  const found: TrackerProject[] = []
  for (let page = 1; page <= PAGES && found.length < LIMIT; page++) {
    const rows = (await api.rest<Repository[] | null>(`/user/repos?limit=${LIMIT}&page=${page}`)) ?? []
    for (const repo of rows) {
      if (repo.has_issues !== false && `${repo.full_name} ${repo.name}`.toLowerCase().includes(wanted)) found.push({ key: repo.full_name, name: repo.name })
    }
    if (rows.length === 0) break
  }
  return found.slice(0, LIMIT)
}
