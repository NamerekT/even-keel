import type { TaskAttachment, TaskRef, TrackerCard } from '../tracker/card.js'
import { PRIORITIES, type TaskPriority, type TaskStatus, type TrackerTask } from '../tracker/model.js'
import type { TrackerPlace } from '../tracker/source.js'
import { GitlabUploads } from './uploads.js'

export interface GitlabMilestone {
  id: number
  title: string
  due_date: string | null
  state: 'active' | 'closed'
}

export interface GitlabRef {
  iid: number
  title: string
  state: 'opened' | 'closed'
  web_url: string
}

export interface GitlabIssue extends GitlabRef {
  id: number
  project_id: number
  description: string | null
  labels: string[]
  milestone: GitlabMilestone | null
  /** `issue`, `task`, `incident`…; a task is the child type of an issue. */
  issue_type?: string
  /** The estimate in seconds; 0 — none. */
  time_stats?: { time_estimate?: number }
}

/** The time estimate in whole minutes; `null` — none. */
export function gitlabEstimate(issue: Pick<GitlabIssue, 'time_stats'>): number | null {
  const seconds = issue.time_stats?.time_estimate ?? 0
  return seconds > 0 ? Math.round(seconds / 60) : null
}

export interface GitlabLink extends GitlabRef {
  link_type: 'blocks' | 'is_blocked_by' | 'relates_to'
  issue_link_id?: number
}

export interface GitlabNote {
  id: number
  body: string
  created_at: string
  system: boolean
  author: { id: number; username: string } | null
}

export interface Hierarchy {
  parent: GitlabRef | null
  children: GitlabRef[]
}

export const EMPTY_HIERARCHY: Hierarchy = { parent: null, children: [] }
export const GITLAB_STATUSES: readonly TaskStatus[] = [{ name: 'Opened', category: 'ToDo' }, { name: 'Closed', category: 'Won' }]
export const gitlabStatus = (state: GitlabRef['state']): TaskStatus => GITLAB_STATUSES[state === 'closed' ? 1 : 0]!

export function gitlabPriority(labels: string[]): TaskPriority {
  const levels = labels.flatMap((label) => {
    const level = /^priority\s*(?:::|:)\s*(\w+)$/i.exec(label.trim())?.[1]?.toLowerCase()
    const index = (PRIORITIES as readonly string[]).indexOf(level ?? 'none')
    return index >= 0 ? [index] : []
  })
  return levels.length === 0 ? 'none' : PRIORITIES[Math.min(...levels)]!
}

export class ProjectMap {
  constructor(private readonly projects: Readonly<Record<string, TrackerPlace>>, readonly web: string) {}

  pathOf(id: string): string | undefined { return Object.hasOwn(this.projects, id) ? this.projects[id]!.value : undefined }
  pathOfKey(key: string): string | undefined { return Object.values(this.projects).find((project) => project.key === key)?.value }
  keyOf(id: string): string | undefined { return Object.hasOwn(this.projects, id) ? this.projects[id]!.key : undefined }

  idOf(ref: Pick<GitlabRef, 'iid' | 'web_url'>): string {
    const prefix = `${this.web}/`
    if (!ref.web_url.startsWith(prefix)) return ref.web_url
    const path = ref.web_url.slice(prefix.length).replace(/\/(?:-\/)?(?:issues|work_items)\/\d+\/?$/, '')
    const project = Object.values(this.projects).find((each) => each.value?.toLowerCase() === path.toLowerCase())
    return project === undefined ? `${path}#${ref.iid}` : `${project.key}-${ref.iid}`
  }
}

const milestoneOf = (milestone: GitlabMilestone | null) => milestone === null ? null : ({ label: milestone.title, targetDate: milestone.due_date === null ? null : Date.parse(milestone.due_date) })

export function toTrackerTask(issue: GitlabIssue, links: GitlabLink[], projects: ProjectMap, hierarchy: Hierarchy = EMPTY_HIERARCHY): TrackerTask {
  return {
    id: projects.idOf(issue), title: issue.title, status: gitlabStatus(issue.state),
    blockedBy: links.filter((link) => link.link_type === 'is_blocked_by').map((link) => projects.idOf(link)),
    parent: hierarchy.parent === null ? null : projects.idOf(hierarchy.parent), subtasks: hierarchy.children.length,
    milestone: milestoneOf(issue.milestone), priority: gitlabPriority(issue.labels), labels: issue.labels,
    estimate: (issue.time_stats?.time_estimate ?? 0) / 3600,
  }
}

/** `outsiders` — the ids of notes whose authors are not trusted (BTN-1122): the card marks them and the files only they carry. */
export function toCard(issue: GitlabIssue, links: GitlabLink[], notes: GitlabNote[], projects: ProjectMap, hierarchy: Hierarchy = EMPTY_HIERARCHY, outsiders: ReadonlySet<number> = new Set()): TrackerCard {
  const task = toTrackerTask(issue, links, projects, hierarchy)
  const uploads = new GitlabUploads(projects.web, issue.web_url.replace(/\/(?:-\/)?(?:issues|work_items)\/\d+\/?$/, ''), issue.project_id)
  const comments = notes.filter((note) => !note.system).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id)
  const sources = [{ text: issue.description ?? '', outsider: false }, ...comments.map((note) => ({ text: note.body, outsider: outsiders.has(note.id) }))]
  const attachments = new Map<string, TaskAttachment>()
  for (const source of sources) {
    for (const file of uploads.files(source.text)) {
      const known = attachments.get(file.file)
      if (known === undefined) attachments.set(file.file, source.outsider ? { ...file, outsider: true } : file)
      else if (!source.outsider) delete known.outsider
    }
  }
  const refOf = (ref: GitlabRef): TaskRef => ({ id: projects.idOf(ref), title: ref.title, status: gitlabStatus(ref.state) })
  const estimate = gitlabEstimate(issue)
  return {
    id: task.id, title: task.title, description: uploads.rewrite(issue.description ?? '', task.id), status: task.status, priority: task.priority,
    labels: task.labels, milestone: task.milestone, parent: hierarchy.parent === null ? null : refOf(hierarchy.parent),
    blockedBy: links.filter((link) => link.link_type === 'is_blocked_by').map(refOf),
    blocks: links.filter((link) => link.link_type === 'blocks').map(refOf), related: links.filter((link) => link.link_type === 'relates_to').map(refOf),
    comments: comments.map((note) => ({
      author: note.author?.username ?? null, at: Date.parse(note.created_at), text: uploads.rewrite(note.body, task.id),
      ...(outsiders.has(note.id) ? { outsider: true as const } : {}),
    })),
    attachments: [...attachments.values()],
    ...(estimate === null ? {} : { estimate }),
  }
}
