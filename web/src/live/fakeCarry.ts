import { carryNameOf, fixEpisodeId, fixTaskOf } from '../../../src/chain/fix.js'
import { fail, notice } from '../../../src/notice/notice.js'
import type { EvenKeelState, SessionView } from '../../../src/state.js'

const FROM = 'XYZ'
const INTO = 'ABC'
const NAME = `${FROM}-CARRY`
const COMMIT = '3e7a1c9d5b2f4a6c8e0d1b3f5a7c9e2d4b6f8a0c'
const OUTPUT = [
  'Auto-merging CHANGELOG.md',
  'CONFLICT (content): Merge conflict in CHANGELOG.md',
  'Auto-merging src/app.ts',
  'CONFLICT (content): Merge conflict in src/app.ts',
  'Automatic merge failed; fix conflicts and then commit the result.',
].join('\n')

/**
 * `?forward=conflict|asked|agent|carried` (BTN-369): XYZ, taken for a release project of ABC, hit a conflict carrying
 * its commit into ABC; the agent's session is asked for after ABC's current task; it leads ABC's chain; it is over.
 */
export function withCarry(state: EvenKeelState, mode: string, carrying: SessionView, at: string): EvenKeelState {
  if (mode.startsWith('warnings') || mode === 'warning' || mode === 'empty') {
    const from = 'ABC'
    const into = 'DEMO'
    const variant = mode.slice('warnings-'.length)
    const count = mode === 'empty' ? 0 : mode === 'warning' ? 1 : 5
    const leftovers = Array.from({ length: count }, (_, index) => ({
      task: `${from}-${21 + index}`, at,
      notice: notice('cleanup.branchKept', { branch: `abc-${21 + index}/task` }, { detail: 'git sync: fatal: refusing to merge unrelated histories' }),
    }))
    let forward: EvenKeelState['forwards'][string] = { into, behind: 1, held: true, hold: notice('forward.conflict', { from, into, files: ['CHANGELOG.md', 'src/app.ts'] }, { detail: OUTPUT }) }
    if (variant === 'waiting') forward = { into, behind: 2, hold: null, held: false }
    if (variant === 'push') forward = { into, behind: 0, hold: null, held: false, last: { at, commits: 1, push: notice('cleanup.branchKept', { branch: 'release/v1' }) } }
    if (variant === 'held') forward = { into, behind: 1, hold: notice('forward.foreign', { from, into }), held: true }
    if (variant === 'agent') forward = { ...forward, agent: 'ABC-CARRY' }
    return {
      ...state,
      projectLabels: variant === 'long' ? { ...state.projectLabels, [into]: 'Application platform with a very long project name (DEMO)' } : state.projectLabels,
      forwards: { ...state.forwards, ...(mode === 'warning' || mode === 'empty' ? {} : { [from]: forward }) },
      chain: { ...state.chain, leftovers: { ...state.chain.leftovers, [from]: [...(state.chain.leftovers[from] ?? []), ...leftovers] } },
    }
  }
  const hold = notice('forward.conflict', { from: FROM, into: INTO, files: ['CHANGELOG.md', 'src/app.ts'] }, { detail: OUTPUT })
  const held = { into: INTO, behind: 1, hold, held: true }
  const episodes = state.fixes[INTO] ?? []
  const id = fixEpisodeId(NAME, episodes.filter((episode) => fixTaskOf(episode.id) === NAME).length + 1)
  const run = { sessionId: carrying.sessionId, at, how: 'launch' as const, resumed: 0, answers: 0, account: carrying.account }
  if (mode === 'conflict') return { ...state, forwards: { ...state.forwards, [FROM]: held } }
  if (mode === 'asked') return { ...state, forwards: { ...state.forwards, [FROM]: { ...held, agent: NAME } } }
  if (mode === 'agent') {
    const active = state.chain.active.map((chain) => (chain.project === INTO ? { ...chain, current: { task: NAME, sessionId: carrying.sessionId, since: at } } : chain))
    return {
      ...state,
      forwards: { ...state.forwards, [FROM]: { ...held, agent: NAME } },
      chain: { ...state.chain, active },
      sessions: [...state.sessions, { ...carrying, task: NAME, startedAt: at }],
      taskSessions: { ...state.taskSessions, [id]: [run] },
      fixes: { ...state.fixes, [INTO]: [...episodes, { id, red: COMMIT, at, end: null }] },
    }
  }
  if (mode === 'carried') {
    const end = { at, how: 'carried' as const, commit: null, commits: 1 }
    return {
      ...state,
      forwards: { ...state.forwards, [FROM]: { into: INTO, behind: 0, hold: null, held: false, last: { at, commits: 1, push: null } } },
      taskSessions: { ...state.taskSessions, [id]: [run] },
      fixes: { ...state.fixes, [INTO]: [...episodes, { id, red: COMMIT, at, end }] },
    }
  }
  return state
}

/** "Resolve with the agent" in `dev:fake`: the session is asked for after the current task. */
export function fakeResolve(state: EvenKeelState, from: string): EvenKeelState {
  const view = state.forwards[from]
  if (view === undefined || !view.held || view.hold?.code !== 'forward.conflict') throw fail('forward.noConflict', { from })
  return { ...state, forwards: { ...state.forwards, [from]: { ...view, agent: carryNameOf(state.projectKeys, from) } } }
}
