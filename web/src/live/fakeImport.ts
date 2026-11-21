import { fail, notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import type { ImportAuthorChoice, ImportPlan, ImportPlanAuthor, ImportState, ImportSwitching } from '../../../src/tracker/import-plan.js'
import { importedStatus } from '../../../src/tracker/import-plan.js'
import type { TransferCheck, TransferReport } from '../../../src/tracker/transfer-check.js'

/**
 * `builtin/import/*` of the fake (BTN-1406), for a project on Huly (ABC): the import of its whole history, a task through
 * a step each `STEP_MS` while the page polls, as `runImport` goes. `?import=` — `refused`: the plan refuses a project
 * that was on the built-in tracker; `running`: an import runs from the start; `failed`: it stopped at the attachments
 * step; `done`: it is through and the switch waits; `held`: through, the switch refused while the chain runs;
 * `mismatch`: through, its check short of two attachments until "Repeat"; `switching`: through, and its switch goes on —
 * the last pass over three changed tasks, the check of every task, then the move, a task each `STEP_MS`.
 */
const STEP_MS = 300
const STEPS = 4
const FAIL_AT = { step: 2, done: 3 }

interface Run {
  startedAt: number
  from: number
  failAt: number | null
  short: boolean
}

let run: Run | null = null
let authors: ImportAuthorChoice[] = []
let seeded = false

type Answer = { state: EvenKeelState; result: unknown; refusal?: Error }

/** `report` — the switch's report, for the Tracker tab's "Transfers". */
export function fakeImportQuery(state: EvenKeelState, name: string, body: Record<string, unknown>, mode: string | null, report: (each: TransferReport) => void): Answer | null {
  if (!name.startsWith('builtin/import/')) return null
  const project = String(body.project ?? '')
  const tasks = state.tasks.filter((each) => each.project === project)
  const total = tasks.length
  const ids = tasks.map((each) => each.id)
  seed(mode, total)
  switch (name) {
    case 'builtin/import/plan':
      if (mode === 'refused') throw fail('import.hadBuiltin', {})
      return { state, result: planOf(tasks, choicesOf(body)) }
    case 'builtin/import/start': {
      // The first start keeps the picks; "Continue" and "Repeat" go on with them.
      if (run === null) authors = choicesOf(body)
      const ticks = run === null ? 0 : progressOf(run, total).ticks
      const failAt = FAIL_AT.step * total + FAIL_AT.done
      // A finished import passes again from its last step: the repeat brings the two attachments over.
      const from = ticks >= STEPS * total ? (STEPS - 1) * total : ticks
      run = { startedAt: Date.now(), from, failAt: mode === 'failed' && ticks < failAt ? failAt : null, short: false }
      return { state, result: stateOf(total, ids) }
    }
    case 'builtin/import/state':
      return { state, result: stateOf(total, ids) }
    case 'builtin/import/switch': {
      if (mode === 'held') throw fail('switch.held', { key: project }, { items: [notice('switch.chainRuns', {}), notice('switch.current', { task: ids[0] ?? `${project}-1` })] })
      if (run === null || !progressOf(run, total).finished) throw fail('import.notFinished', {})
      const check = checkOf(total, ids, run.short)
      if (run.short && body.anyway !== true) throw fail('switch.mismatch', {})
      const at = new Date().toISOString()
      const key = state.projectKeys[project] ?? project
      report({ id: `import-${Date.now()}`, project, direction: 'import', tracker: 'huly', place: key, key, sourceKey: key, closed: true, history: true, startedAt: at, finishedAt: at, switchedAt: at, plan: planOf(tasks, authors), check, matched: !run.short })
      run = null
      authors = []
      seeded = false
      const form = state.config.projects[project]
      const projects = form === undefined ? state.config.projects : { ...state.config.projects, [project]: { ...form, tracker: 'builtin', trackerProject: null } }
      return { state: { ...state, config: { ...state.config, projects } }, result: { key, renamed: 0 } }
    }
    default:
      return null
  }
}

function seed(mode: string | null, total: number): void {
  if (seeded) return
  seeded = true
  const now = Date.now()
  const failAt = FAIL_AT.step * total + FAIL_AT.done
  if (mode === 'running') run = { startedAt: now, from: 0, failAt: null, short: false }
  if (mode === 'failed') run = { startedAt: now, from: failAt, failAt, short: false }
  if (mode === 'done' || mode === 'held' || mode === 'mismatch' || mode === 'switching') run = { startedAt: now, from: STEPS * total, failAt: null, short: mode === 'mismatch' }
  switchStarted = mode === 'switching' ? now : null
}

let switchStarted: number | null = null
const CHANGED = 3

/** The fake's switch as the service reports it while it goes: it stays at the move once there. */
function switchingOf(total: number): ImportSwitching | null {
  if (switchStarted === null) return null
  const ticks = Math.floor((Date.now() - switchStarted) / STEP_MS)
  if (ticks < CHANGED) return { stage: 'pass', done: ticks, total: CHANGED }
  if (ticks < CHANGED + total) return { stage: 'check', done: ticks - CHANGED, total }
  return { stage: 'switch', done: 0, total: 0 }
}

function progressOf(current: Run, total: number) {
  const reached = current.from + Math.floor((Date.now() - current.startedAt) / STEP_MS)
  const ticks = Math.min(reached, current.failAt ?? STEPS * total, STEPS * total)
  return { ticks, failed: current.failAt !== null && reached >= current.failAt, finished: ticks >= STEPS * total }
}

function stateOf(total: number, ids: string[]): ImportState {
  const none = { tasks: 0, created: 0, linked: 0, attached: 0, journaled: 0, done: 0 }
  const base = { authors, checkFailed: null, total, switching: switchingOf(total) }
  if (run === null) return { ...base, from: null, running: false, startedAt: null, finishedAt: null, progress: none, failed: null, check: null }
  const { ticks, failed, finished } = progressOf(run, total)
  const through = (step: number) => Math.max(0, Math.min(total, ticks - step * total))
  const created = through(0)
  return {
    ...base,
    from: { tracker: 'huly', place: '', key: 'ABC' },
    running: !failed && !finished,
    startedAt: new Date(run.startedAt).toISOString(),
    finishedAt: finished ? new Date().toISOString() : null,
    progress: { tasks: Math.min(total, created + (failed || finished ? 0 : 1)), created, linked: through(1), attached: through(2), journaled: through(3), done: through(3) },
    failed: failed ? notice('import.failed', { tracker: 'Huly' }, { detail: 'connection reset while reading a file' }) : null,
    check: finished ? checkOf(total, ids, run.short) : null,
  }
}

function checkOf(total: number, ids: string[], short: boolean): TransferCheck {
  const files = Math.ceil(total / 3)
  const row = (kind: TransferCheck['rows'][number]['kind'], count: number) => ({ kind, source: count, target: count, tasks: [] })
  return {
    at: new Date().toISOString(),
    rows: [
      row('tasks', total),
      row('comments', total * 4 + 3),
      row('history', total * 9),
      { kind: 'files', source: files, target: short ? Math.max(0, files - 2) : files, tasks: short ? ids.slice(0, 2) : [] },
      row('links', Math.max(0, total - 2) + Math.floor(total / 2)),
      row('milestones', 3),
      row('labels', 6),
      row('components', 4),
    ],
  }
}

function planOf(tasks: EvenKeelState['tasks'], choices: readonly ImportAuthorChoice[]): ImportPlan {
  const ids = tasks.map((each) => each.id)
  const statuses: ImportPlan['statuses'] = []
  for (const task of tasks) {
    const row = statuses.find((each) => each.name === task.status.name)
    if (row !== undefined) row.tasks += 1
    else statuses.push({ name: task.status.name, category: task.status.category, tasks: 1, target: importedStatus(task.status) })
  }
  const order = ['UnStarted', 'ToDo', 'Active', 'Won', 'Lost']
  statuses.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
  const count = tasks.length
  return {
    tasks: tasks.map((each) => ({ id: each.id, title: each.title, status: importedStatus(each.status).name })),
    counts: { tasks: count, comments: count * 4 + 3, changes: count * 9, files: Math.ceil(count / 3), blocks: Math.max(0, count - 2), relates: Math.floor(count / 2), subtasks: 0, milestones: 3, labels: 6, components: 4 },
    statuses,
    losses: [
      { kind: 'links', tasks: ids.slice(0, 2), names: ['OPS-4', 'OPS-9'] },
      { kind: 'timeReports', tasks: [], names: [] },
    ],
    authors: AUTHORS.map((each) => ({ ...each, as: choices.find((choice) => choice.kind === each.kind && choice.name === each.name)?.as ?? each.kind })),
  }
}

/** The authors of the fake's tracker, the most first: the agent without a name, the person of the page, two others. */
const AUTHORS: Omit<ImportPlanAuthor, 'as'>[] = [
  { kind: 'agent', name: null, comments: 41, changes: 212 },
  { kind: 'user', name: 'John Doe', comments: 17, changes: 64 },
  { kind: 'person', name: 'Jane Roe', comments: 6, changes: 19 },
  { kind: 'person', name: 'Alex Smith-Montgomery of the Infrastructure Team', comments: 2, changes: 3 },
]

/** The picks of `builtin/import/plan` and `start`, unchecked: the fake trusts its page. */
const choicesOf = (body: Record<string, unknown>): ImportAuthorChoice[] => (Array.isArray(body.authors) ? (body.authors as ImportAuthorChoice[]) : [])
