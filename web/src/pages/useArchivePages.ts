import { useEffect, useRef, useState } from 'react'
import type { ArchivePage, EvenKeelState } from '../../../src/state.js'
import type { Task } from '../../../src/tracker/model.js'
import { useLive } from '../live/context.js'
import type { ChainBlock } from '../state.js'
import { taskLamp } from '../taskLamp.js'
import type { OlderRows } from '../ui/archive.js'

/** Which button asked for the page on its way: the archive line or its "K more". */
export type ArchiveBusy = 'open' | 'more' | null

export interface ArchivePages extends OlderRows<ChainBlock> {
  busy: ArchiveBusy
  /** Asks the server for pages until `count` more rows came or the archive has no more; then `done`. */
  load(count: number, busy: Exclude<ArchiveBusy, null>, done: () => void): void
}

interface Loaded {
  project: string
  /** The last closed first, as the server gives them. */
  tasks: Task[]
  /** The cursor of the next page; `null` — none left; `undefined` — nothing asked yet. */
  next: string | null | undefined
}

/** The most pages one press or one link asks for. */
const MAX_REQUESTS = 8

/**
 * The archive's pages beyond the state's tasks (BTN-1445), asked for by `archive/page` when a press needs more rows than
 * the page has, and when the address names a task that is neither in the chain nor loaded. Its reads go past the page's
 * loader: the pressed button spins instead.
 */
export function useArchivePages(project: string, focus: string, known: (id: string) => boolean): ArchivePages {
  const { state, read } = useLive()
  const more = state?.archiveMore?.[project] ?? 0
  const [loaded, setLoaded] = useState<Loaded>({ project, tasks: [], next: undefined })
  const [busy, setBusy] = useState<ArchiveBusy>(null)
  const current = loaded.project === project ? loaded : { project, tasks: [], next: undefined }
  const latest = useRef(current)
  latest.current = current
  const sought = useRef(new Set<string>())

  /** Pages until `until` tasks are loaded, or with `target` until it is among them. */
  const fetch = async (until: number, target?: string): Promise<void> => {
    let { tasks, next } = latest.current
    for (let requests = 0; next !== null && requests < MAX_REQUESTS; requests++) {
      const page = await read<ArchivePage>('archive/page', { project, after: next ?? null, ...(target !== undefined && { focus: target }) })
      const ids = new Set(tasks.map((task) => task.id))
      tasks = [...tasks, ...page.tasks.filter((task) => !ids.has(task.id))]
      next = page.next
      latest.current = { project, tasks, next }
      setLoaded(latest.current)
      if (target !== undefined ? tasks.some((task) => task.id === target) : tasks.length >= until) break
    }
  }

  const load = (count: number, which: Exclude<ArchiveBusy, null>, done: () => void) => {
    if (busy !== null) return
    if (latest.current.next === null || more === 0) return done()
    setBusy(which)
    void fetch(latest.current.tasks.length + count)
      .catch((error: unknown) => console.warn(`archive/page ${project}: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        setBusy(null)
        done()
      })
  }

  const seek = focus !== '' && more > 0 && current.next !== null && !known(focus) && !current.tasks.some((task) => task.id === focus) && !sought.current.has(focus)
  useEffect(() => {
    if (!seek) return
    sought.current.add(focus)
    void fetch(0, focus).catch((error: unknown) => console.warn(`archive/page ${project} ${focus}: ${error instanceof Error ? error.message : String(error)}`))
  }, [seek, focus, project])

  const rows = current.tasks.toReversed().map((task) => archivedBlock(task, state?.taskSessions ?? {}))
  return { rows, left: current.next === null ? 0 : Math.max(0, more - current.tasks.length), busy, load }
}

/** A row of the archive for a closed task the state does not hold: its lamp by its status, its runs where the state has them. */
export function archivedBlock(task: Task, taskSessions: EvenKeelState['taskSessions']): ChainBlock {
  return {
    id: task.id,
    title: task.title,
    status: task.status.name,
    stage: task.status.category,
    lamp: taskLamp(task, null),
    open: false,
    locked: false,
    blockedBy: [],
    milestone: task.milestone?.label ?? null,
    after: [],
    current: false,
    skipped: false,
    question: false,
    priority: task.priority,
    estimate: task.estimate,
    parent: task.parent,
    labels: task.labels,
    run: null,
    session: null,
    sessions: taskSessions[task.id] ?? [],
    limit: null,
    start: null,
  }
}
