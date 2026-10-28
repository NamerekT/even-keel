import type { ChainRules } from '../chain/rules.js'
import { fail } from '../notice/notice.js'
import type { TaskControl } from '../server.js'
import { cardOf } from './card.js'
import type { TrackerLink } from './link.js'
import type { ReaderTasks } from './readers.js'
import { toTask } from './model.js'

export interface TaskControlDeps {
  configuredProject(task: string): string | undefined
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
  return {
    card: async (task) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkFor(project, task)
      if (link === undefined) return undefined
      return link.run(async (tracker) => {
        if (tracker.card === undefined) return undefined
        const [card, milestones] = await Promise.all([tracker.card(task), tracker.milestones?.(task) ?? null])
        return cardOf(card, rulesOf(project!, task), tracker.ready !== undefined, milestones)
      })
    },
    file: async (task, file) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkFor(project, task)
      if (link === undefined) return undefined
      return link.run(async (tracker) => (await tracker.file?.(task, file)) ?? undefined)
    },
    ready: async (task) => {
      const project = configuredProject(task)
      const link = project === undefined ? undefined : linkFor(project, task)
      if (link === undefined) throw fail('task.noTracker', { task })
      const status = await link.run(async (tracker) => tracker.ready?.(task))
      if (status === undefined) throw fail('task.cannotReady', { task })
      if (status === null) throw fail('task.pastBacklog', { task })
      const reader = readerFor(project!, task)
      // A read, not a patch: the task enters the chain already in the milestone `fillMilestone` gives it.
      const refresh = refreshers.get(reader)
      if (refresh !== undefined) return refresh()
      const tasks = readerTasks.get(reader)
      if (tasks?.some((each) => each.id === task)) {
        const updated = tasks.map((each) => (each.id === task ? { ...each, status } : each))
        readerTasks.set(reader, updated)
        readerTasks.setTasks(reader, updated)
      }
      deps.broadcast()
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
      const reader = readerFor(project!, task)
      // Labels can admit a task to the chain: fill its milestone through the same read as `ready`.
      const refresh = refreshers.get(reader)
      if (refresh !== undefined) return refresh()
      const tasks = readerTasks.get(reader)
      if (tasks !== undefined) {
        const updated = tasks.map((each) => each.id === task ? toTask({ ...each, labels }) : each)
        readerTasks.set(reader, updated)
        readerTasks.setTasks(reader, updated)
      }
      deps.broadcast()
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
