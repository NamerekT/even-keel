import { randomUUID } from 'node:crypto'
import { sameName } from '../chain/rules.js'
import { markerComment, withMarker } from '../tracker/markers.js'
import type { Repo, RepoMap } from '../github/model.js'
import { descriptionEdits, EditRefused, type TaskEditor, type TaskUpload } from '../tracker/editor.js'
import type { LabelChange } from '../tracker/labels.js'
import { parseTaskId, type TaskPriority, type TrackerTask } from '../tracker/model.js'
import { TrackerNotFound } from '../tracker/source.js'
import { FORGEJO_STATUSES, forgejoPriority, forgejoStatus, idOf, labelNames, type ForgejoIssue, type ForgejoLabel, type ForgejoMilestone } from './model.js'

export interface ForgejoEditorDeps {
  rest<T>(path: string, method?: string, body?: unknown): Promise<T>
  repos: RepoMap
  /** Every issue of the project's repository, open and closed. */
  list(project: string): Promise<TrackerTask[]>
  labelsOf(repo: Repo): Promise<ForgejoLabel[]>
  /** The repository's open milestones. */
  milestonesOf(repo: Repo): Promise<ForgejoMilestone[]>
  /** The issues that block one; `null` — the repository has dependencies turned off. */
  blockersOf(repo: Repo, number: number): Promise<ForgejoIssue[] | null>
  relabel(id: string, change: LabelChange): Promise<string[]>
  comment(id: string, body: string): Promise<string>
  /** Uploads a file as an asset of the issue or the comment `path` names (`…/assets`). */
  upload(path: string, file: TaskUpload): Promise<void>
}

const NO_PARENT = 'Forgejo has no subtasks; name the parent in the description instead'
const MARKER_LIMIT = 25

/**
 * Forgejo's writes for the tasks MCP server (BTN-875), over the Gitea API. A status is the issue's state, a priority
 * the repository's label `priority/<level>` (or `priority: <level>`, `priority::<level>`), a milestone an open one of
 * the repository, `blocks` a native dependency, kept on the blocked issue. Forgejo has no subtasks and no "relates"
 * link, and an issue's `updated_at` grows with any field, so the description's revision is a hash.
 */
export function forgejoEditor(deps: ForgejoEditorDeps): TaskEditor {
  const { rest, repos } = deps

  const addressOf = (id: string) => {
    const parsed = parseTaskId(id)
    const repo = parsed === null ? undefined : repos.repoOfKey(parsed.project)
    if (parsed === null || repo === undefined) throw new EditRefused(`${id} is not a task of a Forgejo project these tools serve`)
    return { repo, number: parsed.number, base: `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues/${parsed.number}` }
  }
  const issueOf = async (id: string): Promise<ForgejoIssue> => {
    const issue = await rest<ForgejoIssue>(addressOf(id).base)
    if (issue.pull_request != null) throw new TrackerNotFound(`forgejo: ${id} is a pull request, not an issue`)
    return issue
  }
  const update = async (id: string, fields: Record<string, unknown>): Promise<true> => {
    await rest(addressOf(id).base, 'PATCH', fields)
    return true
  }
  const statusOf = (name: string) => {
    const found = FORGEJO_STATUSES.find((each) => sameName(each.name, name))
    if (found === undefined) throw new EditRefused(`there is no status "${name}"; the statuses are ${FORGEJO_STATUSES.map((each) => each.name).join(', ')}`)
    return found
  }
  const setStatus = async (id: string, issue: Pick<ForgejoIssue, 'state'>, name: string): Promise<boolean> => {
    const target = statusOf(name)
    if (forgejoStatus(issue.state).name === target.name) return false
    return update(id, { state: target.category === 'Won' ? 'closed' : 'open' })
  }
  const slug = (repo: Repo) => `${repo.owner}/${repo.name}`
  const priorityLabel = async (repo: Repo, level: TaskPriority): Promise<string> => {
    const found = (await deps.labelsOf(repo)).find((each) => forgejoPriority([each.name]) === level)
    if (found === undefined) throw new EditRefused(`Forgejo keeps a priority as a label such as "priority/${level}", and ${slug(repo)} has none; only the user makes a new label`)
    return found.name
  }
  const milestoneId = async (repo: Repo, title: string): Promise<number> => {
    const found = (await deps.milestonesOf(repo)).find((each) => sameName(each.title, title))
    if (found === undefined) throw new EditRefused(`there is no open milestone "${title}" in ${slug(repo)}`)
    return found.id
  }

  return {
    list: (project) => deps.list(project),
    priorities: (labels) => labels.some((each) => forgejoPriority([each]) !== 'none'),
    async create(project, draft, _notes, marker) {
      const repo = repos.repoOf(project)
      const key = repos.projectKey(project)
      if (repo === undefined || key === undefined) throw new EditRefused(`project ${project} has no Forgejo repository`)
      if (draft.parent !== null) throw new EditRefused(NO_PARENT)
      const status = draft.status === null ? null : statusOf(draft.status)
      const [priority, milestone] = await Promise.all([
        draft.priority === null || draft.priority === 'none' ? null : priorityLabel(repo, draft.priority),
        draft.milestone === null ? null : milestoneId(repo, draft.milestone),
      ])
      const created = await rest<ForgejoIssue>(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues`, 'POST', {
        title: draft.title,
        body: withMarker(draft.description, marker),
        ...(milestone === null ? {} : { milestone }),
      })
      const id = `${key}-${created.number}`
      try {
        const labels = [...draft.labels, ...(priority === null ? [] : [priority])]
        if (labels.length > 0) await deps.relabel(id, { add: labels, remove: [] })
        if (status !== null) await setStatus(id, { state: 'open' }, status.name)
      } catch (error) {
        throw new EditRefused(`${id} was created, but ${error instanceof Error ? error.message : String(error)}; do not create it again`)
      }
      return id
    },
    markers: {
      make: () => randomUUID(),
      async find(project, marker, limit = MARKER_LIMIT) {
        const repo = repos.repoOf(project)
        const key = repos.projectKey(project)
        if (repo === undefined || key === undefined) throw new EditRefused(`project ${project} has no Forgejo repository`)
        const issues = await rest<Pick<ForgejoIssue, 'number' | 'body' | 'pull_request'>[]>(
          `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues?state=all&type=issues&sort=latest&limit=${limit}`,
        )
        const found = issues.find((each) => each.pull_request == null && each.body?.includes(markerComment(marker)))
        return found === undefined ? null : `${key}-${found.number}`
      },
    },
    async set(id, field) {
      const issue = await issueOf(id)
      const { repo } = addressOf(id)
      switch (field.field) {
        case 'title':
          return issue.title === field.to ? false : update(id, { title: field.to })
        case 'status':
          return setStatus(id, issue, field.to)
        case 'priority': {
          const labels = labelNames(issue)
          if (forgejoPriority(labels) === field.to) return false
          const add = field.to === 'none' ? [] : [await priorityLabel(repo, field.to)]
          await deps.relabel(id, { add, remove: labels.filter((each) => forgejoPriority([each]) !== 'none') })
          return true
        }
        case 'milestone': {
          // Forgejo takes milestone 0 for none.
          if (field.to === null) return issue.milestone === null ? false : update(id, { milestone: 0 })
          if (issue.milestone !== null && sameName(issue.milestone.title, field.to)) return false
          return update(id, { milestone: await milestoneId(repo, field.to) })
        }
        case 'parent':
          if (field.to === null) return false
          throw new EditRefused(NO_PARENT)
        case 'component':
          throw new EditRefused('Forgejo has no components')
      }
    },
    ...descriptionEdits({
      read: async (id) => (await issueOf(id)).body ?? '',
      write: async (id, text) => void (await update(id, { body: text })),
    }),
    async link(id, other, link, on) {
      if (link === 'relates') throw new EditRefused('Forgejo has no "relates" link; name the other task in the description or a comment')
      if (id.toUpperCase() === other.toUpperCase()) throw new EditRefused(`${id} cannot be linked to itself`)
      const [blocker, blocked] = link === 'blocks' ? [id, other] : [other, id]
      const from = addressOf(blocker)
      const to = addressOf(blocked)
      await issueOf(blocked)
      const blockers = await deps.blockersOf(to.repo, to.number)
      if (blockers === null) throw new EditRefused(`${slug(to.repo)} has dependencies turned off; name the order in the description or a comment`)
      if (blockers.some((each) => idOf(repos, each).toUpperCase() === blocker.toUpperCase()) === on) return
      await rest(`${to.base}/dependencies`, on ? 'POST' : 'DELETE', { owner: from.repo.owner, repo: from.repo.name, index: from.number })
    },
    relabel: (id, change) => deps.relabel(id, change),
    // A Forgejo comment has no field for the session's model: its author is the token's account.
    comment: (id, body) => deps.comment(id, body),
    // Assets of the issue, and of the comment once it is posted.
    files: {
      async attach(id, files) {
        const { base } = addressOf(id)
        for (const file of files) await deps.upload(`${base}/assets`, file)
      },
      async comment(id, body, files) {
        const { base } = addressOf(id)
        const posted = await deps.comment(id, body)
        const comments = base.replace(/\/\d+$/, `/comments/${encodeURIComponent(posted)}/assets`)
        for (const file of files) await deps.upload(comments, file)
        return posted
      },
    },
  }
}
