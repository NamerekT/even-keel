import { getJson, getJsonPage, sendJson } from '../ci/http.js'
import { Skipped } from '../github/trust.js'
import { noticeOf } from '../notice/notice.js'
import { byTime, type Forge, type PullRef, type PullState, type Remark } from './model.js'

export interface GitlabPullSettings {
  /** The server with its installation prefix, as the CI has it (`src/ci/remote.ts`). */
  web: string
  /** The project's namespace, subgroups included. */
  owner: string
  repo: string
  token: string
}

interface GitlabMergeRequest {
  iid: number
  web_url: string
  state: string
  sha: string
  has_conflicts?: boolean
  /** GitLab 15.6 and later; older servers have only `merge_status`. */
  detailed_merge_status?: string
  merge_status?: string
}

interface GitlabAuthor {
  id: number
  username: string
  bot?: boolean
}

interface GitlabPosition {
  new_path: string | null
  new_line: number | null
  old_path: string | null
  old_line: number | null
}

interface GitlabNote {
  id: number
  type: string | null
  body: string
  author: GitlabAuthor | null
  created_at: string
  system: boolean
  position?: GitlabPosition
}

interface GitlabDiscussion {
  id: string
  notes: GitlabNote[]
}

const TITLE = 'GitLab'
const PAGE = 100
/** Reporter: who may comment on an issue of a private project, as the GitLab tracker reads its comments. */
const TRUSTED_LEVEL = 20
/** The merge statuses of a check of mergeability not done yet. */
const UNCHECKED: ReadonlySet<string> = new Set(['unchecked', 'checking', 'preparing'])
/** The users of project and group access tokens: members of the project, so the level check lets them through. */
const TOKEN_BOT = /^(?:project|group)_\d+_bot(?:_[\da-f]+)?$/i

/** A forge is made anew for each call: the service log's record of skipped remarks outlives it. */
const skippedInLog = new Skipped((line) => console.log(line))

export function gitlabPulls(settings: GitlabPullSettings, timeoutMs: number, fetchImpl: typeof fetch = fetch, log?: (line: string) => void): Forge {
  const path = `${settings.owner}/${settings.repo}`
  const base = `${settings.web}/api/v4/projects/${encodeURIComponent(path)}`
  const auth = `Bearer ${settings.token}`
  const skipped = log === undefined ? skippedInLog : new Skipped(log)
  const get = <T>(route: string) => getJson<T>(TITLE, `${base}${route}`, auth, timeoutMs, fetchImpl)
  const ref = (request: GitlabMergeRequest): PullRef => ({ number: request.iid, url: request.web_url })

  async function discussions(iid: number): Promise<GitlabDiscussion[]> {
    const rows: GitlabDiscussion[] = []
    let page: number | null = 1
    while (page !== null) {
      const result: { rows: GitlabDiscussion[]; nextPage: string | null } = await getJsonPage<GitlabDiscussion>(
        TITLE, `${base}/merge_requests/${iid}/discussions?per_page=${PAGE}&page=${page}`, auth, timeoutMs, fetchImpl,
      )
      rows.push(...result.rows)
      // Without the header the page's length tells; a page number that does not go forward ends the list.
      const next: number | null = result.nextPage ? Number(result.nextPage) : result.rows.length === PAGE ? page + 1 : null
      page = next !== null && Number.isInteger(next) && next > page ? next : null
    }
    return rows
  }

  // Anyone can comment on a merge request of a public project; the token is a member, as it pushes.
  async function trustedBy(iid: number): Promise<(note: GitlabNote) => Promise<boolean>> {
    const levels = new Map<number, Promise<number>>()
    const levelOf = (id: number) =>
      get<{ access_level: number }>(`/members/all/${id}`).then(
        (member) => member.access_level,
        (error: unknown) => {
          const told = noticeOf(error)
          if (told.code === 'ci.denied' || (told.code === 'ci.http' && told.params.status === 404)) return 0
          throw error
        },
      )
    return async (note) => {
      const author = note.author
      if (author !== null && !levels.has(author.id)) levels.set(author.id, levelOf(author.id))
      if (author !== null && (await levels.get(author.id)!) >= TRUSTED_LEVEL) return true
      const who = author?.username ?? 'a deleted account'
      skipped.note(`${path}!${iid}:${note.id}`, `gitlab: ${path}!${iid}: note ${note.id} of ${who} is skipped: its author is not a Reporter or above in ${path}`)
      return false
    }
  }

  return {
    kind: 'gitlab',

    async find(branch) {
      const requests = await get<GitlabMergeRequest[]>(`/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}&per_page=1`)
      return requests[0] === undefined ? null : ref(requests[0])
    },

    async create({ branch, base: target, title, body }) {
      const request = { source_branch: branch, target_branch: target, title, description: body }
      return ref(await sendJson<GitlabMergeRequest>(TITLE, `${base}/merge_requests`, auth, request, timeoutMs, fetchImpl))
    },

    async state(number): Promise<PullState> {
      const request = await get<GitlabMergeRequest>(`/merge_requests/${number}`)
      // `locked` — the merge is going on.
      const state = request.state === 'merged' ? 'merged' : request.state === 'closed' ? 'closed' : 'open'
      const status = request.detailed_merge_status ?? request.merge_status ?? ''
      const mergeable = request.has_conflicts === true || status === 'conflict' ? false : UNCHECKED.has(status) ? null : true
      return { state, mergeable, head: request.sha }
    },

    async remarks(number, since, wanted) {
      const after = Date.parse(since)
      // An approval, a request for changes and the like are system notes: what the reviewer asks is in their own notes.
      const notes = (await discussions(number))
        .flatMap((discussion) => discussion.notes)
        .filter(
          (note) =>
            !note.system &&
            note.author?.bot !== true &&
            !TOKEN_BOT.test(note.author?.username ?? '') &&
            note.body.trim() !== '' &&
            Date.parse(note.created_at) >= after &&
            wanted(`note:${note.id}`, note.created_at),
        )
      const trusted = await trustedBy(number)
      const remarks: Remark[] = []
      for (const note of notes) {
        if (!(await trusted(note))) continue
        const author = note.author?.username ?? ''
        const at = note.created_at
        const place = note.type === 'DiffNote' ? note.position : undefined
        remarks.push(
          place === undefined
            ? { key: `note:${note.id}`, kind: 'comment', author, body: note.body, at, comments: [] }
            : {
                key: `note:${note.id}`,
                kind: 'review',
                author,
                body: '',
                at,
                comments: [{ path: place.new_path ?? place.old_path ?? '', line: place.new_line ?? place.old_line ?? null, body: note.body }],
              },
        )
      }
      return byTime(remarks)
    },
  }
}
