import { TrackerNotFound } from '../tracker/source.js'
import { ForgejoHttpError, ForgejoScopeError, type ForgejoApi } from './api.js'

/** The access levels of `/collaborators/{user}/permission` that count as the repository's own people. */
const TRUSTED_ACCESS: ReadonlySet<string> = new Set(['write', 'admin', 'owner'])

/**
 * Whose comments on an issue reach a session (BTN-476): anyone signed in can comment on a public repository (Codeberg),
 * and Forgejo's API has no author association. Trusted are the token's own account, the repository's owner by name and
 * its collaborators — `/collaborators/{user}`, which any reader of the repository may ask; a member of the owning
 * organization who is no collaborator counts only when `/permission` gives write access, which Forgejo tells an admin
 * of the repository alone. Each login is asked once per trust: the source makes one per read.
 */
export function forgejoTrust(api: ForgejoApi, owner: string, repo: string, viewer: string | null): (login: string | null | undefined) => Promise<boolean> {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators`
  const answers = new Map<string, Promise<boolean>>()
  const refused = (error: unknown) =>
    error instanceof TrackerNotFound || error instanceof ForgejoScopeError || (error instanceof ForgejoHttpError && error.status >= 400 && error.status < 500)

  async function ask(login: string): Promise<boolean> {
    try {
      await (await api.request(`${base}/${encodeURIComponent(login)}`)).body?.cancel()
      return true
    } catch (error) {
      if (!refused(error)) throw error
    }
    try {
      const answer = await api.rest<{ permission: string }>(`${base}/${encodeURIComponent(login)}/permission`)
      return TRUSTED_ACCESS.has(answer.permission)
    } catch (error) {
      if (!refused(error)) throw error
      return false
    }
  }

  return async (login) => {
    if (login == null || login === '') return false
    const name = login.toLowerCase()
    if (name === viewer?.toLowerCase() || name === owner.toLowerCase()) return true
    if (!answers.has(name)) answers.set(name, ask(login))
    return answers.get(name)!
  }
}
