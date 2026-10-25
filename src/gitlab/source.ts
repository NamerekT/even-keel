import { Skipped } from '../github/trust.js'
import { parseTaskId, type TrackerTask } from '../tracker/model.js'
import { TrackerNotFound, type TaskSource, type TrackerPlace } from '../tracker/source.js'
import { GitlabApi, GitlabHttpError } from './api.js'
import { GitlabHierarchy } from './hierarchy.js'
import { GITLAB_STATUSES, gitlabPriority, gitlabStatus, ProjectMap, toCard, toTrackerTask, type GitlabIssue, type GitlabLink, type GitlabMilestone, type GitlabNote } from './model.js'

export interface GitlabSettings {
  web: string
  token: string
  projects: Readonly<Record<string, TrackerPlace>>
}

export async function connectGitlab(settings: GitlabSettings, timeoutMs: number, fetchImpl: typeof fetch = fetch, log: (line: string) => void = console.log): Promise<TaskSource> {
  const api = new GitlabApi(settings.web, settings.token, timeoutMs, fetchImpl)
  const projects = new ProjectMap(settings.projects, settings.web)
  const hierarchy = new GitlabHierarchy(api)
  const skipped = new Skipped(log)
  const viewer = await api.rest<{ id: number }>('/user')

  const pathOf = (project: string): string => {
    const path = projects.pathOf(project)
    if (path === undefined) throw new Error(`gitlab: project ${project} has no GitLab path`)
    return path
  }
  const projectBase = (path: string) => `/projects/${encodeURIComponent(path)}`
  const addressOf = (id: string) => {
    const parsed = parseTaskId(id)
    const path = parsed === null ? undefined : projects.pathOfKey(parsed.project)
    if (parsed === null || path === undefined) throw new Error(`gitlab: unknown task ${id}`)
    return { path, iid: parsed.number, base: `${projectBase(path)}/issues/${parsed.number}` }
  }
  const rawIssue = (id: string) => api.rest<GitlabIssue>(addressOf(id).base)
  const linksOf = (path: string, iid: number) => api.collect<GitlabLink>(`${projectBase(path)}/issues/${iid}/links`)
  const notesOf = (id: string) => api.collect<GitlabNote>(`${addressOf(id).base}/notes?sort=asc&order_by=created_at`)
  const converted = async (issue: GitlabIssue, path: string): Promise<TrackerTask> => toTrackerTask(issue, await linksOf(path, issue.iid), projects, await hierarchy.read(path, issue.iid))
  const labelsOf = (path: string) => api.collect<{ name: string }>(`${projectBase(path)}/labels?include_ancestor_groups=true`)
  const milestonesOf = (path: string) => api.collect<GitlabMilestone>(`${projectBase(path)}/milestones?state=active&include_ancestors=true`)

  async function trustedNotes(id: string, notes: GitlabNote[]): Promise<GitlabNote[]> {
    const path = addressOf(id).path
    const levels = new Map<number, boolean>()
    const passed: GitlabNote[] = []
    for (const note of notes) {
      if (note.system) continue
      let trusted = note.author?.id === viewer.id
      if (!trusted && note.author != null) {
        if (!levels.has(note.author.id)) {
          let level = 0
          try {
            level = (await api.rest<{ access_level: number }>(`${projectBase(path)}/members/all/${note.author.id}`)).access_level
          } catch (error) {
            if (!(error instanceof TrackerNotFound) && !(error instanceof GitlabHttpError && error.status === 403)) throw error
          }
          levels.set(note.author.id, level >= 20)
        }
        trusted = levels.get(note.author.id) ?? false
      }
      if (trusted) passed.push(note)
      else skipped.note(String(note.id), `gitlab: ${id}: comment ${note.id} skipped: its author is not a Reporter or above in ${path}`)
    }
    return passed
  }

  return {
    async chainTasks(project, open) {
      const path = pathOf(project)
      const states = GITLAB_STATUSES.filter(open).map((status) => status.category === 'ToDo' ? 'opened' : 'closed')
      if (states.length === 0) return { tasks: [], statuses: GITLAB_STATUSES.map((status) => status.name) }
      const selected = await api.collect<GitlabIssue>(`${projectBase(path)}/issues?state=${states.length === 2 ? 'all' : states[0]}&scope=all`)
      const issues = selected.filter((issue) => open(gitlabStatus(issue.state)))
      const milestones = [...new Set(issues.flatMap((issue) => issue.milestone === null ? [] : [issue.milestone.title]))]
      if (states.length === 1) {
        for (const title of milestones) {
          const others = await api.collect<GitlabIssue>(`${projectBase(path)}/issues?state=${states[0] === 'opened' ? 'closed' : 'opened'}&milestone=${encodeURIComponent(title)}&scope=all`)
          issues.push(...others.filter((issue) => !open(gitlabStatus(issue.state))))
        }
      }
      const tasks: TrackerTask[] = []
      for (const issue of new Map(issues.map((issue) => [issue.id, issue])).values()) tasks.push(await converted(issue, path))
      return { tasks, statuses: GITLAB_STATUSES.map((status) => status.name) }
    },

    async tasks(ids) {
      const tasks: TrackerTask[] = []
      for (const id of ids) {
        const parsed = parseTaskId(id)
        if (parsed === null || projects.pathOfKey(parsed.project) === undefined) continue
        let issue: GitlabIssue
        try { issue = await rawIssue(id) } catch (error) {
          if (error instanceof TrackerNotFound) continue
          throw error
        }
        tasks.push(await converted(issue, addressOf(id).path))
      }
      return tasks
    },

    async brief(id) {
      const issue = await rawIssue(id)
      return { title: issue.title, description: issue.description ?? '' }
    },

    async complete(id) {
      if ((await rawIssue(id)).state === 'closed') return false
      await api.rest(addressOf(id).base, 'PUT', { state_event: 'close' })
      return true
    },

    async children(id) {
      const { path, iid } = addressOf(id)
      const { children } = await hierarchy.read(path, iid)
      const tasks: TrackerTask[] = []
      for (const child of children) {
        const childId = projects.idOf(child)
        if (parseTaskId(childId) === null) continue
        tasks.push(await converted(await rawIssue(childId), addressOf(childId).path))
      }
      return tasks
    },

    async card(id) {
      const issue = await rawIssue(id)
      const { path, iid } = addressOf(id)
      return toCard(issue, await linksOf(path, iid), await notesOf(id), projects, await hierarchy.read(path, iid))
    },

    async comment(id, body) {
      return String((await api.rest<{ id: number }>(`${addressOf(id).base}/notes`, 'POST', { body })).id)
    },

    async commentsAfter(id, after) {
      const notes = await notesOf(id)
      const anchor = notes.findIndex((note) => String(note.id) === after)
      if (anchor < 0) return []
      return (await trustedNotes(id, notes.slice(anchor + 1))).map((note) => ({ id: String(note.id), body: note.body, files: [] }))
    },

    async create(task) {
      const path = pathOf(task.project)
      const labels = await labelsOf(path)
      const priority = task.priority === 'none' ? undefined : labels.find((label) => gitlabPriority([label.name]) === task.priority)?.name
      const like = task.milestoneOf === null ? null : parseTaskId(task.milestoneOf)
      const milestone = like !== null && projects.pathOfKey(like.project) === path ? (await rawIssue(task.milestoneOf!)).milestone : null
      const issue = await api.rest<GitlabIssue>(`${projectBase(path)}/issues`, 'POST', {
        title: task.title, description: task.description,
        ...(priority === undefined ? {} : { labels: [priority] }), ...(milestone === null ? {} : { milestone_id: milestone.id }),
      })
      return `${projects.keyOf(task.project)}-${issue.iid}`
    },

    async setMilestone(id, milestoneOf) {
      if (parseTaskId(id)?.project !== parseTaskId(milestoneOf)?.project) return false
      if ((await rawIssue(id)).milestone !== null) return false
      const milestone = (await rawIssue(milestoneOf)).milestone
      if (milestone === null) return false
      await api.rest(addressOf(id).base, 'PUT', { milestone_id: milestone.id })
      return true
    },

    async milestones(id) {
      const own = (await rawIssue(id)).milestone
      const active = await milestonesOf(addressOf(id).path)
      const choices = [...new Map([...active, ...(own === null ? [] : [own])].map((milestone) => [milestone.id, milestone])).values()]
      return { current: own === null ? null : String(own.id), choices: choices.map((milestone) => ({ id: String(milestone.id), label: milestone.title, targetDate: milestone.due_date === null ? null : Date.parse(milestone.due_date) })) }
    },

    async moveMilestone(id, milestone) {
      if (milestone !== null && !/^[1-9]\d*$/.test(milestone)) throw new Error('gitlab: invalid milestone id')
      await api.rest(addressOf(id).base, 'PUT', { milestone_id: milestone === null ? 0 : Number(milestone) })
    },

    async milestoneTasks(project, milestone) {
      const path = pathOf(project)
      const found = (await api.collect<GitlabMilestone>(`${projectBase(path)}/milestones?include_ancestors=true&search=${encodeURIComponent(milestone)}`)).find((each) => each.title === milestone)
      if (found === undefined) return []
      const issues = await api.collect<GitlabIssue>(`${projectBase(path)}/issues?state=all&milestone=${encodeURIComponent(found.title)}&scope=all`)
      const tasks = []
      for (const issue of issues) {
        const task = await converted(issue, path)
        const notes = await trustedNotes(task.id, await notesOf(task.id))
        tasks.push({ ...task, lastComment: notes.at(-1)?.body ?? null })
      }
      return tasks
    },

    async vocabulary(project) {
      const path = pathOf(project)
      return { statuses: [...GITLAB_STATUSES], labels: (await labelsOf(path)).map((label) => label.name), milestones: (await milestonesOf(path)).map((milestone) => milestone.title) }
    },

    async isPublic(project) {
      return (await api.rest<{ visibility: string }>(projectBase(pathOf(project)))).visibility === 'public'
    },
    close: async () => {},
  }
}
