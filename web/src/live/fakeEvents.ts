import { notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'

/** `?event=` comes this long after the first state, so the page sees it come and shows its toast (`EventToasts`). */
export const EVENT_MS = 2_000

/** The state after the event `?event=limit|red|ciRed|ask|conflict|work` names; the first chain, CI, session and project get it. */
export function fakeEvent(state: EvenKeelState, event: string): EvenKeelState {
  const [first, second] = state.projects
  if (event === 'limit') {
    const active = state.chain.active[0]
    if (active === undefined) return state
    const limited = { ...active, current: null, limitUntil: new Date(Date.now() + 95 * 60_000).toISOString() }
    return { ...state, chain: { ...state.chain, active: [limited, ...state.chain.active.slice(1)] } }
  }
  if (event === 'red' || event === 'ciRed') {
    const [project, views] = Object.entries(state.ci).find(([, each]) => each.some((view) => view.current !== null)) ?? []
    if (project === undefined || views === undefined) return state
    const at = views.findIndex((view) => view.current !== null && (event !== 'ciRed' || view.kind === 'github'))
    if (at < 0) return state
    const view = views[at]!
    const red = { ...view, current: { ...view.current!, run: { ...view.current!.run, status: 'failure' as const } } }
    const form = state.config.projects[project]!
    const config = event === 'ciRed'
      ? { ...state.config, projects: { ...state.config.projects, [project]: { ...form, ci: { ...form.ci, kinds: ['forgejo' as const] } } } }
      : state.config
    return { ...state, config, ci: { ...state.ci, [project]: views.map((each, index) => (index === at ? red : each)) } }
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
