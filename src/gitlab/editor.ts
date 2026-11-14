import { randomUUID } from 'node:crypto'
import { sameName } from '../chain/rules.js'
import { markerComment, withMarker } from '../tracker/markers.js'
import { descriptionEdits, EditRefused, withFileLinks, type TaskEditor, type TaskLink, type TaskUpload } from '../tracker/editor.js'
import type { LabelChange } from '../tracker/labels.js'
import { parseTaskId, type TaskPriority, type TrackerTask } from '../tracker/model.js'
import { GitlabHttpError } from './api.js'
import { GITLAB_STATUSES, gitlabEstimate, gitlabPriority, gitlabStatus, type GitlabIssue, type GitlabLink, type GitlabMilestone, type GitlabRef, type ProjectMap } from './model.js'

export interface GitlabEditorDeps {
  rest<T>(path: string, method?: string, body?: unknown): Promise<T>
  /** The `data` of a GraphQL answer; an error of the answer throws. */
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>
  projects: ProjectMap
  /** Every issue of the project, open and closed. */
  list(project: string): Promise<TrackerTask[]>
  /** The issue's parent work item, `null` where the instance has no hierarchy. */
  parentOf(path: string, iid: number): Promise<GitlabRef | null>
  labelsOf(path: string): Promise<{ name: string }[]>
  /** The active milestones of the project and of its groups. */
  milestonesOf(path: string): Promise<GitlabMilestone[]>
  linksOf(path: string, iid: number): Promise<GitlabLink[]>
  relabel(id: string, change: LabelChange): Promise<string[]>
  comment(id: string, body: string): Promise<string>
  /** Uploads a file into the project; GitLab answers with the Markdown that links it. */
  upload(path: string, file: TaskUpload): Promise<{ markdown: string }>
}

const SET_PARENT = `mutation($id: WorkItemID!, $parent: WorkItemID) {
  workItemUpdate(input: { id: $id, hierarchyWidget: { parentId: $parent } }) { errors }
}`

const LINK_TYPES: Record<TaskLink, GitlabLink['link_type']> = { blocks: 'blocks', blockedBy: 'is_blocked_by', relates: 'relates_to' }
/** The type of a link read from its other end. */
const TURNED: Partial<Record<GitlabLink['link_type'], GitlabLink['link_type']>> = { blocks: 'is_blocked_by', is_blocked_by: 'blocks' }
const MARKER_LIMIT = 25
const NO_BLOCKING = 'this GitLab keeps no blocking links (GitLab Free; they need Premium or Ultimate); name the order in the description, or link the tasks as "relates", which the chain does not read as an order'

/** An issue's work item: GitLab gives an issue and its work item the same id. */
const workItem = (issue: Pick<GitlabIssue, 'id'>) => `gid://gitlab/WorkItem/${issue.id}`

/**
 * GitLab's writes for the tasks MCP server (BTN-875). A status is the issue's state, a priority the project's label
 * `priority::<level>` (or `priority: <level>`), a milestone an active one of the project or its groups, the parent the
 * work item hierarchy (an issue takes tasks as children: a new task under an issue is made of the task type), a link
 * an issue link. GitLab keeps one link per pair of issues, and blocking links only on Premium and Ultimate. An issue's
 * `updated_at` grows with any field, so the description's revision is a hash.
 */
export function gitlabEditor(deps: GitlabEditorDeps): TaskEditor {
  const { rest, projects } = deps

  const projectBase = (path: string) => `/projects/${encodeURIComponent(path)}`
  const addressOf = (id: string) => {
    const parsed = parseTaskId(id)
    const path = parsed === null ? undefined : projects.pathOfKey(parsed.project)
    if (parsed === null || path === undefined) throw new EditRefused(`${id} is not a task of a GitLab project these tools serve`)
    return { path, iid: parsed.number, base: `${projectBase(path)}/issues/${parsed.number}` }
  }
  const issueOf = (id: string) => rest<GitlabIssue>(addressOf(id).base)
  const update = async (id: string, fields: Record<string, unknown>): Promise<true> => {
    await rest(addressOf(id).base, 'PUT', fields)
    return true
  }
  const statusOf = (name: string) => {
    const found = GITLAB_STATUSES.find((each) => sameName(each.name, name))
    if (found === undefined) throw new EditRefused(`there is no status "${name}"; the statuses are ${GITLAB_STATUSES.map((each) => each.name).join(', ')}`)
    return found
  }
  const setStatus = async (id: string, issue: Pick<GitlabIssue, 'state'>, name: string): Promise<boolean> => {
    const target = statusOf(name)
    if (gitlabStatus(issue.state).name === target.name) return false
    return update(id, { state_event: target.category === 'Won' ? 'close' : 'reopen' })
  }
  const priorityLabel = async (path: string, level: TaskPriority): Promise<string> => {
    const found = (await deps.labelsOf(path)).find((each) => gitlabPriority([each.name]) === level)
    if (found === undefined) throw new EditRefused(`GitLab keeps a priority as the label "priority::${level}", and ${path} has none; only the user makes a new label`)
    return found.name
  }
  const milestoneId = async (path: string, title: string): Promise<number> => {
    const found = (await deps.milestonesOf(path)).find((each) => sameName(each.title, title))
    if (found === undefined) throw new EditRefused(`there is no active milestone "${title}" in ${path} or its groups`)
    return found.id
  }
  const setParent = async (child: GitlabIssue, childId: string, parent: GitlabIssue | null, parentId: string | null): Promise<void> => {
    const data = await deps.graphql<{ workItemUpdate: { errors: string[] } | null }>(SET_PARENT, { id: workItem(child), parent: parent === null ? null : workItem(parent) })
    const errors = data.workItemUpdate?.errors ?? []
    if (errors.length > 0) {
      const what = parentId === null ? `to take ${childId} from its parent` : `to put ${childId} under ${parentId}`
      throw new EditRefused(`GitLab refused ${what}: ${errors.join('; ')}`)
    }
  }
  const setEstimate = async (id: string, minutes: number): Promise<true> => {
    await rest(`${addressOf(id).base}/time_estimate`, 'POST', { duration: `${minutes}m` })
    return true
  }
  const sameTask = (link: GitlabLink, other: string) => projects.idOf(link).toUpperCase() === other.toUpperCase()

  // CE says so in its metadata; an EE instance without the license is known only by its first refused blocking link.
  let edition: Promise<boolean> | undefined
  let refused = false
  const blockingLinks = async (): Promise<boolean> => {
    if (refused) return false
    edition ??= rest<{ enterprise?: boolean }>('/metadata').then(
      (answer) => answer.enterprise !== false,
      () => {
        edition = undefined
        return true
      },
    )
    return edition
  }
  const noBlocking = () => {
    refused = true
    return new EditRefused(NO_BLOCKING)
  }

  return {
    list: (project) => deps.list(project),
    priorities: (labels) => labels.some((each) => gitlabPriority([each]) !== 'none'),
    blockingLinks,
    async create(project, draft, _notes, marker) {
      const path = projects.pathOf(project)
      const key = projects.keyOf(project)
      if (path === undefined || key === undefined) throw new EditRefused(`project ${project} has no GitLab path`)
      const status = draft.status === null ? null : statusOf(draft.status)
      const parent = draft.parent === null ? null : await issueOf(draft.parent)
      const [priority, milestone] = await Promise.all([
        draft.priority === null || draft.priority === 'none' ? null : priorityLabel(path, draft.priority),
        draft.milestone === null ? null : milestoneId(path, draft.milestone),
      ])
      const created = await rest<GitlabIssue>(`${projectBase(path)}/issues`, 'POST', {
        title: draft.title,
        description: withMarker(draft.description, marker),
        // An issue takes only tasks as children.
        ...(parent?.issue_type === 'issue' ? { issue_type: 'task' } : {}),
        ...(milestone === null ? {} : { milestone_id: milestone }),
      })
      const id = `${key}-${created.iid}`
      try {
        const labels = [...draft.labels, ...(priority === null ? [] : [priority])]
        if (labels.length > 0) await deps.relabel(id, { add: labels, remove: [] })
        if (parent !== null) await setParent(created, id, parent, draft.parent)
        if (status !== null) await setStatus(id, { state: 'opened' }, status.name)
        // A new issue takes no estimate: it is set through its own call.
        if (draft.estimate != null) await setEstimate(id, draft.estimate)
      } catch (error) {
        throw new EditRefused(`${id} was created, but ${error instanceof Error ? error.message : String(error)}; do not create it again`)
      }
      return id
    },
    markers: {
      make: () => randomUUID(),
      async find(project, marker, limit = MARKER_LIMIT) {
        const path = projects.pathOf(project)
        const key = projects.keyOf(project)
        if (path === undefined || key === undefined) throw new EditRefused(`project ${project} has no GitLab path`)
        const issues = await rest<Pick<GitlabIssue, 'iid' | 'description'>[]>(
          `${projectBase(path)}/issues?state=all&scope=all&order_by=created_at&sort=desc&per_page=${limit}`,
        )
        const found = issues.find((each) => each.description?.includes(markerComment(marker)))
        return found === undefined ? null : `${key}-${found.iid}`
      },
    },
    async set(id, field) {
      const issue = await issueOf(id)
      const { path, iid } = addressOf(id)
      switch (field.field) {
        case 'title':
          return issue.title === field.to ? false : update(id, { title: field.to })
        case 'status':
          return setStatus(id, issue, field.to)
        case 'priority': {
          if (gitlabPriority(issue.labels) === field.to) return false
          const add = field.to === 'none' ? [] : [await priorityLabel(path, field.to)]
          await deps.relabel(id, { add, remove: issue.labels.filter((each) => gitlabPriority([each]) !== 'none') })
          return true
        }
        case 'milestone': {
          if (field.to === null) return issue.milestone === null ? false : update(id, { milestone_id: 0 })
          if (issue.milestone !== null && sameName(issue.milestone.title, field.to)) return false
          return update(id, { milestone_id: await milestoneId(path, field.to) })
        }
        case 'parent': {
          const current = await deps.parentOf(path, iid)
          const currentId = current === null ? null : projects.idOf(current)
          if (currentId?.toUpperCase() === field.to?.toUpperCase() || (currentId === null && field.to === null)) return false
          const parent = field.to === null ? null : await issueOf(field.to)
          if (parent !== null && parent.id === issue.id) throw new EditRefused(`${id} cannot be its own parent`)
          await setParent(issue, id, parent, field.to)
          return true
        }
        case 'component':
          throw new EditRefused('GitLab has no components; name the area with a label such as component::ui')
      }
    },
    estimate: async (id, minutes) => (gitlabEstimate(await issueOf(id)) === minutes ? false : setEstimate(id, minutes)),
    ...descriptionEdits({
      read: async (id) => (await issueOf(id)).description ?? '',
      write: async (id, text) => void (await update(id, { description: text })),
    }),
    async link(id, other, link, on) {
      if (id.toUpperCase() === other.toUpperCase()) throw new EditRefused(`${id} cannot be linked to itself`)
      const own = addressOf(id)
      const target = addressOf(other)
      const type = LINK_TYPES[link]
      if (on && link !== 'relates' && !(await blockingLinks())) throw noBlocking()
      const links = (await deps.linksOf(own.path, own.iid)).filter((each) => sameTask(each, other))
      const found = links.filter((each) => each.link_type === type)
      if ((found.length > 0) === on) return
      if (!on) {
        for (const each of found) await rest(`${own.base}/links/${each.issue_link_id}`, 'DELETE')
        return
      }
      if (links.length > 0) {
        throw new EditRefused(`${id} and ${other} are linked already as "${links[0]!.link_type}"; GitLab keeps one link per pair: remove that one first`)
      }
      let made: { link_type?: string }
      try {
        made = await rest(`${own.base}/links`, 'POST', { target_project_id: target.path, target_issue_iid: target.iid, link_type: type })
      } catch (error) {
        // GitLab CE answers a blocking link with a bare 400 (BTN-927).
        if (error instanceof GitlabHttpError && error.status === 400 && link !== 'relates') throw noBlocking()
        throw error
      }
      if (made.link_type === undefined || made.link_type === type) return
      // GitLab answers "is_blocked_by" as the same link seen from the other side: "blocks" with source and target swapped (BTN-1164).
      if (link !== 'relates' && made.link_type === TURNED[type]) return
      // An instance that makes a "relates" link instead: take it back.
      for (const each of (await deps.linksOf(own.path, own.iid)).filter((each) => sameTask(each, other))) {
        await rest(`${own.base}/links/${each.issue_link_id}`, 'DELETE')
      }
      throw noBlocking()
    },
    relabel: (id, change) => deps.relabel(id, change),
    // A GitLab note has no field for the session's model: its author is the token's user.
    comment: (id, body) => deps.comment(id, body),
    // An upload belongs to the project, not the issue: the issue keeps it as a link in its description or a note.
    files: {
      async attach(id, files) {
        const links = await linksOf(id, files)
        const issue = await issueOf(id)
        await update(id, { description: withFileLinks(issue.description ?? '', links) })
      },
      comment: async (id, body, files) => deps.comment(id, withFileLinks(body, await linksOf(id, files))),
    },
  }

  async function linksOf(id: string, files: readonly TaskUpload[]): Promise<string> {
    const { path } = addressOf(id)
    const lines: string[] = []
    for (const file of files) lines.push((await deps.upload(path, file)).markdown)
    return lines.join('\n')
  }
}
