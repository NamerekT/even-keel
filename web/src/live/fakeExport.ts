import type { ExportState } from '../../../src/tracker/export.js'
import type { ExportTargetFields } from '../../../src/tracker/export.js'
import { fail, notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import type { TaskCard, TaskRef } from '../../../src/tracker/card.js'
import type { ExportPlan } from '../../../src/tracker/export.js'
import { GITHUB_PROFILE } from './fakeProfiles.js'

/**
 * `builtin/export/*` of the fake (BTN-1075), with `?tracker=builtin`: a copy that takes a task each `STEP_MS` while the
 * page polls. `?export=` — `clean`: the plan loses nothing; `prefix`: the plan refuses the key as the project's own;
 * `running`: a copy runs from the start; `failed`: it stopped on a refused write; `done`: it is through and the switch
 * waits; `held`: through, and the switch is refused while the chain runs and holds a task.
 */
const STEP_MS = 900
const FAIL_AT = 3

interface Run {
  target: ExportTargetFields
  startedAt: number
  /** Tasks marked before this run: a continued copy goes on from them. */
  from: number
  /** The run stops at this many, failed; `null` — it goes to the end. */
  failAt: number | null
}

let run: Run | null = null
let seeded = false

type Answer = { state: EvenKeelState; result: unknown; refusal?: Error }

export function fakeExportQuery(state: EvenKeelState, name: string, body: Record<string, unknown>, mode: string | null): Answer | null {
  if (!name.startsWith('builtin/export/')) return null
  const project = String(body.project ?? '')
  const tasks = openTasks(state, project)
  seed(mode, tasks.length)
  switch (name) {
    case 'builtin/export/plan':
      if (mode === 'prefix') throw fail('switch.samePrefix', { prefix: String(body.key ?? '') })
      return { state, result: plan(tasks, mode) }
    case 'builtin/export/start': {
      const target = { profile: String(body.profile), place: String(body.place ?? ''), key: String(body.key) }
      const marked = run === null ? 0 : progressOf(run, tasks.length).marked
      run = { target, startedAt: Date.now(), from: marked, failAt: mode === 'failed' && marked < FAIL_AT ? FAIL_AT : null }
      return { state, result: stateOf(tasks.length) }
    }
    case 'builtin/export/state':
      return { state, result: stateOf(tasks.length) }
    case 'builtin/export/switch': {
      if (mode === 'held') {
        throw fail('switch.held', { key: project }, { items: [notice('switch.chainRuns', {}), notice('switch.current', { task: tasks[0]?.id ?? `${project}-1` })] })
      }
      const target = run?.target
      if (target === undefined) throw fail('switch.noCopy', { key: project })
      const kind = state.profiles.profiles.find((each) => each.id === target.profile)?.kind ?? 'huly'
      run = null
      seeded = false
      const form = state.config.projects[project]
      const projects = form === undefined ? state.config.projects : { ...state.config.projects, [project]: { ...form, tracker: kind, trackerProject: target.place === '' ? null : target.place } }
      return { state: { ...state, config: { ...state.config, projects } }, result: { tracker: kind, key: target.key, renamed: tasks.length } }
    }
    default:
      return null
  }
}

/** `?card=builtin&export=done`: the card's parent and related tasks were copied, so each says where it went. */
export function withMovedRefs(card: TaskCard | null, mode: string | null): TaskCard | null {
  if (card === null || mode !== 'done') return card
  const moved = (ref: TaskRef): TaskRef => ({ ...ref, moved: { key: ref.id.replace(/^[A-Z]+-/, 'ABCGH-'), url: 'https://github.com/octo-org/example/issues/1' } })
  return { ...card, parent: card.parent === null ? null : moved(card.parent), related: card.related.map(moved) }
}

function openTasks(state: EvenKeelState, project: string) {
  return state.tasks.filter((each) => each.project === project && each.parent === null && each.status.category !== 'Won' && each.status.category !== 'Lost')
}

/** The modes that open on a copy already made. */
function seed(mode: string | null, total: number): void {
  if (seeded) return
  seeded = true
  const target = { profile: GITHUB_PROFILE, place: 'octo-org/example', key: 'ABCGH' }
  if (mode === 'running') run = { target, startedAt: Date.now(), from: 0, failAt: null }
  if (mode === 'failed') run = { target, startedAt: Date.now() - FAIL_AT * STEP_MS, from: 0, failAt: FAIL_AT }
  if (mode === 'done' || mode === 'held') run = { target, startedAt: Date.now() - (total + 1) * STEP_MS, from: 0, failAt: null }
}

function progressOf(current: Run, total: number) {
  const reached = current.from + Math.floor((Date.now() - current.startedAt) / STEP_MS)
  const marked = Math.min(reached, current.failAt ?? total, total)
  return { marked, failed: current.failAt !== null && reached >= current.failAt, finished: marked >= total }
}

function stateOf(total: number): ExportState {
  const none = { tasks: 0, created: 0, linked: 0, attached: 0, journaled: 0, marked: 0 }
  if (run === null) return { target: null, running: false, startedAt: null, finishedAt: null, progress: none, total, failed: null }
  const { marked, failed, finished } = progressOf(run, total)
  const taken = Math.min(total, marked + (failed || finished ? 0 : 1))
  return {
    target: run.target,
    running: !failed && !finished,
    startedAt: new Date(run.startedAt).toISOString(),
    finishedAt: finished ? new Date().toISOString() : null,
    progress: { tasks: taken, created: taken, linked: marked, attached: marked, journaled: marked, marked },
    total,
    failed: failed ? notice('export.failed', { tracker: 'GitHub' }, { detail: 'HTTP 502 Bad Gateway' }) : null,
  }
}

function plan(tasks: EvenKeelState['tasks'], mode: string | null): ExportPlan {
  const ids = tasks.map((each) => each.id)
  const losses: ExportPlan['losses'] =
    mode === 'clean'
      ? []
      : [
          { kind: 'labels', tasks: ids.slice(0, 3), names: ['UI', 'Docs'] },
          { kind: 'milestones', tasks: ids.slice(0, 2), names: ['v0.4 — выпуск'] },
          { kind: 'priority', tasks: ids.slice(1, 5), names: [] },
          { kind: 'links', tasks: ids.slice(0, 1), names: [] },
        ]
  return { tasks: tasks.map((each) => ({ id: each.id, title: each.title, status: 'Open' })), losses }
}
