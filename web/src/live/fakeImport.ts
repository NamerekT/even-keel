import { fail, notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import type { ImportAuthorChoice, ImportPlan, ImportPlanAuthor, ImportPlanning, ImportState, ImportSwitching } from '../../../src/tracker/import-plan.js'
import { importedStatus } from '../../../src/tracker/import-plan.js'
import type { TransferCheck, TransferReport } from '../../../src/tracker/transfer-check.js'

/**
 * `builtin/import/*` of the fake (BTN-1406), for a project on Huly (ABC): the import of its whole history, a task through
 * a step each `STEP_MS` while the page polls, as `runImport` goes, then its check, a task a step. `?import=` —
 * `checking`: the run is through and its check stands at 40 % (BTN-1461); `refused`: the plan refuses a project
 * that was on the built-in tracker; `running`: an import runs from the start; `failed`: it stopped at the attachments
 * step; `done`: it is through and the switch waits; `held`: through, the switch refused while the chain runs;
 * `mismatch`: through, its check short of two attachments until "Repeat"; `switching`: through, and its switch goes on —
 * the last pass over three changed tasks, the check of every task, then the move, a task each `STEP_MS`; `reading`: the
 * plan's read stands at 40 % (BTN-1452); `gone`: through, its check matched with an attachment Huly has no file of;
 * `lost`: an import runs, and the state's reads after the first fail for a while, as a proxy's 502 (BTN-1456).
 */
const STEP_MS = 300
const STEPS = 4
const FAIL_AT = { step: 2, done: 3 }

interface Run {
  startedAt: number
  from: number
  failAt: number | null
  short: boolean
  /** The step it stands at for a shot; absent — it goes on to the end. */
  stand?: number
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
    case 'builtin/import/plan': {
      if (mode === 'refused') throw fail('import.hadBuiltin', {})
      // One read for the window: an ask while it goes waits for it, an ask after it answers at once.
      planRead ??= Date.now()
      const left = planRead + readMsOf(mode) * total - Date.now()
      const plan = () => planOf(tasks, choicesOf(body))
      return { state, result: left <= 0 ? plan() : new Promise((resolve) => setTimeout(() => resolve(plan()), left)) }
    }
    case 'builtin/import/start': {
      // The first start keeps the picks; "Continue" and "Repeat" go on with them.
      if (run === null) authors = choicesOf(body)
      const ticks = run === null ? 0 : progressOf(run, total).ticks
      const failAt = FAIL_AT.step * total + FAIL_AT.done
      // A finished import passes again from its last step and is checked again: the repeat brings the two attachments over.
      const from = ticks >= STEPS * total ? (STEPS - 1) * total : ticks
      run = { startedAt: Date.now(), from, failAt: mode === 'failed' && ticks < failAt ? failAt : null, short: false }
      planRead = null
      return { state, result: stateOf(total, ids, mode) }
    }
    case 'builtin/import/state':
      if (mode === 'lost' && lostOf()) throw new Error('/api/builtin/import/state answered 502')
      return { state, result: stateOf(total, ids, mode) }
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
      planRead = null
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
  if (mode === 'running' || mode === 'lost') run = { startedAt: now, from: 0, failAt: null, short: false }
  if (mode === 'failed') run = { startedAt: now, from: failAt, failAt, short: false }
  if (mode === 'done' || mode === 'held' || mode === 'mismatch' || mode === 'switching' || mode === 'gone') run = { startedAt: now, from: (STEPS + 1) * total, failAt: null, short: mode === 'mismatch' }
  if (mode === 'checking') {
    const stand = STEPS * total + Math.round(total * CHECK_STAND)
    run = { startedAt: now, from: stand, failAt: null, short: false, stand }
  }
  gone = mode === 'gone'
  switchStarted = mode === 'switching' ? now : null
}

let switchStarted: number | null = null
const CHANGED = 3

/** `?import=lost`: when the state's reads began to fail; they fail `LOST_MS` from the second one, then answer again. */
let lostFrom: number | null = null
let stateReads = 0
const LOST_MS = 8_000
function lostOf(): boolean {
  stateReads += 1
  if (stateReads === 1) return false
  lostFrom ??= Date.now()
  return Date.now() - lostFrom < LOST_MS
}

/** When the plan's read began; `null` — none yet. A task takes `READ_MS`, with `?import=reading` `SLOW_READ_MS`. */
let planRead: number | null = null
const READ_MS = 120
const SLOW_READ_MS = 60_000
const readMsOf = (mode: string | null) => (mode === 'reading' ? SLOW_READ_MS : READ_MS)

/** The plan's read as the service reports it while it goes; with `?import=reading` it stands at 40 % for a shot. */
function planningOf(total: number, mode: string | null): ImportPlanning | null {
  if (planRead === null) return null
  const done = Math.floor((Date.now() - planRead) / readMsOf(mode))
  if (done >= total) return null
  return { done: mode === 'reading' ? Math.min(total - 1, Math.round(total * 0.4)) : done, total }
}

/** The check after a run, a task a step after the run's last step (BTN-1461); with `?import=checking` it stands at 40 %. */
const CHECK_STAND = 0.4

/** The fake's switch as the service reports it while it goes: it stays at the move once there. */
function switchingOf(total: number): ImportSwitching | null {
  if (switchStarted === null) return null
  const ticks = Math.floor((Date.now() - switchStarted) / STEP_MS)
  if (ticks < CHANGED) return { stage: 'pass', done: ticks, total: CHANGED }
  if (ticks < CHANGED + total) return { stage: 'check', done: ticks - CHANGED, total }
  return { stage: 'switch', done: 0, total: 0 }
}

/** `ticks` — the run's steps through; `checked` — the check's tasks through after them; `finished` — the check is too. */
function progressOf(current: Run, total: number) {
  const moved = STEPS * total
  const end = moved + total
  const reached = current.from + Math.floor((Date.now() - current.startedAt) / STEP_MS)
  const all = Math.min(reached, current.failAt ?? end, current.stand ?? end, end)
  const ticks = Math.min(all, moved)
  return { ticks, checked: Math.max(0, all - moved), failed: current.failAt !== null && reached >= current.failAt, moved: ticks >= moved, finished: all >= end }
}

function stateOf(total: number, ids: string[], mode: string | null): ImportState {
  const none = { tasks: 0, created: 0, linked: 0, attached: 0, journaled: 0, done: 0 }
  const base = { authors, checkFailed: null, total, switching: switchingOf(total), planning: planningOf(total, mode) }
  if (run === null) return { ...base, from: null, running: false, startedAt: null, finishedAt: null, progress: none, failed: null, check: null, checking: null }
  const { ticks, checked, failed, moved, finished } = progressOf(run, total)
  const through = (step: number) => Math.max(0, Math.min(total, ticks - step * total))
  const created = through(0)
  return {
    ...base,
    from: { tracker: 'huly', place: '', key: 'ABC' },
    running: !failed && !finished,
    startedAt: new Date(run.startedAt).toISOString(),
    finishedAt: moved ? new Date().toISOString() : null,
    progress: { tasks: Math.min(total, created + (failed || moved ? 0 : 1)), created, linked: through(1), attached: through(2), journaled: through(3), done: through(3) },
    failed: failed ? failedAt(ids[FAIL_AT.done] ?? 'ABC-1') : null,
    check: finished ? checkOf(total, ids, run.short) : null,
    checking: moved && !finished ? { done: checked, total } : null,
  }
}

/** `?import=failed`: the stop on a task's attachment, the task a link to Huly, the reason a blank storage error's class and status (BTN-1455). */
const failedAt = (task: string) =>
  notice(
    'import.failed',
    { tracker: 'Huly' },
    {
      cause: notice('transfer.stop', { stage: 'attach', task, item: { kind: 'file', name: 'machines.png' }, url: `https://huly.example.com/browse/${task}` }),
      detail: 'StorageError (HTTP 503)',
    },
  )

/** `?import=gone`: the source has no file of one attachment, and the check names it under the table (BTN-1454). */
let gone = false

function checkOf(total: number, ids: string[], short: boolean): TransferCheck {
  const files = Math.ceil(total / 3)
  const row = (kind: TransferCheck['rows'][number]['kind'], count: number) => ({ kind, source: count, target: count, tasks: [] })
  const missing = gone ? { gone: [{ task: ids[0] ?? 'ABC-1', name: 'screenshot.png' }] } : {}
  return {
    at: new Date().toISOString(),
    rows: [
      row('tasks', total),
      row('comments', total * 4 + 3),
      row('history', total * 9),
      { kind: 'files', source: files, target: short ? Math.max(0, files - 2) : files, tasks: short ? ids.slice(0, 2) : [], ...missing },
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
      { kind: 'milestones', tasks: [], names: ['closedAt'] },
    ],
    authors: AUTHORS.map((each) => ({ ...each, as: choices.find((choice) => choice.kind === each.kind && choice.name === each.name)?.as ?? each.kind })),
  }
}

/** The authors of the fake's tracker, the most first: the agent without a name, the person of the page, two others. */
const AUTHORS: Omit<ImportPlanAuthor, 'as'>[] = [
  { kind: 'agent', name: null, tasks: 9, comments: 41, changes: 203 },
  { kind: 'user', name: 'John Doe', tasks: 36, comments: 17, changes: 28 },
  { kind: 'person', name: 'Jane Roe', tasks: 2, comments: 6, changes: 17 },
  { kind: 'person', name: 'Alex Smith-Montgomery of the Infrastructure Team', tasks: 0, comments: 2, changes: 3 },
]

/** The picks of `builtin/import/plan` and `start`, unchecked: the fake trusts its page. */
const choicesOf = (body: Record<string, unknown>): ImportAuthorChoice[] => (Array.isArray(body.authors) ? (body.authors as ImportAuthorChoice[]) : [])
