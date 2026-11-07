import { Skipped } from '../github/trust.js'
import { RepoMap, type Repo } from '../github/model.js'
import { limitedMap } from '../gitlab/batch.js'
import { resolveLabels } from '../tracker/labels.js'
import { parseTaskId, type TrackerTask } from '../tracker/model.js'
import { TrackerNotFound, type TaskSource, type TrackerPlace } from '../tracker/source.js'
import { ForgejoApi, ForgejoHttpError, ForgejoScopeError } from './api.js'
import { FORGEJO_STATUSES, forgejoPriority, forgejoStatus, labelNames, toCard, toTrackerTask, type ForgejoComment, type ForgejoIssue, type ForgejoLabel, type ForgejoMilestone } from './model.js'
import { forgejoTrust } from './trust.js'

export interface ForgejoSettings {
  web: string
  token: string
  projects: Readonly<Record<string, TrackerPlace>>
}

/**
 * Forgejo Issues over the Gitea API (BTN-476), so Gitea and Codeberg too. An open issue is `ToDo`, a closed one `Won`;
 * blockers are the native dependencies, which a repository may turn off: the blocked-by route then answers 404 and the chain
 * goes by milestones and priority alone. No subtasks, no estimate, no backlog status: entry is by label.
 */
export async function connectForgejo(settings: ForgejoSettings, timeoutMs: number, fetchImpl: typeof fetch = fetch, log: (line: string) => void = console.log): Promise<TaskSource> {
  const api = new ForgejoApi(settings.web, settings.token, timeoutMs, fetchImpl)
  const repos = new RepoMap(settings.projects)
  const skipped = new Skipped(log)
  const viewer = (await api.rest<{ login: string }>('/user')).login

  const repoOf = (project: string): Repo => {
    const repo = repos.repoOf(project)
    if (repo === undefined) throw new Error(`forgejo: project ${project} has no Forgejo repository`)
    return repo
  }
  const repoBase = (repo: Repo) => `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`
  const addressOf = (id: string) => {
    const parsed = parseTaskId(id)
    const repo = parsed === null ? undefined : repos.repoOfKey(parsed.project)
    if (parsed === null || repo === undefined) throw new Error(`forgejo: unknown task ${id}`)
    return { repo, number: parsed.number, base: `${repoBase(repo)}/issues/${parsed.number}` }
  }
  const rawIssue = async (id: string): Promise<ForgejoIssue> => {
    const issue = await api.rest<ForgejoIssue>(addressOf(id).base)
    if (issue.pull_request != null) throw new TrackerNotFound(`forgejo: ${id} is a pull request, not an issue`)
    return issue
  }
  const issuesOf = async (repo: Repo, query: string) =>
    (await api.collect<ForgejoIssue>(`${repoBase(repo)}/issues?type=issues&${query}`)).filter((issue) => issue.pull_request == null)
  const commentsOf = (id: string) => api.rest<ForgejoComment[] | null>(`${addressOf(id).base}/comments`).then((rows) => rows ?? [])
  const labelsOf = async (repo: Repo): Promise<ForgejoLabel[]> => {
    const own = await api.collect<ForgejoLabel>(`${repoBase(repo)}/labels`)
    // An organization's labels go on its repositories' issues too; a user's repository has none such (404).
    const org = await api.collect<ForgejoLabel>(`/orgs/${encodeURIComponent(repo.owner)}/labels`).catch(async (error: unknown) => {
      if (error instanceof TrackerNotFound) return []
      if (error instanceof ForgejoScopeError && !(await ownedByOrganization(repo))) return []
      throw error
    })
    return [...own, ...org]
  }
  /**
   * Forgejo refuses a token without `read:organization` on `/orgs/…` before it looks whether the owner is an
   * organization (BTN-820). A repository's `/teams` needs only the repository's scope and answers 405 for a user's one.
   */
  const ownedByOrganization = async (repo: Repo): Promise<boolean> => {
    try {
      await (await api.request(`${repoBase(repo)}/teams`)).body?.cancel()
      return true
    } catch (error) {
      if (error instanceof ForgejoHttpError && error.status === 405) return false
      return true
    }
  }
  const openMilestones = (repo: Repo) => api.collect<ForgejoMilestone>(`${repoBase(repo)}/milestones?state=open`)
  const trustIn = (repo: Repo) => forgejoTrust(api, repo.owner, repo.name, viewer)

  /** The issues that block one; `null` — the repository has dependencies turned off. */
  const dependenciesOf = async (base: string, which: 'dependencies' | 'blocks'): Promise<ForgejoIssue[] | null> => {
    try {
      return await api.collect<ForgejoIssue>(`${base}/${which}`)
    } catch (error) {
      if (error instanceof TrackerNotFound) return null
      throw error
    }
  }

  /** Open issues with their blockers, closed ones without: a closed task orders nothing. */
  async function converted(repo: Repo, issues: ForgejoIssue[]): Promise<TrackerTask[]> {
    let off = false
    return limitedMap(issues, async (issue) => {
      const blockers = issue.state === 'open' && !off ? await dependenciesOf(`${repoBase(repo)}/issues/${issue.number}`, 'dependencies') : []
      if (blockers === null) off = true
      return toTrackerTask(issue, blockers ?? [], repos)
    })
  }

  async function trusted(id: string, comments: ForgejoComment[]): Promise<ForgejoComment[]> {
    const { repo } = addressOf(id)
    const trust = trustIn(repo)
    const passed: ForgejoComment[] = []
    for (const comment of comments) {
      if (await trust(comment.user?.login)) {
        passed.push(comment)
        continue
      }
      const author = comment.user?.login ?? 'a deleted account'
      skipped.note(String(comment.id), `forgejo: ${id}: the comment ${comment.id} of ${author} is skipped: its author is not a collaborator of ${repo.owner}/${repo.name}`)
    }
    return passed
  }

  return {
    async chainTasks(project, open) {
      const repo = repoOf(project)
      const statuses = FORGEJO_STATUSES.map((status) => status.name)
      const states = FORGEJO_STATUSES.filter(open).map((status) => (status.category === 'ToDo' ? 'open' : 'closed'))
      if (states.length === 0) return { tasks: [], statuses }
      const issues = (await issuesOf(repo, `state=${states.length === 2 ? 'all' : states[0]}`)).filter((issue) => open(forgejoStatus(issue.state)))
      if (states.length === 1) {
        const milestones = [...new Set(issues.flatMap((issue) => (issue.milestone === null ? [] : [issue.milestone.id])))]
        for (const milestone of milestones) {
          const others = await issuesOf(repo, `state=${states[0] === 'open' ? 'closed' : 'open'}&milestones=${milestone}`)
          issues.push(...others.filter((issue) => !open(forgejoStatus(issue.state))))
        }
      }
      return { tasks: await converted(repo, [...new Map(issues.map((issue) => [issue.number, issue])).values()]), statuses }
    },

    async tasks(ids) {
      const found = await limitedMap(ids, async (id) => {
        const parsed = parseTaskId(id)
        if (parsed === null || repos.repoOfKey(parsed.project) === undefined) return null
        try {
          const issue = await rawIssue(id)
          const blockers = issue.state === 'open' ? await dependenciesOf(addressOf(id).base, 'dependencies') : []
          return toTrackerTask(issue, blockers ?? [], repos)
        } catch (error) {
          if (error instanceof TrackerNotFound) return null
          throw error
        }
      })
      return found.flatMap((task) => (task === null ? [] : [task]))
    },

    async brief(id) {
      const issue = await rawIssue(id)
      return { title: issue.title, description: issue.body ?? '' }
    },

    async complete(id) {
      if ((await rawIssue(id)).state === 'closed') return false
      await api.rest(addressOf(id).base, 'PATCH', { state: 'closed' })
      return true
    },

    async card(id) {
      const issue = await rawIssue(id)
      const { base } = addressOf(id)
      const [blockedBy, comments] = await Promise.all([dependenciesOf(base, 'dependencies'), commentsOf(id)])
      const blocks = blockedBy === null ? [] : await dependenciesOf(base, 'blocks')
      return toCard(issue, blockedBy ?? [], blocks ?? [], comments, repos)
    },

    async comment(id, body) {
      return String((await api.rest<{ id: number }>(`${addressOf(id).base}/comments`, 'POST', { body })).id)
    },

    async commentsAfter(id, after) {
      const comments = await commentsOf(id)
      const anchor = comments.findIndex((comment) => String(comment.id) === after)
      if (anchor < 0) return []
      return (await trusted(id, comments.slice(anchor + 1))).map((comment) => ({ id: String(comment.id), body: comment.body, files: [] }))
    },

    // An open issue is the ready status; the priority goes on as a label only when the repository has one of that level.
    async create(task) {
      const repo = repoOf(task.project)
      const key = repos.projectKey(task.project)!
      const labels = task.priority === 'none' ? [] : await labelsOf(repo)
      const priority = labels.find((label) => forgejoPriority([label.name]) === task.priority)
      const like = task.milestoneOf === null ? null : parseTaskId(task.milestoneOf)
      const milestone = like !== null && like.project === key ? (await rawIssue(task.milestoneOf!)).milestone : null
      const issue = await api.rest<ForgejoIssue>(`${repoBase(repo)}/issues`, 'POST', {
        title: task.title,
        body: task.description,
        ...(priority === undefined ? {} : { labels: [priority.id] }),
        ...(milestone === null ? {} : { milestone: milestone.id }),
      })
      return `${key}-${issue.number}`
    },

    // A milestone belongs to a repository: a task of another project gives none.
    async setMilestone(id, milestoneOf) {
      if (parseTaskId(id)?.project !== parseTaskId(milestoneOf)?.project) return false
      if ((await rawIssue(id)).milestone !== null) return false
      const milestone = (await rawIssue(milestoneOf)).milestone
      if (milestone === null) return false
      await api.rest(addressOf(id).base, 'PATCH', { milestone: milestone.id })
      return true
    },

    async milestones(id) {
      const own = (await rawIssue(id)).milestone
      const open = await openMilestones(addressOf(id).repo)
      const choices = [...new Map([...open, ...(own === null ? [] : [own])].map((milestone) => [milestone.id, milestone])).values()]
      return {
        current: own === null ? null : String(own.id),
        choices: choices.map((milestone) => ({ id: String(milestone.id), label: milestone.title, targetDate: milestone.due_on === null ? null : Date.parse(milestone.due_on) })),
      }
    },

    // Forgejo takes milestone 0 for none.
    async moveMilestone(id, milestone) {
      if (milestone !== null && !/^[1-9]\d*$/.test(milestone)) throw new Error('forgejo: invalid milestone id')
      await api.rest(addressOf(id).base, 'PATCH', { milestone: milestone === null ? 0 : Number(milestone) })
    },

    async milestoneTasks(project, milestone) {
      const repo = repoOf(project)
      const found = (await api.collect<ForgejoMilestone>(`${repoBase(repo)}/milestones?state=all&name=${encodeURIComponent(milestone)}`)).find((each) => each.title === milestone)
      if (found === undefined) return []
      const issues = await issuesOf(repo, `state=all&milestones=${found.id}`)
      const tasks = []
      for (const task of await converted(repo, issues)) {
        const comments = await trusted(task.id, await commentsOf(task.id))
        tasks.push({ ...task, lastComment: comments.at(-1)?.body ?? null })
      }
      return tasks
    },

    async vocabulary(project) {
      const repo = repoOf(project)
      const [labels, milestones] = await Promise.all([labelsOf(repo), openMilestones(repo)])
      return { statuses: [...FORGEJO_STATUSES], labels: [...new Set(labels.map((label) => label.name))], milestones: milestones.map((each) => each.title) }
    },

    async relabel(id, change) {
      const { repo, base } = addressOf(id)
      const issue = await rawIssue(id)
      const selected = await resolveLabels(issue.labels ?? [], change, await labelsOf(repo), (name) =>
        api.rest<ForgejoLabel>(`${repoBase(repo)}/labels`, 'POST', { name, color: '#808080' }),
      )
      const saved = await api.rest<ForgejoLabel[] | null>(`${base}/labels`, 'PUT', { labels: selected.map((label) => label.id) })
      return labelNames({ labels: saved })
    },

    // An internal repository is open to every account of the server, and anyone may sign up on Codeberg: only a private one is closed.
    async isPublic(project) {
      return !(await api.rest<{ private: boolean }>(repoBase(repoOf(project)))).private
    },

    close: async () => {},
  }
}
