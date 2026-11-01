import { getJson, getText, sendJson } from '../ci/http.js'
import { Skipped } from '../github/trust.js'
import { noticeOf } from '../notice/notice.js'
import { byTime, said, type Forge, type PullRef, type PullState, type Remark } from './model.js'

export interface ForgejoPullSettings {
  web: string
  owner: string
  repo: string
  token: string
}

interface ForgejoPull {
  number: number
  html_url: string
  state: string
  merged?: boolean
  mergeable?: boolean
  head: { sha: string; ref: string }
}

interface ForgejoReview {
  id: number
  user: { login: string } | null
  body: string
  state: string
  submitted_at: string
  dismissed?: boolean
}

interface ForgejoComment {
  path: string
  position?: number
  original_position?: number
  body: string
}

/** A comment in the pull request's conversation, from the comments of the issue it is. */
interface ForgejoIssueComment {
  id: number
  user: { login: string } | null
  body: string
  created_at: string
}

/** The review states that are remarks; an approval, a pending review or a review request is not. */
const REMARK_STATES: Record<string, Remark['kind']> = { REQUEST_CHANGES: 'changes', COMMENT: 'review' }

const TITLE = 'Forgejo'
// Open pull requests of the repository looked through for the branch's.
const OPEN_LIMIT = 50
/** The access levels of `/collaborators/{user}/permission` whose remarks reach a session: those who may push. */
const TRUSTED_ACCESS: ReadonlySet<string> = new Set(['write', 'admin', 'owner'])

/** What a check of an author's access found: `outsider` — told by the fallback for a token that may not read access. */
type Access = 'trusted' | 'reader' | 'outsider'

/** A forge is made anew for each call: the service log's record of skipped remarks outlives it. */
const skippedInLog = new Skipped((line) => console.log(line))

// The Gitea API Forgejo keeps: `limit` goes with `page`, as with its runs (`src/ci/forgejo.ts`).
export function forgejoPulls(settings: ForgejoPullSettings, timeoutMs: number, fetchImpl: typeof fetch = fetch, log?: (line: string) => void): Forge {
  const base = `${settings.web}/api/v1/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`
  const slug = `${settings.owner}/${settings.repo}`
  const auth = `token ${settings.token}`
  const skipped = log === undefined ? skippedInLog : new Skipped(log)
  const get = <T>(path: string) => getJson<T>(TITLE, `${base}${path}`, auth, timeoutMs, fetchImpl)
  const ref = (pull: ForgejoPull): PullRef => ({ number: pull.number, url: pull.html_url })
  // A user that does not exist is a 404 on one path and a 422 on another (Forgejo 16): any refusal is a no.
  const denied = (error: unknown) => {
    const told = noticeOf(error)
    return told.code === 'ci.denied' || (told.code === 'ci.http' && told.params.status >= 400 && told.params.status < 500)
  }
  let viewer: Promise<string | null> | undefined
  const viewerOf = () =>
    (viewer ??= getJson<{ login: string }>(TITLE, `${settings.web}/api/v1/user`, auth, timeoutMs, fetchImpl).then(
      (user) => user.login.toLowerCase(),
      (error: unknown) => {
        if (denied(error)) return null
        throw error
      },
    ))

  // A 204 answers yes.
  const yes = (url: string) =>
    getText(TITLE, url, auth, timeoutMs, fetchImpl).then(
      () => true,
      (error: unknown) => {
        if (denied(error)) return false
        throw error
      },
    )

  // Anyone signed in can comment on a pull request of a public repository; the token may push, as it opens them.
  // Forgejo tells another user's access only to an admin of the repository (a bot's token is often not): a refusal
  // falls back to the repository's owner, its collaborators and the members of its organization, as on GitHub.
  async function accessOf(login: string): Promise<Access> {
    try {
      const answer = await get<{ permission: string }>(`/collaborators/${encodeURIComponent(login)}/permission`)
      return TRUSTED_ACCESS.has(answer.permission) ? 'trusted' : 'reader'
    } catch (error) {
      if (!denied(error)) throw error
      if (noticeOf(error).code !== 'ci.denied') return 'reader'
    }
    if (login.toLowerCase() === settings.owner.toLowerCase()) return 'trusted'
    const user = encodeURIComponent(login)
    if (await yes(`${base}/collaborators/${user}`)) return 'trusted'
    return (await yes(`${settings.web}/api/v1/orgs/${encodeURIComponent(settings.owner)}/members/${user}`)) ? 'trusted' : 'outsider'
  }

  async function trustedBy(number: number): Promise<(key: string, what: string, user: { login: string } | null) => Promise<boolean>> {
    const own = await viewerOf()
    const access = new Map<string, Promise<Access>>()
    return async (key, what, user) => {
      const login = user?.login.toLowerCase() ?? null
      if (login !== null && login === own) return true
      if (login !== null && !access.has(login)) access.set(login, accessOf(user!.login))
      const found = login === null ? 'reader' : await access.get(login)!
      if (found === 'trusted') return true
      const why = found === 'outsider' ? `its author is not the owner, a collaborator or a member of the organization of ${slug}` : `its author has no write access to ${slug}`
      skipped.note(`${slug}#${number}:${key}`, `forgejo: ${slug}#${number}: the ${what} of ${user?.login ?? 'a deleted account'} is skipped: ${why}`)
      return false
    }
  }

  return {
    kind: 'forgejo',

    async find(branch) {
      const pulls = await get<ForgejoPull[] | null>(`/pulls?state=open&page=1&limit=${OPEN_LIMIT}`)
      const found = (pulls ?? []).find((pull) => pull.head.ref === branch)
      return found === undefined ? null : ref(found)
    },

    async create({ branch, base: target, title, body }) {
      return ref(await sendJson<ForgejoPull>(TITLE, `${base}/pulls`, auth, { title, head: branch, base: target, body }, timeoutMs, fetchImpl))
    },

    async state(number): Promise<PullState> {
      const pull = await get<ForgejoPull>(`/pulls/${number}`)
      const state = pull.merged === true ? 'merged' : pull.state === 'open' ? 'open' : 'closed'
      return { state, mergeable: pull.mergeable ?? null, head: pull.head.sha }
    },

    async remarks(number, since, wanted) {
      const [reviews, talk] = await Promise.all([
        get<ForgejoReview[] | null>(`/pulls/${number}/reviews?page=1&limit=50`),
        get<ForgejoIssueComment[] | null>(`/issues/${number}/comments?since=${encodeURIComponent(since)}`),
      ])
      const trusted = await trustedBy(number)
      const kept = async <T>(rows: T[], check: (row: T) => Promise<boolean>) => {
        const keep = await Promise.all(rows.map(check))
        return rows.filter((_, index) => keep[index])
      }
      const asked = await kept(
        (reviews ?? []).filter((review) => REMARK_STATES[review.state] !== undefined && review.dismissed !== true && wanted(`review:${review.id}`, review.submitted_at)),
        (review) => trusted(`review:${review.id}`, `review ${review.id}`, review.user),
      )
      const fromReviews = await Promise.all(
        asked.map(async (review): Promise<Remark> => {
          const comments = (await get<ForgejoComment[] | null>(`/pulls/${number}/reviews/${review.id}/comments`)) ?? []
          return {
            key: `review:${review.id}`,
            kind: REMARK_STATES[review.state]!,
            author: review.user?.login ?? '',
            body: review.body,
            at: review.submitted_at,
            comments: comments.map((comment) => ({ path: comment.path, line: comment.position || comment.original_position || null, body: comment.body })),
          }
        }),
      )
      const fromTalk = (
        await kept(
          (talk ?? []).filter((comment) => comment.body.trim() !== '' && wanted(`comment:${comment.id}`, comment.created_at)),
          (comment) => trusted(`comment:${comment.id}`, `comment ${comment.id}`, comment.user),
        )
      ).map((comment): Remark => ({ key: `comment:${comment.id}`, kind: 'comment', author: comment.user?.login ?? '', body: comment.body, at: comment.created_at, comments: [] }))
      return byTime([...fromReviews.filter(said), ...fromTalk])
    },
  }
}
