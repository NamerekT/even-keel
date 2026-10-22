import type { Dispatcher } from '../chain/dispatcher.js'
import { ownsMilestone, type ChainRules } from '../chain/rules.js'
import { MilestoneFiller } from '../chain/milestones.js'
import { branchMerged } from '../git/merged.js'
import { runGit } from '../git/run.js'
import { MergeCloser } from './closer.js'
import { worthBroadcast, type TrackerView } from './health.js'
import { errorText, TrackerLink } from './link.js'
import { isOpen, type Task } from './model.js'
import { ParentCloser } from './parents.js'
import { StatusPoller } from './poller.js'
import { trackerOf, type ChainTasks, type TrackerSetup } from './source.js'

const TRACKER_POLL_MS = 5_000
const TASKS_REFRESH_MS = 30_000
/** How long a task the chain ran stays on the page once closed, whatever its milestone. */
export const RAN_SHOWN_MS = 7 * 24 * 60 * 60_000
const TRACKER_TIMEOUT_MS = 15_000

/**
 * What a tracker reads is a reader (BTN-66): a project or one of its feeds, each of its own id. The deps take a reader
 * where they say `project`; `tasksByProject` and `dispatcher` join the readers of a project (`ReaderTasks`).
 */
export interface TrackerStartDeps {
  /** Path to the main checkout of the project. */
  repoOf: (project: string) => string
  rulesOf: (project: string) => ChainRules
  links: Map<string, TrackerLink>
  tasksByProject: { get(project: string): Task[] | undefined; has(project: string): boolean; set(project: string, tasks: Task[]): void }
  /** The tasks of the reader the chain started since then, closed ones included. */
  ranSince: (project: string, since: Date) => string[]
  dispatcher: Pick<Dispatcher, 'setTasks' | 'setOutside' | 'released' | 'setReleased' | 'held' | 'view'>
  /** The project's `fillMilestone` setting. */
  fillsMilestone: (project: string) => boolean
  /** The project's main branch, where a merged task branch lands. */
  mainBranch: (project: string) => string
  /** The place in the tracker the project reads (`TrackerProjectKey.placeOf`); projects with the same one read it once. */
  readKey: (project: string) => string
  /** Sends the page a fresh state. */
  broadcast: () => void
  /** Filled here: a read of the project's tasks out of turn, for each project of the tracker. */
  refreshers: Map<string, () => Promise<void>>
}

/** A running tracker: its credentials change on the fly, and it stops when its projects or variables are gone. */
export interface TrackerHandle {
  /** Closes the connection; the next call connects with `setup`. */
  update(setup: TrackerSetup): void
  stop(): void
}

/** Connects a tracker, polls the statuses of its projects' tasks and refreshes them, closing merged tasks and done parents. */
export function startTracker(view: TrackerView, setup: TrackerSetup, deps: TrackerStartDeps): TrackerHandle {
  const { repoOf, rulesOf, links, tasksByProject, ranSince, dispatcher, fillsMilestone, mainBranch, readKey, broadcast, refreshers } = deps
  const { name, title, projects } = view
  let current = setup
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  let completes = false
  let closesParents = false
  let setsMilestones = false
  const unfilled = new Set<string>()
  const link = new TrackerLink({
    name: title,
    connect: async () => {
      const tracker = trackerOf(await current.connect(TRACKER_TIMEOUT_MS))
      completes = tracker.complete !== undefined
      closesParents = completes && tracker.children !== undefined
      setsMilestones = tracker.setMilestone !== undefined
      view.ready = tracker.ready !== undefined
      return tracker
    },
    timeoutMs: TRACKER_TIMEOUT_MS,
    onHealth: (health) => {
      const before = view.health
      view.health = health
      if (worthBroadcast(before, health)) broadcast()
    },
  })
  links.set(name, link)
  view.health = link.health
  const report = (error: unknown) => {
    if (!stopped) console.error(`${title}: ${errorText(error)}`)
  }
  const ownTasks = () => projects.flatMap((project) => tasksByProject.get(project) ?? [])

  const closer = new MergeCloser({
    merged: (project, task) => branchMerged(runGit, repoOf(project), task, mainBranch(project)),
    complete: (task) => link.run((tracker) => tracker.complete!(task)),
    onError: report,
  })

  const parentCloser = new ParentCloser({
    children: (task) => link.run((tracker) => tracker.children!(task)),
    complete: (task) => link.run((tracker) => tracker.complete!(task)),
    onError: report,
  })

  const filler = new MilestoneFiller({
    enabled: fillsMilestone,
    assign: (task, like) => link.run((tracker) => tracker.setMilestone!(task, like)),
    onError: report,
  })

  const fillMilestones = async (project: string): Promise<void> => {
    if (!setsMilestones) {
      if (!fillsMilestone(project) || unfilled.has(project)) return
      unfilled.add(project)
      console.warn(`config: ${view.title} cannot set the milestone of a task, fillMilestone of ${project} does nothing`)
      return
    }
    for (const { task, like, milestone } of await filler.sweep(project, dispatcher.view(project))) {
      console.log(`${title}: put ${task} into the milestone ${milestone} of ${like}, it entered the chain without one`)
    }
  }

  const poller = new StatusPoller({
    link,
    watched: () => ownTasks().map((task) => task.id),
    intervalMs: TRACKER_POLL_MS,
    onChange: (changes) => {
      const byId = new Map(changes.map((change) => [change.id, change.to]))
      for (const project of projects) {
        const tasks = tasksByProject.get(project)
        if (tasks === undefined || !tasks.some((task) => byId.has(task.id))) continue
        const updated = tasks.flatMap((task) => {
          const status = byId.has(task.id) ? byId.get(task.id) : task.status
          return status ? [{ ...task, status }] : []
        })
        tasksByProject.set(project, updated)
        dispatcher.setTasks(project, updated)
      }
      broadcast()
    },
    onError: report,
  })

  const unknownByProject = new Map<string, string>()
  const refreshing = new Map<string, Promise<void>>()
  /** One read of the project at a time: a read asked for during another goes after it, so its list is the newer one. */
  const refreshProject = (project: string): Promise<void> => {
    const next = (refreshing.get(project) ?? Promise.resolve()).then(() => readProject(project))
    refreshing.set(project, next)
    return next
  }
  const reads = new Map<string, Promise<ChainTasks>>()
  /** The tracker's open tasks of the project; a read of the same tracker project by the same statuses under way is joined. */
  const chainTasks = (project: string, rules: ChainRules): Promise<ChainTasks> => {
    const key = JSON.stringify([readKey(project), rules.active, rules.terminal])
    const running = reads.get(key)
    if (running !== undefined) return running
    const read = link.run((tracker) => tracker.chainTasks(project, rules)).finally(() => reads.delete(key))
    reads.set(key, read)
    return read
  }
  const readProject = async (project: string): Promise<void> => {
    try {
      const rules = rulesOf(project)
      const read = await chainTasks(project, rules)
      const tasks = read.tasks.filter((task) => ownsMilestone(rules, task))
      const parents = read.parents.filter((task) => ownsMilestone(rules, task))
      const { unknownStatuses } = read
      const unknown = unknownStatuses.join('", "')
      if (unknown !== (unknownByProject.get(project) ?? '') && unknown !== '') {
        console.warn(`config: ${view.title} has no status "${unknown}" named in the chain rules of ${project}`)
      }
      unknownByProject.set(project, unknown)
      const listed = new Set([...tasks, ...parents].map((task) => task.id))
      const missing = [...new Set(tasks.filter((task) => isOpen(task.status)).flatMap((task) => task.blockedBy))].filter((id) => !listed.has(id))
      const others = missing.length === 0 ? [] : await link.run((tracker) => tracker.tasks(missing))
      const unlisted = ranSince(project, new Date(Date.now() - RAN_SHOWN_MS)).filter((id) => !listed.has(id))
      const ran = unlisted.length === 0 ? [] : (await link.run((tracker) => tracker.tasks(unlisted))).filter((task) => !isOpen(task.status))
      const shown = [...tasks, ...ran]
      if (stopped) return
      dispatcher.setOutside(project, [...parents, ...others])
      tasksByProject.set(project, shown)
      dispatcher.setTasks(project, shown)
      view.readAt[project] = new Date().toISOString()
      const released = dispatcher.released(project)
      if (released.length > 0) dispatcher.setReleased(project, await link.run((tracker) => tracker.tasks(released)))
      await fillMilestones(project)
      if (!completes) return
      const open = shown.filter((task) => isOpen(task.status)).map((task) => task.id)
      for (const task of await closer.sweep(project, dispatcher.held(project), open)) {
        console.log(`${title}: closed ${task}, its branch is merged into main`)
      }
      if (!closesParents) return
      for (const task of await parentCloser.sweep(parents, tasks)) {
        console.log(`${title}: closed ${task}, all its subtasks are closed`)
      }
    } catch (error) {
      report(error)
    }
  }
  const own = new Map<string, () => Promise<void>>()
  for (const project of projects) {
    const refresh = async () => {
      await refreshProject(project)
      broadcast()
    }
    own.set(project, refresh)
    refreshers.set(project, refresh)
  }
  const refreshTasks = async (): Promise<void> => {
    await Promise.all(projects.map(refreshProject))
    if (stopped) return
    broadcast()
    poller.start()
    timer = setTimeout(() => void refreshTasks(), projects.some((project) => tasksByProject.has(project)) ? TASKS_REFRESH_MS : TRACKER_POLL_MS)
  }
  void refreshTasks()
  return {
    update: (next) => {
      current = next
      link.reset()
    },
    stop: () => {
      stopped = true
      clearTimeout(timer)
      void poller.stop()
      for (const [project, refresh] of own) if (refreshers.get(project) === refresh) refreshers.delete(project)
      if (links.get(name) === link) links.delete(name)
      void link.close()
    },
  }
}
