import type { EvenKeelState } from '../../../src/state.js'
import { shownWork, type WorkInput } from '../work.js'

export type EventsInput = Pick<EvenKeelState, 'ci' | 'fixes' | 'forwards'> &
  WorkInput & {
    chain: Pick<EvenKeelState['chain'], 'active'>
  }

/**
 * Something on the page that waits for a person, worth a toast when it comes: a chain held by the usage limit, a red
 * main, a session that asks, a carry of a release held by a conflict, work left in the folder of a task out of the
 * chain. `key` tells one occurrence from the next.
 */
export type PageEvent =
  | { key: string; kind: 'limit'; project: string; until?: string }
  | { key: string; kind: 'red'; project: string; commit: string }
  | { key: string; kind: 'ask'; project: string | null; task: string }
  | { key: string; kind: 'conflict'; project: string; into: string }
  | { key: string; kind: 'work'; project: string; task: string; path: string; files: number; ahead: number; backlog: boolean }

const short = (commit: string) => commit.slice(0, 7)

export function pageEvents(state: EventsInput): PageEvent[] {
  const events: PageEvent[] = []
  const red = (project: string, commit: string) => {
    const key = `red|${project}|${short(commit)}`
    if (!events.some((each) => each.key === key)) events.push({ key, kind: 'red', project, commit: short(commit) })
  }
  for (const chain of state.chain.active) {
    const { project, error } = chain
    if (chain.limitUntil !== undefined) events.push({ key: `limit|${project}|${chain.limitUntil}`, kind: 'limit', project, until: chain.limitUntil })
    else if (chain.paused && error?.code === 'chain.limitSpent') events.push({ key: `limit|${project}|${error.params.until}`, kind: 'limit', project })
    if (chain.paused && error !== null && /^(ci|check)\./.test(error.code) && 'commit' in error.params) red(project, String(error.params.commit))
  }
  for (const [project, views] of Object.entries(state.ci)) {
    for (const view of views) if (view.current?.run.status === 'failure') red(project, view.current.run.commit)
  }
  for (const [project, fixes] of Object.entries(state.fixes)) {
    const open = fixes.at(-1)
    if (open !== undefined && open.end === null && open.red !== null) red(project, open.red)
  }
  for (const session of state.sessions) {
    if (!session.asking) continue
    const project = state.tasks.find((task) => task.id === session.task)?.project ?? null
    events.push({ key: `ask|${session.sessionId}`, kind: 'ask', project, task: session.task })
  }
  for (const [project, forward] of Object.entries(state.forwards)) {
    if (forward.hold?.code === 'forward.conflict') events.push({ key: `conflict|${project}|${forward.into}`, kind: 'conflict', project, into: forward.into })
  }
  for (const [project, works] of Object.entries(state.works)) {
    const backlog = state.chain.projects[project]?.backlog ?? []
    for (const task of Object.keys(works)) {
      const work = shownWork(state, project, task)
      if (work !== null) events.push({ key: `work|${project}|${task}`, kind: 'work', project, task, path: work.path, files: work.files, ahead: work.ahead, backlog: backlog.includes(task) })
    }
  }
  return events
}

/** The events not among the keys of the last state; `seen` is `null` before the first state, whose events are old news. */
export function freshEvents(seen: ReadonlySet<string> | null, events: PageEvent[]): PageEvent[] {
  return seen === null ? [] : events.filter((each) => !seen.has(each.key))
}
