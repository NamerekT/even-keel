import { fail } from '../../../src/notice/notice.js'
import type { ChangelogKind, ChangelogSpend, ChangelogSpent, ChangelogVersion, ChangelogView, EvenKeelState } from '../../../src/state.js'
import { unaccounted } from '../changelog.js'
import { projectTasks } from '../state.js'

const WRITE_MS = 2500
const FILE = 'CHANGELOG.md'
const WRITTEN_MILESTONE = 'v0.1 — каркас'
const WRITTEN_TASKS = ['ABC-1', 'ABC-2']

const IN_FILE = `## [Unreleased]

### Added

- The server skeleton: a health route and the config loaded from the environment.
- Tasks are read from the tracker.`

const DRAFT = `## [Unreleased]

### Added

- The server skeleton: a health route and the config loaded from the environment.
- Tasks are read from the tracker, with their \`blocks\` relations.
- Sessions start in the background, one per task.

### Fixed

- A question asked right before a limit is no longer lost.`

/** The milestone that has a written version from the start, so the head's counter and "Add" show; the rest start empty. */
export function fakeWrittenChangelogs(): EvenKeelState['changelogs'] {
  return { ABC: { [WRITTEN_MILESTONE]: WRITTEN_TASKS } }
}

const versions = new Map<string, ChangelogVersion[]>()

function historyOf(project: string, milestone: string): ChangelogVersion[] {
  const key = `${project}\n${milestone}`
  let history = versions.get(key)
  if (history === undefined) {
    const written = project === 'ABC' && milestone === WRITTEN_MILESTONE
    history = written ? [version(project, milestone, 1, 'draft', IN_FILE, null, null, WRITTEN_TASKS, { at: ago(3 * 60), commit: '4f1c2a9e7b' })] : []
    versions.set(key, history)
  }
  return history
}

function version(
  project: string,
  milestone: string,
  number: number,
  kind: ChangelogKind,
  text: string,
  base: string | null,
  instruction: string | null,
  tasks: string[],
  written: ChangelogVersion['written'] = null,
): ChangelogVersion {
  // The written one stands for a version kept before its spend was; an edit costs less than a draft from all tasks.
  const spend: ChangelogSpend | null =
    written !== null
      ? null
      : {
          account: 'jane.roe',
          model: 'claude-sonnet-5-5',
          tokens: kind === 'edit' ? { input: 6, output: 900, cacheRead: 18_000, cacheWrite: 4_200 } : { input: 12, output: 2_600, cacheRead: 152_000, cacheWrite: 48_000 },
          cost: kind === 'edit' ? 0.04 : 0.42,
          durationMs: kind === 'edit' ? 11_000 : 29_000,
        }
  return { project, milestone, number, kind, text, base, instruction, tasks, open: 2, at: written?.at ?? new Date().toISOString(), written, spend }
}

function spentOf(history: ChangelogVersion[]): ChangelogSpent {
  const spent: ChangelogSpent = { turns: 0, cost: 0, unpriced: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
  for (const { spend } of history) {
    if (spend === null) continue
    spent.turns += 1
    spent.cost += spend.cost ?? 0
    spent.unpriced += spend.cost === null ? 1 : 0
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) spent.tokens[key] += spend.tokens[key]
  }
  return spent
}

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

/** An edit as the agent would make it: the first bullet reworded, the last line dropped. */
function edited(text: string): string {
  const lines = text.split('\n')
  const bullet = lines.findIndex((line) => line.startsWith('- '))
  if (bullet >= 0) lines[bullet] = lines[bullet]!.replace('The server skeleton', 'A server skeleton').replace(/\.$/, ', and a log of every request.')
  return lines.slice(0, -1).join('\n')
}

/**
 * `changelog/open|again|add|edit|write` → the milestone's newest version, kept in memory per project and milestone.
 * `?changelog=failed|empty|slow|dirty` — the agent fails, the milestone has no done task, writing never ends, the file is dirty.
 */
export async function fakeChangelog(state: EvenKeelState, name: string, body: Record<string, unknown>, param: string | null): Promise<ChangelogView | null> {
  if (!name.startsWith('changelog/')) return null
  const op = name.slice('changelog/'.length)
  const project = String(body.project)
  const milestone = String(body.milestone)
  const history = historyOf(project, milestone)
  const latest = history.at(-1) ?? null
  const view = (each: ChangelogVersion): ChangelogView => ({ project, milestone, file: FILE, released: null, version: each, spent: spentOf(history) })
  if (op === 'open' && latest !== null) return view(latest)
  if (op === 'write') {
    if (latest === null) throw fail('changelog.noDraft', { milestone })
    if (param === 'dirty') throw fail('changelog.dirty', { file: FILE })
    if (latest.written === null) history[history.length - 1] = { ...latest, written: { at: new Date().toISOString(), commit: 'b7d03e51c4' } }
    return view(history.at(-1)!)
  }
  if (param === 'slow') await new Promise(() => {})
  await new Promise((resolve) => setTimeout(resolve, WRITE_MS))
  if (param === 'failed') throw fail('changelog.failed', { project }, { detail: 'claude exited with 1' })
  const done = unaccounted(projectTasks(state, project), project, milestone, [])
  const next = (kind: ChangelogKind, text: string, base: string | null, instruction: string | null, tasks: string[]) => {
    history.push(version(project, milestone, history.length + 1, kind, text, base, instruction, tasks))
    return view(history.at(-1)!)
  }
  if (op === 'open' || op === 'again') {
    if (param === 'empty' || done.length === 0) throw fail('changelog.empty', { milestone })
    return next(op === 'open' ? 'draft' : 'again', DRAFT, op === 'open' ? null : (history.findLast((each) => each.written !== null)?.text ?? null), null, done)
  }
  if (latest === null) throw fail('changelog.noDraft', { milestone })
  if (op === 'edit') return next('edit', edited(latest.text), latest.text, String(body.instruction ?? ''), latest.tasks)
  const missing = unaccounted(projectTasks(state, project), project, milestone, latest.tasks)
  if (missing.length === 0) throw fail('changelog.nothingNew', { milestone })
  return next('add', `${latest.text}\n- Sessions start in the background, one per task.`, latest.text, null, [...latest.tasks, ...missing])
}
