import type { ExportState } from '../../../src/tracker/export.js'
import type { ExportTargetFields } from '../../../src/tracker/export.js'
import { fail, notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import type { TaskCard, TaskRef } from '../../../src/tracker/card.js'
import type { ExportPlan } from '../../../src/tracker/export.js'
import type { TransferCheck, TransferReport } from '../../../src/tracker/transfer-check.js'
import { GITHUB_PROFILE } from './fakeProfiles.js'

/**
 * `builtin/export/*` of the fake (BTN-1075), with `?tracker=builtin`: a copy that passes a task through a step each
 * `STEP_MS` while the page polls, every task through one step before the next one, as `runExport` goes. `?export=` —
 * `clean`: the plan loses nothing; `prefix`: the plan refuses the key as the project's own; `running`: a copy runs from
 * the start; `comments`: it runs at the comments step; `failed`: it stopped on a refused write at the attachments step;
 * `done`: it is through and the switch waits; `held`: through, and the switch is refused while the chain runs and holds a task;
 * `mismatch`: through, its check short of two attachments until "Repeat"; `reports`: the Tracker tab lists two transfers;
 * `waiting`: it runs at the comments step and stops a task later to wait out the tracker's limit (BTN-1190).
 */
const STEP_MS = 300
const STEPS = 5
/** Where `failed` stops and `comments` starts: a step (from 0) and the tasks through it. */
const FAIL_AT = { step: 2, done: 3 }
const COMMENTS_AT = { step: 3, done: 2 }

interface Run {
  target: ExportTargetFields
  startedAt: number
  /** Ticks before this run, a task through a step each: a continued copy goes on from them. */
  from: number
  /** The run stops at this many ticks, failed; `null` — it goes to the end. */
  failAt: number | null
  /** Its check misses two attachments (`?export=mismatch`) until a repeat. */
  short: boolean
  /** At this many ticks it waits for the tracker's limit and goes no further (`?export=waiting`). */
  waitAt?: number
}

/** How long `?export=waiting` waits, from the run's start. */
const WAIT_MS = 12 * 60_000

const tickOf = (at: { step: number; done: number }, total: number) => at.step * total + at.done

let run: Run | null = null
let seeded = false
const reports: TransferReport[] = []

/** A switched transfer of the other direction (`fakeImport.ts`), listed with these. */
export function addFakeReport(report: TransferReport): void {
  reports.unshift(report)
}

type Answer = { state: EvenKeelState; result: unknown; refusal?: Error }

export function fakeExportQuery(state: EvenKeelState, name: string, body: Record<string, unknown>, mode: string | null): Answer | null {
  if (name === 'builtin/transfer') return { state, result: { report: reports.find((each) => each.id === body.id) ?? null } }
  const project = String(body.project ?? '')
  const tasks = openTasks(state, project)
  const ids = tasks.map((each) => each.id)
  if (name === 'builtin/transfers') {
    seedReports(mode, project, tasks)
    const list = reports.filter((each) => each.project === project)
    return { state, result: { transfers: list.map((each) => ({ id: each.id, direction: each.direction, tracker: each.tracker, switchedAt: each.switchedAt, matched: each.matched, tasks: each.plan.counts.tasks })) } }
  }
  if (!name.startsWith('builtin/export/')) return null
  seed(mode, tasks.length)
  switch (name) {
    case 'builtin/export/plan':
      if (mode === 'prefix') throw fail('switch.samePrefix', { prefix: String(body.key ?? '') })
      // The closed tasks switch (BTN-1289) adds the project's closed tasks to the plan.
      return { state, result: body.closed === true ? plan(projectTasks(state, project), mode, true) : plan(tasks, mode) }
    case 'builtin/export/start': {
      const target = { profile: String(body.profile), place: String(body.place ?? ''), key: String(body.key), ...(body.closed === true ? { closed: true } : {}) }
      const ticks = run === null ? 0 : progressOf(run, tasks.length).ticks
      const failAt = tickOf(FAIL_AT, tasks.length)
      run = { target, startedAt: Date.now(), from: ticks, failAt: mode === 'failed' && ticks < failAt ? failAt : null, short: false }
      return { state, result: stateOf(tasks.length, ids) }
    }
    case 'builtin/export/retry':
      // The repeat brings the two attachments over: the check matches after it.
      if (run !== null) run = { ...run, startedAt: Date.now(), from: (STEPS - 1) * tasks.length, short: false }
      return { state, result: stateOf(tasks.length, ids) }
    case 'builtin/export/state':
      return { state, result: stateOf(tasks.length, ids) }
    case 'builtin/export/switch': {
      if (mode === 'held') {
        throw fail('switch.held', { key: project }, { items: [notice('switch.chainRuns', {}), notice('switch.current', { task: tasks[0]?.id ?? `${project}-1` })] })
      }
      const target = run?.target
      if (target === undefined) throw fail('switch.noCopy', { key: project })
      const kind = state.profiles.profiles.find((each) => each.id === target.profile)?.kind ?? 'huly'
      const check = checkOf(tasks.length, ids, run!.short)
      if (run!.short && body.anyway !== true) throw fail('switch.mismatch', {})
      const at = new Date().toISOString()
      reports.unshift({ id: `transfer-${reports.length + 1}`, project, direction: 'export', tracker: kind, place: target.place, key: target.key, sourceKey: project, closed: target.closed === true, history: false, startedAt: at, finishedAt: at, switchedAt: at, plan: plan(tasks, mode), check, matched: !run!.short })
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
  return projectTasks(state, project).filter((each) => each.status.category !== 'Won' && each.status.category !== 'Lost')
}

function projectTasks(state: EvenKeelState, project: string) {
  return state.tasks.filter((each) => each.project === project && each.parent === null)
}

/** The modes that open on a copy already made. */
function seed(mode: string | null, total: number): void {
  if (seeded) return
  seeded = true
  const target = { profile: GITHUB_PROFILE, place: 'octo-org/example', key: 'ABCGH' }
  const now = Date.now()
  if (mode === 'running') run = { target, startedAt: now, from: 0, failAt: null, short: false }
  if (mode === 'comments') run = { target, startedAt: now, from: tickOf(COMMENTS_AT, total), failAt: null, short: false }
  if (mode === 'waiting') run = { target, startedAt: now, from: tickOf(COMMENTS_AT, total), failAt: null, short: false, waitAt: tickOf(COMMENTS_AT, total) + 1 }
  if (mode === 'failed') run = { target, startedAt: now, from: tickOf(FAIL_AT, total), failAt: tickOf(FAIL_AT, total), short: false }
  if (mode === 'done' || mode === 'held' || mode === 'mismatch') run = { target, startedAt: now, from: STEPS * total, failAt: null, short: mode === 'mismatch' }
}

function progressOf(current: Run, total: number) {
  const reached = current.from + Math.floor((Date.now() - current.startedAt) / STEP_MS)
  const ticks = Math.min(reached, current.failAt ?? STEPS * total, current.waitAt ?? STEPS * total, STEPS * total)
  const waiting = current.waitAt !== undefined && reached >= current.waitAt
  return { ticks, failed: current.failAt !== null && reached >= current.failAt, finished: ticks >= STEPS * total, waiting }
}

function stateOf(total: number, ids: string[]): ExportState {
  const none = { tasks: 0, created: 0, linked: 0, attached: 0, journaled: 0, marked: 0 }
  if (run === null) return { target: null, running: false, startedAt: null, finishedAt: null, progress: none, total, failed: null, waiting: null, check: null, checkFailed: null }
  const { ticks, failed, finished, waiting } = progressOf(run, total)
  const through = (step: number) => Math.max(0, Math.min(total, ticks - step * total))
  const created = through(0)
  const taken = Math.min(total, created + (failed || finished ? 0 : 1))
  return {
    target: run.target,
    running: !failed && !finished,
    startedAt: new Date(run.startedAt).toISOString(),
    finishedAt: finished ? new Date().toISOString() : null,
    progress: { tasks: taken, created, linked: through(1), attached: through(2), journaled: through(3), marked: through(4) },
    total,
    failed: failed ? notice('export.failed', { tracker: 'GitHub' }, { detail: 'HTTP 502 Bad Gateway' }) : null,
    waiting: waiting ? new Date(run.startedAt + WAIT_MS).toISOString() : null,
    check: finished ? checkOf(total, ids, run.short) : null,
    checkFailed: null,
  }
}

/** The check of a finished copy; `short` — the attachments of two tasks did not come over. */
function checkOf(total: number, ids: string[], short: boolean): TransferCheck {
  const files = Math.ceil(total / 3)
  return {
    at: new Date().toISOString(),
    rows: [
      { kind: 'tasks', source: total, target: total, tasks: [] },
      { kind: 'comments', source: total * 3 + 2, target: total * 3 + 2, tasks: [] },
      { kind: 'files', source: files, target: short ? Math.max(0, files - 2) : files, tasks: short ? ids.slice(0, 2) : [] },
      { kind: 'links', source: Math.max(0, total - 2) + Math.floor(total / 2) + 1, target: Math.max(0, total - 2) + Math.floor(total / 2) + 1, tasks: [] },
      { kind: 'milestones', source: 2, target: 2, tasks: [] },
      { kind: 'labels', source: 5, target: 5, tasks: [] },
    ],
  }
}

/** `?export=reports`: the project moved twice before, the second time past a check that did not match. */
function seedReports(mode: string | null, project: string, tasks: EvenKeelState['tasks']): void {
  if (reports.length > 0 || mode !== 'reports') return
  const ids = tasks.map((each) => each.id)
  const base = { project, direction: 'export' as const, closed: false, history: false, sourceKey: 'ABC' }
  const total = tasks.length
  reports.push(
    {
      ...base,
      id: 'transfer-2',
      tracker: 'github',
      place: 'octo-org/example',
      key: 'ABCGH',
      startedAt: '2026-11-18T09:00:00.000Z',
      finishedAt: '2026-11-18T09:20:00.000Z',
      switchedAt: '2026-11-18T09:25:00.000Z',
      plan: plan(tasks, null),
      check: checkOf(total, ids, true),
      matched: false,
    },
    {
      ...base,
      id: 'transfer-1',
      tracker: 'huly',
      place: 'EXM',
      key: 'EXM',
      startedAt: '2026-11-02T09:00:00.000Z',
      finishedAt: '2026-11-02T09:10:00.000Z',
      switchedAt: '2026-11-02T09:12:00.000Z',
      plan: plan(tasks, 'clean'),
      check: checkOf(total, ids, false),
      matched: true,
    },
  )
}

function plan(tasks: EvenKeelState['tasks'], mode: string | null, closed = false): ExportPlan {
  const ids = tasks.map((each) => each.id)
  const losses: ExportPlan['losses'] =
    mode === 'clean'
      ? []
      : [
          { kind: 'labels', tasks: ids.slice(0, 3), names: ['UI', 'Docs'] },
          { kind: 'milestones', tasks: ids.slice(0, 2), names: ['v0.4 — выпуск'] },
          { kind: 'priority', tasks: ids.slice(1, 5), names: [] },
          // Links to closed tasks are lost only while the closed tasks stay behind (BTN-1289).
          ...(closed ? [] : [{ kind: 'links' as const, tasks: ids.slice(0, 1), names: [] }]),
          { kind: 'history', tasks: mode === 'long' ? ids : ids.slice(0, 6), names: [] },
        ]
  const open = { name: 'Open', category: 'ToDo' } as const
  const targetOf = (category: string) => (category === 'Won' ? ({ name: 'Done', category: 'Won' } as const) : category === 'Lost' ? ({ name: 'Canceled', category: 'Lost' } as const) : open)
  const statuses: ExportPlan['statuses'] = []
  for (const task of tasks) {
    const row = statuses.find((each) => each.name === task.status.name)
    if (row !== undefined) row.tasks += 1
    else statuses.push({ name: task.status.name, category: task.status.category, tasks: 1, target: targetOf(task.status.category) })
  }
  const order = ['UnStarted', 'ToDo', 'Active', 'Won', 'Lost']
  statuses.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
  const count = tasks.length
  return {
    tasks: tasks.map((each) => ({ id: each.id, title: each.title, status: targetOf(each.status.category).name })),
    counts: { tasks: count, comments: count * 3 + 2, files: Math.ceil(count / 3), blocks: Math.max(0, count - 2), relates: Math.floor(count / 2), subtasks: 1, milestones: 2, labels: 5 },
    statuses,
    losses,
  }
}
