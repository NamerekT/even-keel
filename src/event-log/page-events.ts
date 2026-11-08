import type { EvenKeelState } from '../state.js'
import { pushStatus, type CiKind } from '../ci/model.js'
import { isCarryName } from '../chain/fix.js'
import { shownWork, type WorkInput } from '../shown-work.js'

export type EventsInput = Pick<EvenKeelState, 'ci' | 'fixes' | 'forwards'> &
  WorkInput & {
    chain: Pick<EvenKeelState['chain'], 'active'>
    config: {
      shared: { ci: { guard: boolean; kinds: readonly CiKind[] } }
      projects: Record<string, { ci: { guard: boolean; kinds: readonly CiKind[] } }>
    }
  }

/**
 * Something that waits for a person, an entry of the event log when it comes (BTN-350): a chain held by the usage limit,
 * a red main, a session that asks, a carry of a release held by a conflict, work left in the folder of a task out of
 * the chain. `key` tells one occurrence from the next; the service reads them, the page only shows the log.
 */
export type PageEvent =
  | { key: string; kind: 'limit'; project: string; until?: string }
  | { key: string; kind: 'red'; project: string; cis: CiKind[]; commit: string }
  | { key: string; kind: 'ciRed'; project: string; cis: CiKind[]; commit: string }
  | { key: string; kind: 'ask'; project: string | null; task: string }
  | { key: string; kind: 'conflict'; project: string; into: string }
  | { key: string; kind: 'work'; project: string; task: string; path: string; files: number; ahead: number; backlog: boolean }

const short = (commit: string) => commit.slice(0, 7)

export function pageEvents(state: EventsInput): PageEvent[] {
  const events: PageEvent[] = []
  const red = (project: string, commit: string, blocks = true, ci?: CiKind) => {
    const key = `red|${project}|${short(commit)}`
    const existing = events.find((each) => each.key === key)
    if (existing?.kind === 'red' || existing?.kind === 'ciRed') {
      if (blocks) existing.kind = 'red'
      if (ci !== undefined && !existing.cis.includes(ci)) existing.cis.push(ci)
    } else events.push({ key, kind: blocks ? 'red' : 'ciRed', project, cis: ci === undefined ? [] : [ci], commit: short(commit) })
  }
  for (const chain of state.chain.active) {
    const { project, error } = chain
    if (chain.limitUntil !== undefined) events.push({ key: `limit|${project}|${chain.limitUntil}`, kind: 'limit', project, until: chain.limitUntil })
    else if (chain.modelWeek !== undefined) events.push({ key: `limit|${project}|model:${chain.modelWeek.model}`, kind: 'limit', project })
    else if (chain.paused && error?.code === 'chain.limitSpent') events.push({ key: `limit|${project}|${error.params.until}`, kind: 'limit', project })
    if (chain.paused && error !== null && /^(ci|check)\./.test(error.code) && 'commit' in error.params) red(project, String(error.params.commit))
  }
  for (const [project, views] of Object.entries(state.ci)) {
    const settings = state.config.projects[project]?.ci ?? state.config.shared.ci
    for (const view of views) {
      const current = view.current
      if (current === null || pushStatus(current.runs.map((each) => each.run)) !== 'failure') continue
      red(project, current.commit, settings.guard && settings.kinds.includes(view.kind), view.kind)
    }
  }
  for (const [project, episodes] of Object.entries(state.fixes)) {
    // A carry's `red` is the head of the release it brings, not a red main (BTN-371).
    for (const open of episodes) if (open.end === null && open.red !== null && !isCarryName(open.id)) red(project, open.red)
  }
  for (const session of state.sessions) {
    if (!session.asking) continue
    const project = state.tasks.find((task) => task.id === session.task)?.project ?? null
    // A second question of the same session is an entry of its own.
    const ask = session.ask?.id === undefined ? '' : `|${session.ask.id}`
    events.push({ key: `ask|${session.sessionId}${ask}`, kind: 'ask', project, task: session.task })
  }
  for (const [project, forward] of Object.entries(state.forwards)) {
    if (forward.hold?.code === 'forward.conflict' && !forward.agent) events.push({ key: `conflict|${project}|${forward.into}`, kind: 'conflict', project, into: forward.into })
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
