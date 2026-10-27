import { sameName } from '../chain/rules.js'
import { fail } from '../notice/notice.js'
import { commentsAfterId } from '../tracker/comments.js'
import { parseTaskId, type TaskStatus, type TrackerTask } from '../tracker/model.js'
import { TrackerNotFound, type TaskSource, type TrackerPlace } from '../tracker/source.js'
import { adfToMarkdown, markdownToAdf } from './adf.js'
import { JiraApi } from './api.js'
import {
  BLOCKS,
  CARD_FIELDS,
  earliestVersion,
  hasChildIssues,
  jiraStatus,
  priorityFor,
  TASK_FIELDS,
  toCard,
  toTrackerTask,
  type JiraAttachment,
  type JiraComment,
  type JiraIssue,
  type JiraRef,
  type JiraStatus,
  type JiraVersion,
} from './model.js'

export interface JiraSettings {
  /** The profile's values: `JIRA_URL`, `JIRA_EMAIL`, `JIRA_TOKEN`. */
  values: Readonly<Record<string, string | undefined>>
  /** The place of each project by its id: the key is the Jira project's key. */
  projects: Readonly<Record<string, TrackerPlace>>
}

interface Transition {
  id: string
  name: string
  to: JiraStatus
}

interface Priority {
  id: string
  name: string
}

const PAGE = 100
/** Keys per `parent in (…)` query: a long JQL is refused. */
const PARENTS_CHUNK = 50

export async function connectJira(settings: JiraSettings, timeoutMs: number, fetchImpl: typeof fetch = fetch, log: (line: string) => void = console.log): Promise<TaskSource> {
  const { api } = await JiraApi.open(settings.values, timeoutMs, fetchImpl)

  const { issueLinkTypes } = await api.rest<{ issueLinkTypes: { name: string }[] }>('/issueLinkType')
  if (!issueLinkTypes.some((type) => sameName(type.name, BLOCKS))) throw fail('jira.blocksType', { types: issueLinkTypes.map((type) => type.name).join(', ') })

  let priorities: Promise<Priority[]> | null = null
  const prioritiesOf = () => {
    priorities ??= api.rest<{ values: Priority[] }>(`/priority/search?maxResults=${PAGE}`).then((page) => page.values).catch((error: unknown) => {
      priorities = null
      throw error
    })
    return priorities
  }
  const order = async () => (await prioritiesOf()).map((each) => each.name)

  const keyOf = (project: string): string => {
    const place = Object.hasOwn(settings.projects, project) ? settings.projects[project] : undefined
    if (place === undefined) throw new Error(`jira: project ${project} is not on this profile`)
    return place.key
  }
  const issuePath = (id: string): string => {
    if (parseTaskId(id) === null) throw new Error(`jira: ${id} is not a task id`)
    return `/issue/${id}`
  }

  async function search(jql: string, fields: readonly string[] = TASK_FIELDS): Promise<JiraIssue[]> {
    const issues: JiraIssue[] = []
    let nextPageToken: string | undefined
    do {
      const page: { issues: JiraIssue[]; nextPageToken?: string } = await api.rest('/search/jql', 'POST', { jql, fields, maxResults: PAGE, ...(nextPageToken === undefined ? {} : { nextPageToken }) })
      issues.push(...page.issues)
      nextPageToken = page.nextPageToken
    } while (nextPageToken !== undefined)
    return issues
  }

  /** Jira lists only sub-tasks on an issue: the children of an epic are the issues with it as their `parent`. */
  async function converted(issues: JiraIssue[], catalogs?: Map<string, Promise<JiraStatus[]>>): Promise<TrackerTask[]> {
    const names = await order()
    await resolveStatuses(issues, catalogs)
    const epics = issues.filter(hasChildIssues).map((issue) => issue.key)
    const children = new Map<string, number>()
    for (let at = 0; at < epics.length; at += PARENTS_CHUNK) {
      for (const child of await search(`parent in (${epics.slice(at, at + PARENTS_CHUNK).join(', ')})`, ['parent'])) {
        const parent = child.fields.parent?.key
        if (parent !== undefined) children.set(parent, (children.get(parent) ?? 0) + 1)
      }
    }
    return issues.map((issue) => toTrackerTask(issue, names, hasChildIssues(issue) ? (children.get(issue.key) ?? 0) : undefined))
  }

  async function statusesOf(key: string): Promise<JiraStatus[]> {
    const types = await api.rest<{ statuses: JiraStatus[] }[]>(`/project/${encodeURIComponent(key)}/statuses`)
    return [...new Map(types.flatMap((type) => type.statuses).map((status) => [status.id, status])).values()]
  }

  /** Issue responses omit untranslatedName; keep the display name and resolve the original by status id. */
  async function resolveStatuses(refs: readonly JiraRef[], catalogs = new Map<string, Promise<JiraStatus[]>>()): Promise<void> {
    for (const ref of refs) {
      const status = ref.fields.status
      if (status.untranslatedName != null) continue
      const key = parseTaskId(ref.key)!.project
      let catalog = catalogs.get(key)
      if (catalog === undefined) {
        catalog = statusesOf(key)
        catalogs.set(key, catalog)
      }
      const original = (await catalog).find((each) => each.id === status.id)
      status.untranslatedName = original?.untranslatedName ?? original?.name
    }
  }

  const versionsOf = (key: string) => api.rest<JiraVersion[]>(`/project/${encodeURIComponent(key)}/versions`)
  const openVersions = (versions: JiraVersion[]) => versions.filter((version) => version.released !== true && version.archived !== true)
  const issueOf = (id: string, fields: readonly string[]) => api.rest<JiraIssue>(`${issuePath(id)}?fields=${fields.join(',')}`)
  const transitionsOf = async (id: string) => (await api.rest<{ transitions: Transition[] }>(`${issuePath(id)}/transitions`)).transitions
  const transition = (id: string, to: Transition) => api.rest(`${issuePath(id)}/transitions`, 'POST', { transition: { id: to.id } })
  const setVersions = (id: string, versions: string[]) => api.rest(issuePath(id), 'PUT', { fields: { fixVersions: versions.map((version) => ({ id: version })) } })

  async function commentsOf(id: string, newestFirst = false, limit = Number.POSITIVE_INFINITY): Promise<JiraComment[]> {
    const comments: JiraComment[] = []
    for (let startAt = 0; comments.length < limit; ) {
      const page = await api.rest<{ comments: JiraComment[]; total: number }>(`${issuePath(id)}/comment?orderBy=${newestFirst ? '-created' : 'created'}&startAt=${startAt}&maxResults=${Math.min(PAGE, limit)}`)
      comments.push(...page.comments)
      startAt += page.comments.length
      if (page.comments.length === 0 || startAt >= page.total) break
    }
    return comments
  }

  async function ready(id: string): Promise<TaskStatus | null> {
    const { fields } = await issueOf(id, ['status'])
    const catalogs = new Map<string, Promise<JiraStatus[]>>()
    await resolveStatuses([{ key: id, fields }], catalogs)
    if (jiraStatus(fields.status).category !== 'UnStarted') return null
    const transitions = await transitionsOf(id)
    await resolveStatuses(transitions.map((each) => ({ key: id, fields: { summary: '', status: each.to } })), catalogs)
    const to = transitions.find((each) => jiraStatus(each.to).category === 'ToDo')
    if (to === undefined) throw new Error(`jira: ${id} has no transition from ${fields.status.name} to a ready status`)
    await transition(id, to)
    return jiraStatus(to.to)
  }

  return {
    async chainTasks(project, open) {
      const key = keyOf(project)
      const statuses = await statusesOf(key)
      const where = (wanted: boolean) => statuses.filter((status) => open(jiraStatus(status)) === wanted).map((status) => status.id)
      const opened = where(true)
      const issues = opened.length === 0 ? [] : await search(`project = "${key}" AND status in (${opened.join(', ')}) ORDER BY key`)
      const versions = [...new Set(issues.flatMap((issue) => (issue.fields.fixVersions ?? []).map((version) => version.id)))]
      const closed = where(false)
      const others = versions.length === 0 || closed.length === 0 ? [] : await search(`project = "${key}" AND status in (${closed.join(', ')}) AND fixVersion in (${versions.join(', ')}) ORDER BY key`)
      return { tasks: await converted([...issues, ...others], new Map([[key, Promise.resolve(statuses)]])), statuses: [...new Set(statuses.map((status) => status.name))] }
    },

    async tasks(ids) {
      const keys = [...new Set(ids.filter((id) => parseTaskId(id) !== null))]
      const issues: JiraIssue[] = []
      for (let at = 0; at < keys.length; at += PAGE) {
        // An id Jira no longer has is in `issueErrors`, not a failure of the call.
        const page = await api.rest<{ issues: JiraIssue[] }>('/issue/bulkfetch', 'POST', { issueIdsOrKeys: keys.slice(at, at + PAGE), fields: TASK_FIELDS })
        issues.push(...page.issues)
      }
      return converted(issues)
    },

    async brief(id) {
      const { fields } = await issueOf(id, ['summary', 'description'])
      return { title: fields.summary, description: adfToMarkdown(fields.description) }
    },

    async complete(id) {
      const { fields } = await issueOf(id, ['status'])
      if (jiraStatus(fields.status).category === 'Won') return false
      const to = (await transitionsOf(id)).find((each) => each.to.statusCategory.key === 'done')
      if (to === undefined) {
        log(`jira: ${id} is not closed: its workflow has no transition from ${fields.status.name} to a status of the Done category`)
        return false
      }
      await transition(id, to)
      return true
    },

    async children(id) {
      issuePath(id)
      return converted(await search(`parent = ${id} ORDER BY key`))
    },

    async card(id) {
      const [issue, comments] = await Promise.all([issueOf(id, CARD_FIELDS), commentsOf(id)])
      const links = issue.fields.issuelinks ?? []
      await resolveStatuses([issue, ...[issue.fields.parent, ...links.flatMap((link) => [link.inwardIssue, link.outwardIssue])].filter((ref): ref is JiraRef => ref != null)])
      return toCard(issue, comments, await order())
    },

    async file(id, file) {
      if (!/^\d+$/.test(file)) return null
      const { fields } = await issueOf(id, ['attachment'])
      const attachment = (fields.attachment ?? []).find((each) => each.id === file)
      if (attachment === undefined) return null
      let response: Response
      try {
        response = await api.request(`/rest/api/3/attachment/content/${file}?redirect=false`)
      } catch (error) {
        if (error instanceof TrackerNotFound) return null
        throw error
      }
      if (response.body === null) return null
      return { type: attachment.mimeType ?? response.headers.get('content-type') ?? '', size: attachment.size ?? null, body: response.body }
    },

    ready,

    async comment(id, body) {
      return (await api.rest<{ id: string }>(`${issuePath(id)}/comment`, 'POST', { body: markdownToAdf(body) })).id
    },

    async commentsAfter(id, after) {
      const comments = await commentsOf(id)
      const later = commentsAfterId(comments, after)
      const hasMedia = later.some((comment) => JSON.stringify(comment.body ?? {}).includes('"media'))
      const attachments: JiraAttachment[] = hasMedia ? ((await issueOf(id, ['attachment'])).fields.attachment ?? []) : []
      // A session gets a comment's files downloaded, so its text names them and links nowhere.
      return later.map((comment) => {
        const files = new Map<string, string>()
        const body = adfToMarkdown(comment.body, ({ alt }) => {
          const found = attachments.find((each) => each.filename === alt)
          if (found !== undefined) files.set(found.id, found.filename)
          return null
        })
        return { id: comment.id, body, files: [...files].map(([file, name]) => ({ name, file })) }
      })
    },

    // A new issue goes in at the workflow's first status; one that starts in the backlog is moved to the first ready one.
    async create(task) {
      const key = keyOf(task.project)
      const { issueTypes, values } = await api.rest<{ issueTypes?: IssueType[]; values?: IssueType[] }>(`/issue/createmeta/${encodeURIComponent(key)}/issuetypes`)
      const types = (issueTypes ?? values ?? []).filter((type) => type.subtask !== true && type.hierarchyLevel === 0)
      const type = types.find((each) => sameName(each.untranslatedName ?? each.name, 'Task')) ?? types[0]
      if (type === undefined) throw new Error(`jira: project ${key} has no issue type to create a task with`)
      const priority = priorityFor(task.priority, await prioritiesOf())
      const like = task.milestoneOf !== null && parseTaskId(task.milestoneOf)?.project === key ? earliestVersion((await issueOf(task.milestoneOf, ['fixVersions'])).fields.fixVersions) : null
      const fields = {
        project: { key },
        issuetype: { id: type.id },
        summary: task.title,
        description: markdownToAdf(task.description),
        ...(priority === undefined ? {} : { priority: { id: priority.id } }),
        ...(like === null ? {} : { fixVersions: [{ id: like.id }] }),
      }
      const created = await api.rest<{ key: string }>('/issue', 'POST', { fields })
      await ready(created.key)
      return created.key
    },

    // A version belongs to a project: a task of another project is left alone.
    async setMilestone(id, milestoneOf) {
      if (parseTaskId(id)?.project !== parseTaskId(milestoneOf)?.project) return false
      if ((await issueOf(id, ['fixVersions'])).fields.fixVersions?.length) return false
      const version = earliestVersion((await issueOf(milestoneOf, ['fixVersions'])).fields.fixVersions)
      if (version === null) return false
      await setVersions(id, [version.id])
      return true
    },

    async milestones(id) {
      const own = earliestVersion((await issueOf(id, ['fixVersions'])).fields.fixVersions)
      const choices = openVersions(await versionsOf(parseTaskId(id)!.project))
      if (own !== null && !choices.some((each) => each.id === own.id)) choices.push(own)
      return {
        current: own?.id ?? null,
        choices: choices.map((version) => ({ id: version.id, label: version.name, targetDate: version.releaseDate ? Date.parse(version.releaseDate) : null })),
      }
    },

    // Jira lets an issue be in several versions; a pick on the card leaves it in the one picked.
    async moveMilestone(id, milestone) {
      if (milestone !== null && !/^\d+$/.test(milestone)) throw new Error('jira: invalid version id')
      await setVersions(id, milestone === null ? [] : [milestone])
    },

    async milestoneTasks(project, milestone) {
      const key = keyOf(project)
      const version = (await versionsOf(key)).find((each) => each.name === milestone)
      if (version === undefined) return []
      const tasks = await converted(await search(`project = "${key}" AND fixVersion = ${version.id} ORDER BY key`))
      const result = []
      for (const task of tasks) {
        const [last] = await commentsOf(task.id, true, 1)
        result.push({ ...task, lastComment: last === undefined ? null : adfToMarkdown(last.body) })
      }
      return result
    },

    async vocabulary(project) {
      const key = keyOf(project)
      const statuses = await statusesOf(key)
      const labels: string[] = []
      for (let startAt = 0; ; ) {
        const page = await api.rest<{ values: string[]; isLast?: boolean }>(`/label?startAt=${startAt}&maxResults=1000`)
        labels.push(...page.values)
        startAt += page.values.length
        if (page.isLast !== false || page.values.length === 0) break
      }
      return {
        statuses: [...new Map(statuses.map((status) => [status.name, jiraStatus(status)])).values()],
        labels,
        milestones: openVersions(await versionsOf(key)).map((version) => version.name),
      }
    },

    close: async () => {},
  }
}

interface IssueType {
  id: string
  name: string
  untranslatedName?: string | null
  subtask?: boolean
  hierarchyLevel?: number
}
