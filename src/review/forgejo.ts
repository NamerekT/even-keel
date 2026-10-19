import { getJson, sendJson } from '../ci/http.js'
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

// The Gitea API Forgejo keeps: `limit` goes with `page`, as with its runs (`src/ci/forgejo.ts`).
export function forgejoPulls(settings: ForgejoPullSettings, timeoutMs: number, fetchImpl: typeof fetch = fetch): Forge {
  const base = `${settings.web}/api/v1/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`
  const auth = `token ${settings.token}`
  const get = <T>(path: string) => getJson<T>(TITLE, `${base}${path}`, auth, timeoutMs, fetchImpl)
  const ref = (pull: ForgejoPull): PullRef => ({ number: pull.number, url: pull.html_url })

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
      const asked = (reviews ?? []).filter(
        (review) => REMARK_STATES[review.state] !== undefined && review.dismissed !== true && wanted(`review:${review.id}`, review.submitted_at),
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
      const fromTalk = (talk ?? [])
        .filter((comment) => comment.body.trim() !== '' && wanted(`comment:${comment.id}`, comment.created_at))
        .map((comment): Remark => ({ key: `comment:${comment.id}`, kind: 'comment', author: comment.user?.login ?? '', body: comment.body, at: comment.created_at, comments: [] }))
      return byTime([...fromReviews.filter(said), ...fromTalk])
    },
  }
}
