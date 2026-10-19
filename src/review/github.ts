import { getJson, sendJson } from '../ci/http.js'
import { byTime, said, type Forge, type PullRef, type PullState, type Remark } from './model.js'

export interface GithubPullSettings {
  owner: string
  repo: string
  token: string
}

interface GithubPull {
  number: number
  html_url: string
  state: string
  merged?: boolean
  mergeable?: boolean | null
  head: { sha: string; ref: string }
}

interface GithubUser {
  login: string
  type?: string
}

interface GithubReview {
  id: number
  user: GithubUser | null
  body: string | null
  state: string
  submitted_at: string | null
}

interface GithubComment {
  path: string
  line: number | null
  original_line?: number | null
  body: string
}

/** A comment in the pull request's conversation: GitHub keeps them as the comments of the issue it is. */
interface GithubIssueComment {
  id: number
  user: GithubUser | null
  body: string | null
  created_at: string
}

/** The review states that are remarks; an approval, a dismissed or a pending review is not. */
const REMARK_STATES: Record<string, Remark['kind']> = { CHANGES_REQUESTED: 'changes', COMMENTED: 'review' }

const TITLE = 'GitHub'
const API = 'https://api.github.com'

export function githubPulls(settings: GithubPullSettings, timeoutMs: number, fetchImpl: typeof fetch = fetch): Forge {
  const base = `${API}/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`
  const auth = `Bearer ${settings.token}`
  const get = <T>(path: string) => getJson<T>(TITLE, `${base}${path}`, auth, timeoutMs, fetchImpl)
  const ref = (pull: GithubPull): PullRef => ({ number: pull.number, url: pull.html_url })

  return {
    kind: 'github',

    async find(branch) {
      const head = encodeURIComponent(`${settings.owner}:${branch}`)
      const pulls = await get<GithubPull[]>(`/pulls?state=open&head=${head}&per_page=1`)
      return pulls[0] === undefined ? null : ref(pulls[0])
    },

    async create({ branch, base: target, title, body }) {
      return ref(await sendJson<GithubPull>(TITLE, `${base}/pulls`, auth, { title, head: branch, base: target, body }, timeoutMs, fetchImpl))
    },

    async state(number): Promise<PullState> {
      const pull = await get<GithubPull>(`/pulls/${number}`)
      const state = pull.state === 'open' ? 'open' : pull.merged === true ? 'merged' : 'closed'
      return { state, mergeable: pull.mergeable ?? null, head: pull.head.sha }
    },

    async remarks(number, since, wanted) {
      const [reviews, talk] = await Promise.all([
        get<GithubReview[]>(`/pulls/${number}/reviews?per_page=100`),
        get<GithubIssueComment[]>(`/issues/${number}/comments?since=${encodeURIComponent(since)}&per_page=100`),
      ])
      const asked = reviews.filter(
        (review) => REMARK_STATES[review.state] !== undefined && review.submitted_at !== null && wanted(`review:${review.id}`, review.submitted_at),
      )
      const fromReviews = await Promise.all(
        asked.map(async (review): Promise<Remark> => {
          const comments = await get<GithubComment[]>(`/pulls/${number}/reviews/${review.id}/comments?per_page=100`)
          return {
            key: `review:${review.id}`,
            kind: REMARK_STATES[review.state]!,
            author: review.user?.login ?? '',
            body: review.body ?? '',
            at: review.submitted_at!,
            comments: comments.map((comment) => ({ path: comment.path, line: comment.line ?? comment.original_line ?? null, body: comment.body })),
          }
        }),
      )
      // A bot's comment comes again on each push (coverage, previews): taken as a remark, it would loop the session.
      const fromTalk = talk
        .filter((comment) => comment.user?.type !== 'Bot' && (comment.body ?? '').trim() !== '' && wanted(`comment:${comment.id}`, comment.created_at))
        .map((comment): Remark => ({ key: `comment:${comment.id}`, kind: 'comment', author: comment.user?.login ?? '', body: comment.body ?? '', at: comment.created_at, comments: [] }))
      return byTime([...fromReviews.filter(said), ...fromTalk])
    },
  }
}
