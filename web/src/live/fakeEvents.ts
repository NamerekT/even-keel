import type { EventDraft, EventEntry } from '../../../src/event-log/model.js'
import { observe, watchedOf } from '../../../src/event-log/watch.js'
import { notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'

/** `?event=` comes this long after the first state, so the page sees it come and shows its toast (`EventToasts`). */
export const EVENT_MS = 2_000

/** The state after the event `?event=…` names, with the entries the service's log would write of it (BTN-350). */
export function fakeEvent(state: EvenKeelState, event: string): EvenKeelState {
  const next = changedBy(state, event)
  const now = new Date()
  const drafts = observe(observe(null, watchedOf(state), now).memory, watchedOf(next), now).drafts
  return { ...next, eventLog: [...next.eventLog, ...entriesOf(drafts, next.eventLog, now)] }
}

function entriesOf(drafts: EventDraft[], log: EventEntry[], now: Date): EventEntry[] {
  const last = Number(log.at(-1)?.id ?? 0)
  return drafts.map((draft, index) => ({ id: String(last + index + 1), at: now.toISOString(), ...draft }))
}

/** A day of the log: the chain, its launches, a red main and its fix, a question, the settings, a CLI to check. */
export function fakeEventLog(projects: string[]): EventEntry[] {
  const [first = 'ABC', second = 'DEMO'] = projects
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000)
  const drafts: [number, EventDraft][] = [
    [540, { level: 'info', notice: notice('eventLog.chainStarted', { project: first }), place: { view: 'project', project: first } }],
    [539, { level: 'info', notice: notice('eventLog.launch', { task: `${first}-1` }), place: { view: 'task', project: first, task: `${first}-1` } }],
    [470, { level: 'info', notice: notice('eventLog.projectSettings', { project: second }), place: { view: 'settings', project: second } }],
    [400, { level: 'error', notice: notice('eventLog.red', { project: first, commit: 'a1b2c3d', cis: ['github'] }), place: { view: 'ci', project: first } }],
    [398, { level: 'info', notice: notice('eventLog.stopped', { task: `${first}-2` }), place: { view: 'project', project: first } }],
    [
      310,
      {
        level: 'warning',
        notice: notice('agent.uncheckedVersion', { title: 'Claude Code', installed: '2.1.320', checked: '2.1.316' }),
        place: null,
      },
    ],
    [120, { level: 'warning', notice: notice('eventLog.ask', { task: `${second}-4` }), place: { view: 'ask', project: second, task: `${second}-4` } }],
    [
      45,
      {
        level: 'error',
        notice: notice('eventLog.chainHeld', { project: second }, { cause: notice('chain.empty', { project: second }) }),
        place: { view: 'project', project: second },
      },
    ],
    [12, { level: 'info', notice: notice('eventLog.settings', {}), place: { view: 'settings', project: null } }],
  ]
  return drafts.map(([minutes, draft], index) => ({ id: String(index + 1), at: ago(minutes).toISOString(), ...draft }))
}

/** The state after the event `?event=limit|red|ciRed|redBoth|ask|conflict|work` names; the first chain, CI, session and project get it. */
function changedBy(state: EvenKeelState, event: string): EvenKeelState {
  const [first, second] = state.projects
  if (event === 'limit') {
    const active = state.chain.active[0]
    if (active === undefined) return state
    const limited = { ...active, current: null, limitUntil: new Date(Date.now() + 95 * 60_000).toISOString() }
    return { ...state, chain: { ...state.chain, active: [limited, ...state.chain.active.slice(1)] } }
  }
  if (event === 'red' || event === 'ciRed' || event === 'redBoth') {
    const [project, views] = Object.entries(state.ci).find(([, each]) => each.some((view) => view.current !== null)) ?? []
    if (project === undefined || views === undefined) return state
    const at = views.findIndex((view) => view.current !== null && (event !== 'ciRed' || view.kind === 'github'))
    if (at < 0) return state
    const view = views[at]!
    const form = state.config.projects[project]!
    const config = { ...state.config, projects: { ...state.config.projects, [project]: { ...form, ci: { ...form.ci, kinds: ['forgejo' as const] } } } }
    const changed = views.map((each, index) => {
      if (each.current === null || (event !== 'redBoth' && index !== at)) return each
      return { ...each, current: { ...each.current, run: { ...each.current.run, commit: view.current!.run.commit, status: 'failure' as const } } }
    })
    return { ...state, config, ci: { ...state.ci, [project]: changed } }
  }
  if (event === 'ask') {
    const at = state.sessions.findIndex((session) => !session.asking)
    if (at < 0) return state
    return { ...state, sessions: state.sessions.map((session, index) => (index === at ? { ...session, asking: true, lamp: 'waiting' as const } : session)) }
  }
  if (event === 'conflict' && first !== undefined && second !== undefined) {
    const hold = notice('forward.conflict', { from: first, into: second, files: ['src/app.ts'] })
    return { ...state, forwards: { ...state.forwards, [first]: { into: second, behind: 2, hold, held: true } } }
  }
  if (event === 'work' && first !== undefined) {
    const task = state.chain.projects[first]?.backlog.find((id) => state.works[first]?.[id] === undefined)
    if (task === undefined) return state
    const work = { path: `D:/work/${first.toLowerCase()}/.claude/worktrees/${task.toLowerCase()}`, branch: `${task.toLowerCase()}/task`, files: 12, ahead: 0 }
    return { ...state, works: { ...state.works, [first]: { ...state.works[first], [task]: work } } }
  }
  return state
}
