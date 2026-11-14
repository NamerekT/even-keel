import { getJson, sendJson } from '../ci/http.js'
import { EDITS, textEditOf, type GithubEdits } from '../github/edits.js'
import { noticeOf } from '../notice/notice.js'
import type { TextEdit } from '../tracker/model.js'
import type { IntakeComment, IntakeIssue } from './model.js'

/** The calls of the intake on one GitHub repository (BTN-262). */
export interface IntakeRepo {
  /** The open issues with the label, pull requests left out, oldest first. */
  labeled(label: string): Promise<IntakeIssue[]>
  /** `null` — the issue is gone. */
  issue(number: number): Promise<IntakeIssue | null>
  /** The changes of the issue's text by its author and its label puttings (BTN-1124); `undefined` — the author changed nothing. */
  edits(number: number): Promise<TextEdit | undefined>
  /** The issue's comments with an id above `after`, oldest first. */
  comments(number: number, after: number): Promise<IntakeComment[]>
  comment(number: number, body: string): Promise<void>
  /** Closes the issue as completed. */
  close(number: number): Promise<void>
  /** The repository's tags that start with `prefix`. */
  tags(prefix: string): Promise<string[]>
  /** Whether a published release (not a draft, not a prerelease) has the tag. */
  released(tag: string): Promise<boolean>
  /** Whether a release was published after the moment `at`. */
  releasedSince(at: string): Promise<boolean>
}

interface GithubIssue {
  number: number
  title: string
  body: string | null
  html_url: string
  state: string
  user: { login: string } | null
  author_association?: string
  pull_request?: unknown
}

interface GithubComment {
  id: number
  html_url: string
  body: string | null
  user: { login: string; type?: string } | null
  author_association?: string
}

interface GithubRelease {
  draft: boolean
  prerelease: boolean
  published_at: string | null
}

const TITLE = 'GitHub'
const API = 'https://api.github.com'
const PAGES = 10

export function intakeRepo(slug: string, token: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): IntakeRepo {
  const base = `${API}/repos/${slug.split('/').map(encodeURIComponent).join('/')}`
  const auth = `Bearer ${token}`
  const get = <T>(path: string) => getJson<T>(TITLE, `${base}${path}`, auth, timeoutMs, fetchImpl, 'intake.denied')
  const send = (path: string, body: unknown, method: 'POST' | 'PATCH') => sendJson(TITLE, `${base}${path}`, auth, body, timeoutMs, fetchImpl, method, 'intake.denied')
  const unlessGone = async <T>(read: () => Promise<T>, gone: T): Promise<T> => {
    try {
      return await read()
    } catch (error) {
      const notice = noticeOf(error)
      if (notice.code === 'ci.http' && (notice.params.status === 404 || notice.params.status === 410)) return gone
      throw error
    }
  }
  const issueOf = (issue: GithubIssue): IntakeIssue => ({
    number: issue.number,
    title: issue.title,
    body: issue.body ?? '',
    url: issue.html_url,
    author: issue.user?.login ?? '',
    association: issue.author_association ?? 'NONE',
    open: issue.state === 'open',
  })
  const published = (release: GithubRelease) => !release.draft && !release.prerelease && release.published_at !== null

  return {
    async labeled(label) {
      const issues = await get<GithubIssue[]>(`/issues?state=open&labels=${encodeURIComponent(label)}&sort=created&direction=asc&per_page=100`)
      return issues.filter((issue) => issue.pull_request === undefined).map(issueOf)
    },

    issue: (number) => unlessGone(async () => issueOf(await get<GithubIssue>(`/issues/${number}`)), null),

    // REST keeps no history of an issue's text: GraphQL does.
    async edits(number) {
      const [owner, name] = slug.split('/')
      const query = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { author { login } ${EDITS} } } }`
      const answer = await sendJson<{ data?: { repository: { issue: GithubEdits | null } | null } | null }>(
        TITLE, `${API}/graphql`, auth, { query, variables: { owner, name, number } }, timeoutMs, fetchImpl, 'POST', 'intake.denied',
      )
      const issue = answer.data?.repository?.issue
      return issue == null ? undefined : textEditOf(issue)
    },

    async comments(number, after) {
      const found: GithubComment[] = []
      for (let page = 1; page <= PAGES; page++) {
        const comments = await get<GithubComment[]>(`/issues/${number}/comments?per_page=100&page=${page}`)
        found.push(...comments)
        if (comments.length < 100) break
      }
      return found
        .filter((comment) => comment.id > after)
        .sort((a, b) => a.id - b.id)
        .map((comment) => ({
          id: comment.id,
          url: comment.html_url,
          author: comment.user?.login ?? '',
          association: comment.author_association ?? 'NONE',
          body: comment.body ?? '',
          bot: comment.user?.type === 'Bot',
        }))
    },

    async comment(number, body) {
      await send(`/issues/${number}/comments`, { body }, 'POST')
    },

    async close(number) {
      await send(`/issues/${number}`, { state: 'closed', state_reason: 'completed' }, 'PATCH')
    },

    async tags(prefix) {
      const refs = await unlessGone(() => get<{ ref: string }[]>(`/git/matching-refs/tags/${encodeURIComponent(prefix)}`), [])
      return refs.map((ref) => ref.ref.replace(/^refs\/tags\//, ''))
    },

    released: (tag) => unlessGone(async () => published(await get<GithubRelease>(`/releases/tags/${encodeURIComponent(tag)}`)), false),

    async releasedSince(at) {
      const releases = await get<GithubRelease[]>('/releases?per_page=20')
      return releases.some((release) => published(release) && release.published_at! > at)
    },
  }
}
