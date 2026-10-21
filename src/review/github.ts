import { getJson, sendJson } from '../ci/http.js'
import { Skipped, trustedAuthor } from '../github/trust.js'
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
  author_association?: string
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
  author_association?: string
  body: string | null
  created_at: string
}

/** The review states that are remarks; an approval, a dismissed or a pending review is not. */
const REMARK_STATES: Record<string, Remark['kind']> = { CHANGES_REQUESTED: 'changes', COMMENTED: 'review' }

const TITLE = 'GitHub'
const API = 'https://api.github.com'

/** A forge is made anew for each call: the service log's record of skipped remarks outlives it. */
const skippedInLog = new Skipped((line) => console.log(line))

export function githubPulls(settings: GithubPullSettings, timeoutMs: number, fetchImpl: typeof fetch = fetch, log?: (line: string) => void): Forge {
  const base = `${API}/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`
  const slug = `${settings.owner}/${settings.repo}`
  const skipped = log === undefined ? skippedInLog : new Skipped(log)
  // Anyone can review or comment on a pull request of a public repository; the token is a collaborator, as it pushes.
  const trusted = (number: number, key: string, what: string, user: GithubUser | null, association: string | undefined) => {
    if (trustedAuthor(association, user?.login, null)) return true
    skipped.note(`${slug}#${number}:${key}`, `github: ${slug}#${number}: the ${what} of ${user?.login ?? 'a deleted account'} is skipped: its author is not a collaborator of ${slug}`)
    return false
  }
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
        (review) =>
          REMARK_STATES[review.state] !== undefined &&
          review.submitted_at !== null &&
          wanted(`review:${review.id}`, review.submitted_at) &&
          trusted(number, `review:${review.id}`, `review ${review.id}`, review.user, review.author_association),
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
        .filter(
          (comment) =>
            comment.user?.type !== 'Bot' &&
            (comment.body ?? '').trim() !== '' &&
            wanted(`comment:${comment.id}`, comment.created_at) &&
            trusted(number, `comment:${comment.id}`, `comment ${comment.id}`, comment.user, comment.author_association),
        )
        .map((comment): Remark => ({ key: `comment:${comment.id}`, kind: 'comment', author: comment.user?.login ?? '', body: comment.body ?? '', at: comment.created_at, comments: [] }))
      return byTime([...fromReviews.filter(said), ...fromTalk])
    },
  }
}
