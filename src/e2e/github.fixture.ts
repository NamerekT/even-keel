import { json, OWNER } from './forge.fixture.js'

/** The bench's GitHub repository: the project's `github` remote names it, and its intake reads it. */
export const GITHUB_REPO = 'example'
export const GITHUB_URL = `https://github.com/${OWNER}/${GITHUB_REPO}.git`
const API = 'https://api.github.com'

/** GitHub's `author_association` of a comment's author. */
export type Association = 'OWNER' | 'MEMBER' | 'COLLABORATOR' | 'CONTRIBUTOR' | 'NONE'

interface Issue {
  number: number
  title: string
  body: string
  author: string
  labels: string[]
  state: 'open' | 'closed'
  reason: string | null
}

interface Comment {
  id: number
  issue: number
  author: string
  association: Association
  body: string
}

interface Release {
  tag: string
  draft: boolean
  prerelease: boolean
  published_at: string | null
}

type Route = (match: RegExpExecArray, url: URL, body: Record<string, unknown>) => Response

/**
 * The REST API of github.com as the service reads it for the intake of issues (`intakeRepo`) and the profile's check
 * (`githubAccount`): the issues, comments, tags and releases of one repository of `OWNER`, whose token Even Keel holds.
 * Any other path is a 404, as for a token that sees nothing there.
 */
export class GitHub {
  readonly issues = new Map<number, Issue>()
  readonly tags: string[] = []
  readonly releases: Release[] = []
  private readonly comments: Comment[] = []
  /** Comment ids run high and apart from issue numbers, as GitHub's do. */
  private ids = 5000

  /** An issue opened by `author`, with `labels` put on by someone with triage rights. */
  open(number: number, title: string, body: string, author: string, ...labels: string[]): void {
    this.issues.set(number, { number, title, body, author, labels, state: 'open', reason: null })
  }

  label(number: number, ...labels: string[]): void {
    this.issue(number).labels = labels
  }

  /** A comment on the issue by `author`; returns its id. */
  comment(number: number, author: string, association: Association, body: string): number {
    this.comments.push({ id: ++this.ids, issue: number, author, association, body })
    return this.ids
  }

  commentsOf(number: number): string[] {
    return this.comments.filter((comment) => comment.issue === number).map((comment) => comment.body)
  }

  state(number: number): { state: Issue['state']; reason: string | null } {
    const { state, reason } = this.issue(number)
    return { state, reason }
  }

  /** A release of `tag`: a draft or a prerelease until `publish`. */
  release(tag: string, kind: 'draft' | 'prerelease' | 'published'): void {
    const published = kind === 'published' ? new Date().toISOString() : null
    this.releases.unshift({ tag, draft: kind === 'draft', prerelease: kind === 'prerelease', published_at: published })
  }

  publish(tag: string): void {
    Object.assign(this.releases.find((release) => release.tag === tag)!, { draft: false, prerelease: false, published_at: new Date().toISOString() })
  }

  /** In place of the global `fetch`: answers api.github.com, hands any other address to `real`. */
  fetchOver(real: typeof fetch): typeof fetch {
    return async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin !== API) return real(input, init)
      const method = init?.method ?? 'GET'
      const body = (typeof init?.body === 'string' ? JSON.parse(init.body) : {}) as Record<string, unknown>
      for (const [route, answer] of this.routes(method)) {
        const match = route.exec(url.pathname)
        if (match !== null) return answer(match, url, body)
      }
      return json(404, { message: 'Not Found' })
    }
  }

  private routes(method: string): [RegExp, Route][] {
    const repo = `/repos/${OWNER}/${GITHUB_REPO}`
    if (method === 'POST') return [[new RegExp(`^${repo}/issues/(\\d+)/comments$`), ([, number], _, body) => this.posted(Number(number), String(body.body))]]
    if (method === 'PATCH') return [[new RegExp(`^${repo}/issues/(\\d+)$`), ([, number], _, body) => this.patched(Number(number), body)]]
    return [
      [/^\/user$/, () => json(200, { login: OWNER })],
      [/^\/user\/repos$/, () => json(200, [{ full_name: `${OWNER}/${GITHUB_REPO}`, name: GITHUB_REPO, owner: { login: OWNER } }])],
      [new RegExp(`^${repo}/issues$`), (_, url) => json(200, this.labeled(url.searchParams.get('labels') ?? ''))],
      [new RegExp(`^${repo}/issues/(\\d+)$`), ([, number]) => (this.issues.has(Number(number)) ? json(200, answer(this.issue(Number(number)))) : json(404, { message: 'Not Found' }))],
      [new RegExp(`^${repo}/issues/(\\d+)/comments$`), ([, number], url) => json(200, this.page(Number(number), Number(url.searchParams.get('page') ?? 1)))],
      [new RegExp(`^${repo}/git/matching-refs/tags/(.*)$`), ([, prefix]) => json(200, this.tags.filter((tag) => tag.startsWith(decodeURIComponent(prefix!))).map((tag) => ({ ref: `refs/tags/${tag}` })))],
      [new RegExp(`^${repo}/releases/tags/(.+)$`), ([, tag]) => this.releaseOf(decodeURIComponent(tag!))],
      [new RegExp(`^${repo}/releases$`), () => json(200, this.releases)],
    ]
  }

  private labeled(labels: string): object[] {
    const wanted = labels.split(',').filter((label) => label !== '')
    return [...this.issues.values()]
      .filter((issue) => issue.state === 'open' && wanted.every((label) => issue.labels.includes(label)))
      .sort((a, b) => a.number - b.number)
      .map(answer)
  }

  private page(number: number, page: number): object[] {
    return this.comments
      .filter((comment) => comment.issue === number)
      .slice((page - 1) * 100, page * 100)
      .map(({ id, author, association, body }) => ({ id, html_url: `https://github.com/${OWNER}/${GITHUB_REPO}/issues/${number}#issuecomment-${id}`, body, user: { login: author, type: 'User' }, author_association: association }))
  }

  private posted(number: number, body: string): Response {
    return json(201, { id: this.comment(number, OWNER, 'OWNER', body) })
  }

  private patched(number: number, body: Record<string, unknown>): Response {
    const issue = this.issue(number)
    if (body.state === 'closed') Object.assign(issue, { state: 'closed', reason: String(body.state_reason ?? 'completed') })
    return json(200, answer(issue))
  }

  private releaseOf(tag: string): Response {
    const release = this.releases.find((each) => each.tag === tag)
    return release === undefined ? json(404, { message: 'Not Found' }) : json(200, release)
  }

  private issue(number: number): Issue {
    const issue = this.issues.get(number)
    if (issue === undefined) throw new Error(`github: no issue #${number}`)
    return issue
  }
}

const answer = (issue: Issue) => ({
  number: issue.number,
  title: issue.title,
  body: issue.body,
  html_url: `https://github.com/${OWNER}/${GITHUB_REPO}/issues/${issue.number}`,
  state: issue.state,
  user: { login: issue.author },
})
