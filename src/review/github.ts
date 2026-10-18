import { getJson, sendJson } from '../ci/http.js'
import type { ChangeRequest, Forge, PullRef, PullState } from './model.js'

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

interface GithubReview {
  id: number
  user: { login: string } | null
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

    async changes(number, wanted) {
      const reviews = await get<GithubReview[]>(`/pulls/${number}/reviews?per_page=100`)
      const asked = reviews.filter((review) => review.state === 'CHANGES_REQUESTED' && review.submitted_at !== null && wanted(String(review.id), review.submitted_at))
      return Promise.all(
        asked.map(async (review): Promise<ChangeRequest> => {
          const comments = await get<GithubComment[]>(`/pulls/${number}/reviews/${review.id}/comments?per_page=100`)
          return {
            id: String(review.id),
            author: review.user?.login ?? '',
            body: review.body ?? '',
            at: review.submitted_at!,
            comments: comments.map((comment) => ({ path: comment.path, line: comment.line ?? comment.original_line ?? null, body: comment.body })),
          }
        }),
      )
    },
  }
}
