import { runGit } from '../git/run.js'
import { FORGE_WEB } from './ci.fixture.js'

/** What another account may do in the repository: push (`write`) or only read and comment. */
export type Access = 'write' | 'read'

/** The account of the bench's token: the repository's owner, the one Even Keel and its sessions write as. */
export const OWNER = 'john'
const REPO = 'example'

export interface Pull {
  number: number
  branch: string
  base: string
  title: string
  body: string
  state: 'open' | 'closed'
  merged: boolean
  /** The head commit the forge last saw: the branch is gone from the remote after the cleanup. */
  head: string
}

interface Review {
  id: number
  pull: number
  user: string
  state: 'REQUEST_CHANGES' | 'COMMENT' | 'APPROVED'
  body: string
  at: string
  comments: { path: string; position: number; body: string }[]
}

interface Comment {
  id: number
  pull: number
  user: string
  body: string
  at: string
}

type Route = (match: RegExpExecArray, url: URL, body: unknown) => Promise<Response> | Response

/**
 * The pull requests of the bench's Forgejo, served as its API answers them to the real adapter (`forgejoPulls`): the
 * branches and their heads are those of the bare repository, a merge is a real merge there. Reviews and comments carry
 * their author, and `access` says what each account other than `OWNER` may do in the repository.
 */
export class Pulls {
  readonly pulls: Pull[] = []
  readonly access = new Map<string, Access>()
  /** The status opening a pull request answers with instead, as for a token without the right to; `null` — it opens. */
  refuse: number | null = null
  /** How many times the service asked to open a pull request. */
  creates = 0
  private readonly reviews: Review[] = []
  private readonly comments: Comment[] = []
  private ids = 0

  constructor(private readonly remote: () => string) {}

  /** The pull request of the task's branch, the newest first. */
  of(task: string): Pull | undefined {
    const prefix = `${task.toLowerCase()}/`
    return [...this.pulls].reverse().find((pull) => pull.branch.startsWith(prefix))
  }

  /** A comment in the pull request's conversation. */
  comment(number: number, user: string, body: string): void {
    this.comments.push({ id: ++this.ids, pull: number, user, body, at: stamp() })
  }

  /** A review, with its line comments. */
  review(number: number, user: string, state: Review['state'], body: string, comments: Review['comments'] = []): void {
    this.reviews.push({ id: ++this.ids, pull: number, user, state, body, at: stamp(), comments })
  }

  close(number: number): void {
    this.pull(number).state = 'closed'
  }

  /** Merges the pull request's branch into its base in the bare repository, as the forge's button does. */
  async merge(number: number): Promise<void> {
    const pull = this.pull(number)
    const tree = await this.git('merge-tree', '--write-tree', pull.base, pull.branch)
    const identity = ['-c', `user.name=${OWNER}`, '-c', `user.email=${OWNER}@example.com`]
    const commit = await this.git(...identity, 'commit-tree', tree.split('\n')[0]!, '-p', pull.base, '-p', pull.branch, '-m', `Merge pull request #${number}`)
    await this.git('update-ref', `refs/heads/${pull.base}`, commit)
    Object.assign(pull, { state: 'closed', merged: true })
  }

  /** The adapter's `fetch`: answers the paths of the Forgejo API it asks, anything else with 404. */
  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    for (const [route, answer] of this.routes(method)) {
      const match = route.exec(url.pathname)
      if (match !== null) return answer(match, url, body)
    }
    return json(404, { message: 'not found' })
  }

  private routes(method: string): [RegExp, Route][] {
    const repo = `/api/v1/repos/${OWNER}/${REPO}`
    if (method === 'POST') return [[new RegExp(`^${repo}/pulls$`), (_, __, body) => this.create(body as Record<string, string>)]]
    return [
      [/^\/api\/v1\/user$/, () => json(200, { login: OWNER })],
      [new RegExp(`^${repo}/pulls$`), async () => json(200, await Promise.all(this.pulls.filter((pull) => pull.state === 'open').map((pull) => this.answer(pull))))],
      [new RegExp(`^${repo}/pulls/(\\d+)$`), async ([, number]) => json(200, await this.answer(this.pull(Number(number))))],
      [new RegExp(`^${repo}/pulls/(\\d+)/reviews$`), ([, number]) => json(200, this.reviews.filter((review) => review.pull === Number(number)).map(reviewAnswer))],
      [new RegExp(`^${repo}/pulls/\\d+/reviews/(\\d+)/comments$`), ([, id]) => json(200, this.reviews.find((review) => review.id === Number(id))?.comments ?? [])],
      [new RegExp(`^${repo}/issues/(\\d+)/comments$`), ([, number], url) => json(200, this.talk(Number(number), url.searchParams.get('since')))],
      [new RegExp(`^${repo}/collaborators/([^/]+)/permission$`), ([, user]) => this.permission(decodeURIComponent(user!))],
    ]
  }

  private async create(body: Record<string, string>): Promise<Response> {
    this.creates++
    if (this.refuse !== null) return json(this.refuse, { message: 'user should have a permission to write to a repository' })
    const pull: Pull = { number: this.pulls.length + 1, branch: body.head!, base: body.base!, title: body.title!, body: body.body!, state: 'open', merged: false, head: '' }
    this.pulls.push(pull)
    return json(201, await this.answer(pull))
  }

  private permission(user: string): Response {
    if (user.toLowerCase() === OWNER) return json(200, { permission: 'owner' })
    const access = this.access.get(user)
    return access === undefined ? json(404, { message: 'user does not exist' }) : json(200, { permission: access })
  }

  private talk(number: number, since: string | null): object[] {
    return this.comments
      .filter((comment) => comment.pull === number && (since === null || Date.parse(comment.at) >= Date.parse(since)))
      .map(({ id, user, body, at }) => ({ id, user: { login: user }, body, created_at: at }))
  }

  /** The pull request as the API gives it: its head and mergeability read from the bare repository now. */
  private async answer(pull: Pull): Promise<object> {
    const head = await runGit(this.remote(), ['rev-parse', '--verify', '--quiet', `refs/heads/${pull.branch}`])
    if (head.code === 0) pull.head = head.out.trim()
    const mergeable = pull.state === 'open' && head.code === 0 ? (await runGit(this.remote(), ['merge-tree', '--write-tree', pull.base, pull.branch])).code === 0 : false
    return {
      number: pull.number,
      html_url: `${FORGE_WEB}/${OWNER}/${REPO}/pulls/${pull.number}`,
      state: pull.state,
      merged: pull.merged,
      mergeable,
      head: { sha: pull.head, ref: pull.branch },
    }
  }

  private pull(number: number): Pull {
    const pull = this.pulls.find((each) => each.number === number)
    if (pull === undefined) throw new Error(`forge: no pull request #${number}`)
    return pull
  }

  private async git(...args: string[]): Promise<string> {
    const result = await runGit(this.remote(), args)
    if (result.code !== 0) throw new Error(`forge: git ${args.join(' ')}: ${result.out}`)
    return result.out
  }
}

/** A remark comes a moment after what the scenario waited for: in the same millisecond as a push it would not count. */
const stamp = () => new Date(Date.now() + 1).toISOString()

const reviewAnswer = ({ id, user, state, body, at }: Review) => ({ id, user: { login: user }, state, body, submitted_at: at })

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
