import { sameName } from '../chain/rules.js'
import { descriptionEdits, EditRefused, type TaskEditor } from '../tracker/editor.js'
import type { LabelChange } from '../tracker/labels.js'
import { parseTaskId, type TaskPriority, type TrackerTask } from '../tracker/model.js'
import { adfToMarkdown, markdownToAdf } from './adf.js'
import { BLOCKS, priorityFor, type JiraIssue, type JiraLink, type JiraVersion } from './model.js'

export interface JiraIssueType {
  id: string
  name: string
  untranslatedName?: string | null
  subtask?: boolean
  hierarchyLevel?: number
}

interface Transition {
  id: string
  to: { name: string }
}

export interface JiraEditorDeps {
  rest<T>(path: string, method?: string, body?: unknown): Promise<T>
  /** The Jira project key of Even Keel's project. */
  keyOf(project: string): string
  /** Every issue of Even Keel's project, whatever its status. */
  list(project: string): Promise<TrackerTask[]>
  priorities(): Promise<{ id: string; name: string }[]>
  versionsOf(key: string): Promise<JiraVersion[]>
  /** The issue types a new issue of the project may take. */
  issueTypes(key: string): Promise<JiraIssueType[]>
  /** The names of the site's link types. */
  linkTypes: readonly string[]
  relabel(id: string, change: LabelChange): Promise<string[]>
  comment(id: string, body: string): Promise<string>
}

const FIELDS = ['summary', 'status', 'priority', 'fixVersions', 'parent', 'issuelinks', 'issuetype', 'description']
const RELATES = 'Relates'

/**
 * Jira's writes for the tasks MCP server (BTN-875). A status moves only through a transition of the issue's workflow;
 * a milestone is a fix version, set as the issue's only one; a link is an issue link of the site's `Blocks` or
 * `Relates` type; a parent is an epic over a standard issue, or a standard issue over a new sub-task. Every issue keeps
 * a priority, so none cannot be set. The description is ADF: it is read and written through Markdown (`adf.ts`), and
 * the revision is a hash of that Markdown.
 */
export function jiraEditor(deps: JiraEditorDeps): TaskEditor {
  const { rest } = deps
  const path = (id: string): string => {
    if (parseTaskId(id) === null) throw new EditRefused(`"${id}" is not a task key such as ABC-12`)
    return `/issue/${encodeURIComponent(id)}`
  }
  const issueOf = (id: string) => rest<JiraIssue>(`${path(id)}?fields=${FIELDS.join(',')}`)
  const update = async (id: string, fields: Record<string, unknown>): Promise<true> => {
    await rest(path(id), 'PUT', { fields })
    return true
  }
  const priorityOf = async (level: TaskPriority) => {
    if (level === 'none') throw new EditRefused('Jira keeps a priority on every issue; set another level instead of none')
    const found = priorityFor(level, await deps.priorities())
    if (found === undefined) throw new EditRefused(`the site has no priority for "${level}"`)
    return found
  }
  const versionOf = async (key: string, name: string): Promise<JiraVersion> => {
    const found = (await deps.versionsOf(key)).find((each) => sameName(each.name, name))
    if (found === undefined) throw new EditRefused(`there is no version "${name}" in ${key}`)
    return found
  }
  const moveTo = async (issue: JiraIssue, name: string): Promise<boolean> => {
    if (sameName(issue.fields.status.name, name)) return false
    const { transitions } = await rest<{ transitions: Transition[] }>(`${path(issue.key)}/transitions`)
    const found = transitions.find((each) => sameName(each.to.name, name))
    if (found === undefined) {
      const reachable = [...new Set(transitions.map((each) => each.to.name))]
      throw new EditRefused(`${issue.key}: its workflow has no transition from ${issue.fields.status.name} to "${name}"; from here it goes to ${reachable.join(', ') || 'nothing'}`)
    }
    await rest(`${path(issue.key)}/transitions`, 'POST', { transition: { id: found.id } })
    return true
  }
  /** The issue type of a new issue: a standard one, or a sub-task under a standard parent. */
  const typeOf = async (key: string, parent: JiraIssue | null): Promise<JiraIssueType> => {
    const types = await deps.issueTypes(key)
    const level = parent?.fields.issuetype?.hierarchyLevel ?? 1
    if (parent !== null && (parent.fields.issuetype?.subtask === true || level < 0)) throw new EditRefused(`${parent.key} is a sub-task; a sub-task has no children in Jira`)
    if (level === 0) {
      const subtask = types.find((each) => each.subtask === true)
      if (subtask === undefined) throw new EditRefused(`${key} has no sub-task type to put a task under ${parent!.key}`)
      return subtask
    }
    const standard = types.filter((each) => each.subtask !== true && each.hierarchyLevel === 0)
    const found = standard.find((each) => sameName(each.untranslatedName ?? each.name, 'Task')) ?? standard[0]
    if (found === undefined) throw new EditRefused(`${key} has no issue type to create a task with`)
    return found
  }
  const linkType = (name: string): string => {
    const found = deps.linkTypes.find((each) => sameName(each, name))
    if (found === undefined) throw new EditRefused(`the site has no "${name}" link type; the types are ${deps.linkTypes.join(', ')}`)
    return found
  }

  return {
    list: (project) => deps.list(project),
    async create(project, draft) {
      const key = deps.keyOf(project)
      const parent = draft.parent === null ? null : await issueOf(draft.parent)
      if (parent !== null && parseTaskId(parent.key)?.project !== key) throw new EditRefused(`the parent ${parent.key} is of another project`)
      const [type, priority, version] = await Promise.all([
        typeOf(key, parent),
        draft.priority === null || draft.priority === 'none' ? null : priorityOf(draft.priority),
        draft.milestone === null ? null : versionOf(key, draft.milestone),
      ])
      const fields = {
        project: { key },
        issuetype: { id: type.id },
        summary: draft.title,
        description: markdownToAdf(draft.description),
        ...(priority === null ? {} : { priority: { id: priority.id } }),
        ...(version === null ? {} : { fixVersions: [{ id: version.id }] }),
        ...(draft.labels.length === 0 ? {} : { labels: draft.labels }),
        ...(parent === null ? {} : { parent: { key: parent.key } }),
      }
      const created = await rest<{ key: string }>('/issue', 'POST', { fields })
      if (draft.status !== null) {
        try {
          await moveTo(await issueOf(created.key), draft.status)
        } catch (error) {
          throw new EditRefused(`${created.key} was created, but ${error instanceof Error ? error.message : String(error)}; do not create it again`)
        }
      }
      return created.key
    },
    async set(id, field) {
      const issue = await issueOf(id)
      switch (field.field) {
        case 'title':
          return issue.fields.summary === field.to ? false : update(id, { summary: field.to })
        case 'status':
          return moveTo(issue, field.to)
        case 'priority': {
          const priority = await priorityOf(field.to)
          return issue.fields.priority?.id === priority.id ? false : update(id, { priority: { id: priority.id } })
        }
        case 'milestone': {
          const versions = issue.fields.fixVersions ?? []
          if (field.to === null) return versions.length === 0 ? false : update(id, { fixVersions: [] })
          const version = await versionOf(parseTaskId(issue.key)!.project, field.to)
          return versions.length === 1 && versions[0]!.id === version.id ? false : update(id, { fixVersions: [{ id: version.id }] })
        }
        case 'parent': {
          const current = issue.fields.parent?.key ?? null
          if (current?.toUpperCase() === field.to?.toUpperCase() || (current === null && field.to === null)) return false
          return update(id, { parent: field.to === null ? null : { key: field.to } })
        }
        case 'component':
          throw new EditRefused('these tools set no Jira component yet')
      }
    },
    ...descriptionEdits({
      read: async (id) => adfToMarkdown((await rest<JiraIssue>(`${path(id)}?fields=description`)).fields.description),
      write: async (id, text) => void (await update(id, { description: markdownToAdf(text) })),
    }),
    async link(id, other, link, on) {
      if (id.toUpperCase() === other.toUpperCase()) throw new EditRefused(`${id} cannot be linked to itself`)
      const type = linkType(link === 'relates' ? RELATES : BLOCKS)
      const issue = await issueOf(id)
      const same = (ref: { key: string } | undefined) => ref?.key.toUpperCase() === other.toUpperCase()
      // On this issue's side a link names the other issue: inward for "is blocked by", outward for "blocks".
      const found = (issue.fields.issuelinks ?? []).filter((each: JiraLink) => {
        if (!sameName(each.type.name, type)) return false
        if (link === 'relates') return same(each.inwardIssue) || same(each.outwardIssue)
        return link === 'blocks' ? same(each.outwardIssue) : same(each.inwardIssue)
      })
      if ((found.length > 0) === on) return
      if (!on) {
        for (const each of found) await rest(`/issueLink/${encodeURIComponent(each.id!)}`, 'DELETE')
        return
      }
      const [blocker, blocked] = link === 'blockedBy' ? [other, issue.key] : [issue.key, other]
      await rest('/issueLink', 'POST', { type: { name: type }, outwardIssue: { key: blocker }, inwardIssue: { key: blocked } })
    },
    relabel: (id, change) => deps.relabel(id, change),
    // A Jira comment has no field for the session's model: its author is the profile's account.
    comment: (id, body) => deps.comment(id, body),
  }
}
