import { missingLabel, requiredOn, type ChainRules } from '../chain/rules.js'
import { fail } from '../notice/notice.js'
import type { TaskControl } from '../server.js'
import { cardOf } from './card.js'
import type { LabelChange } from './labels.js'
import type { TrackerLink } from './link.js'
import type { Tracker } from './source.js'
import type { ReaderTasks } from './readers.js'
import { toTask, type TaskStatus } from './model.js'

export interface TaskControlDeps {
  configuredProject(task: string): string | undefined
  /** A session of the task is live: "To the backlog" would be a new way to touch it. */
  live(task: string): boolean
  linkFor(project: string, task: string): TrackerLink | undefined
  rulesOf(project: string, task: string): ChainRules
  readerFor(project: string, task: string): string
  refreshers: Map<string, () => Promise<void>>
  readerTasks: Pick<ReaderTasks, 'get' | 'set' | 'setTasks'>
  refreshProject(project: string): Promise<boolean>
  pollReviews(project: string): Promise<unknown>
  broadcast(): void
}

export function taskControl(deps: TaskControlDeps): TaskControl {
  const { configuredProject, linkFor, rulesOf, readerFor, refreshers, readerTasks } = deps

  const relabeled = async (tracker: Tracker, task: string, change: LabelChange): Promise<string[]> => {
    try { return await tracker.relabel!(task, change) } catch (error) {
      throw fail('task.relabelFailed', { task }, {}, { cause: error })
    }
  }

  // The service puts the task's new state in at once. A read when the reader has one, not a patch: a task entering the chain
  // takes the milestone `fillMilestone` gives it.
  const settle = async (reader: string, task: string, moved: { labels?: string[] | undefined; status?: TaskStatus | null | undefined }): Promise<void> => {
    const refresh = refreshers.get(reader)
    if (refresh !== undefined) return refresh()
    const tasks = readerTasks.get(reader)
    if (tasks?.some((each) => each.id === task)) {
      const { labels, status } = moved
      const updated = tasks.map((each) => (each.id === task ? toTask({ ...each, labels: labels ?? each.labels, status: status ?? each.status }) : each))
      readerTasks.set(reader, updated)
      readerTasks.setTasks(reader, updated)
    }
    deps.broadcast()
  }

  return {
    card: async (task) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkFor(project, task)
      if (link === undefined) return undefined
      return link.run(async (tracker) => {
        if (tracker.card === undefined) return undefined
        const [card, milestones] = await Promise.all([tracker.card(task), tracker.milestones?.(task) ?? null])
        const can = { ready: tracker.ready !== undefined, unready: tracker.unready !== undefined, relabel: tracker.relabel !== undefined }
        return cardOf(card, rulesOf(project!, task), can, milestones)
      })
    },
    file: async (task, file) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkFor(project, task)
      if (link === undefined) return undefined
      return link.run(async (tracker) => (await tracker.file?.(task, file)) ?? undefined)
    },
    // "Into the chain": the missing required label on, then out of the backlog status, whichever the tracker can (BTN-509).
    ready: async (task) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkFor(project, task)
      if (link === undefined) throw fail('task.noTracker', { task })
      const reader = readerFor(project!, task)
      const listed = readerTasks.get(reader)?.find((each) => each.id === task)
      const label = listed === undefined ? null : missingLabel(rulesOf(project!, task), listed)
      const moved = await link.run(async (tracker) => {
        const labels = label === null || tracker.relabel === undefined ? undefined : await relabeled(tracker, task, { add: [label], remove: [] })
        const status = await tracker.ready?.(task)
        if (labels === undefined && (status ?? null) === null) {
          if (label !== null || tracker.ready === undefined) throw fail('task.cannotReady', { task })
          throw fail('task.pastBacklog', { task })
        }
        return { labels, status }
      })
      return settle(reader, task, moved)
    },
    // "To the backlog": the mirror of `ready`, for a task no live session works on (invariant 1).
    unready: async (task) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkFor(project, task)
      if (link === undefined) throw fail('task.noTracker', { task })
      if (deps.live(task)) throw fail('task.unreadyLive', { task })
      const reader = readerFor(project!, task)
      const listed = readerTasks.get(reader)?.find((each) => each.id === task)
      const rules = rulesOf(project!, task)
      const remove = listed === undefined ? rules.requiredLabels : requiredOn(rules, listed)
      // A Jira workflow may have no backlog status: a ready task left alone there is not "in the backlog".
      const parked = listed === undefined || listed.status.category === 'UnStarted' || missingLabel(rules, listed) !== null
      const moved = await link.run(async (tracker) => {
        const labels = remove.length === 0 || tracker.relabel === undefined ? undefined : await relabeled(tracker, task, { add: [], remove })
        const status = await tracker.unready?.(task)
        if (labels === undefined && (status ?? null) === null) {
          if (remove.length > 0 || tracker.unready === undefined || !parked) throw fail('task.cannotUnready', { task })
          throw fail('task.inBacklog', { task })
        }
        return { labels, status }
      })
      return settle(reader, task, moved)
    },
    relabel: async (task, change) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkFor(project, task)
      if (link === undefined) throw fail('task.noTracker', { task })
      let labels: string[] | undefined
      try { labels = await link.run(async (tracker) => tracker.relabel?.(task, change)) } catch (error) {
        throw fail('task.relabelFailed', { task }, {}, { cause: error })
      }
      if (labels === undefined) throw fail('task.cannotRelabel', { task })
      // Labels can admit a task to the chain: fill its milestone through the same read as `ready`.
      return settle(readerFor(project!, task), task, { labels })
    },
    // The milestone moves the task in the chain's order: the project is read anew rather than patched.
    moveMilestone: async (task, milestone) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkFor(project, task)
      if (link === undefined) throw fail('task.noTracker', { task })
      const moved = await link.run(async (tracker) => (tracker.moveMilestone === undefined ? false : (await tracker.moveMilestone(task, milestone), true)))
      if (!moved) throw fail('task.cannotMoveMilestone', { task })
      await refreshers.get(readerFor(project!, task))?.()
    },
    refresh: async (project) => {
      // The page's refresh asks the forges too: otherwise a pull request is seen only by the minute's poll.
      const [read] = await Promise.all([deps.refreshProject(project), deps.pollReviews(project)])
      if (!read) throw fail('tracker.noProject', { project })
    },
  }
}
