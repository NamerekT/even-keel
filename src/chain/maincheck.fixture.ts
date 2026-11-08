import type { CiRun } from '../ci/model.js'
import type { CiVerdict, RedRun } from '../ci/verdict.js'
import type { EventDraft } from '../event-log/model.js'
import type { NewTask } from '../tracker/source.js'
import { done, setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { fixName } from './fix.js'
import type { AfterGreenRun, MainCheckDeps, MainCheckRun, MainFailure, MainPush } from './model.js'

export const failedRun: CiRun = {
  id: 7,
  number: 7,
  title: 'Merge',
  workflow: 'test.yml',
  commit: 'bbbbbbbbbb',
  status: 'failure',
  createdAt: '2026-09-26T12:00:05Z',
  startedAt: '2026-09-26T12:00:10Z',
  stoppedAt: '2026-09-26T12:02:00Z',
  url: 'https://ci.example.com/runs/7',
}

/** Main moves to the next of `heads` on every push; a commit's tree is `tree-<commit>` unless `trees` says otherwise. */
export function fakeMain(wait: number | null = null) {
  const heads = ['bbbbbbbbbb', 'cccccccccc', 'dddddddddd']
  const ci = {
    verdict: { state: 'pending' } as CiVerdict,
    wait,
    created: [] as Omit<NewTask, 'project'>[],
    comments: [] as { task: string; body: string }[],
    prepared: [] as string[],
    reports: [] as { push: MainPush; failure: MainFailure; greens: string[] }[],
    canCreate: true,
    next: 9,
    /** Branch trees by task; a task missing here has no branch. */
    taskTrees: {} as Record<string, string>,
    trees: {} as Record<string, string>,
    commands: [] as string[],
    recheck: true,
    /** The project's check on main, by the commit it runs on; green when missing. */
    runs: {} as Record<string, MainCheckRun>,
    checked: [] as string[],
    /** `ci.fixTask`: off — a session without a task fixes a red main. */
    fixTask: true,
    /** Tasks and fix sessions whose branch is in main. */
    merged: new Set<string>(),
    /** Whether the project has `commands.afterGreen`. */
    afterGreen: false,
    /** How the run of `commands.afterGreen` on a commit ends; done when missing, a promise holds it. */
    afterRuns: {} as Record<string, AfterGreenRun | Promise<AfterGreenRun>>,
    ran: [] as string[],
    /** The other projects of a project's remote and main branch (BTN-217); none when missing. */
    peers: {} as Record<string, string[]>,
    /** The remote's main the counted CIs of each project see (BTN-707); none when missing. */
    remote: {} as Record<string, string>,
    /** The projects whose CIs the chain asked to look again, a call per step. */
    looks: [] as string[],
    /** `ci.rerunFailed` (BTN-846); off here, so the tests before it see a red at once. */
    rerunFailed: false,
    /** The failed runs of each rerun asked for. */
    reruns: [] as RedRun[][],
    /** Thrown by a rerun; `null` — it starts. */
    rerunError: null as unknown,
    events: [] as EventDraft[],
  }
  const deps: MainCheckDeps = {
    peers: (project) => ci.peers[project] ?? [],
    head: async () => heads.shift() ?? null,
    verdict: () => ci.verdict,
    lookAgain: (project) => {
      ci.looks.push(project)
    },
    rerunFailed: () => ci.rerunFailed,
    rerun: async (_project, failed) => {
      ci.reruns.push(failed)
      if (ci.rerunError !== null) throw ci.rerunError
    },
    event: (draft) => {
      ci.events.push(draft)
    },
    remoteHeads: () => ({ ...ci.remote }),
    waitMs: () => ci.wait,
    report: async (_project, push, failure, greens) => {
      ci.reports.push({ push: structuredClone(push), failure, greens })
      return { title: `CI on main failed: ${push.commit.slice(0, 7)}`, description: 'log', comment: 'more log', prompt: 'fix main: log' }
    },
    create: async (_project, created) => {
      if (!ci.canCreate) return null
      ci.created.push(created)
      return `ABC-${ci.next++}`
    },
    comment: async (id, body) => {
      ci.comments.push({ task: id, body })
    },
    prepare: async (project, id) => {
      ci.prepared.push(`${project}/${id}`)
    },
    taskTree: async (_project, id) => ci.taskTrees[id] ?? null,
    tree: async (_project, commit) => ci.trees[commit] ?? `tree-${commit}`,
    checking: () => ({ commands: ci.commands, recheck: ci.recheck }),
    checkMain: async (project, id, commit) => {
      ci.checked.push(`${project}/${id}@${commit}`)
      return ci.runs[commit] ?? { state: 'green' }
    },
    fixTask: () => ci.fixTask,
    fixName,
    merged: async (_project, id) => ci.merged.has(id),
    afterGreen: () => ci.afterGreen,
    runAfterGreen: async (project, commit) => {
      ci.ran.push(`${project}@${commit}`)
      return ci.afterRuns[commit] ?? { state: 'done' }
    },
  }
  return { ci, deps }
}

/** ABC-1 ran and went to Done; main is pushed at `bbbbbbbbbb`. */
/** `options` stay live: a test changes them after the start, as with `setup`. */
export async function afterDone(wait: number | null = null, prepare: (ci: ReturnType<typeof fakeMain>['ci']) => void = () => {}, options: SetupOptions = {}) {
  const { ci, deps } = fakeMain(wait)
  prepare(ci)
  const harness = setup(Object.assign(options, { main: deps }))
  const { dispatcher } = harness
  dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
  dispatcher.start('ABC')
  await dispatcher.idle()
  dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2'), task('ABC-3')])
  await dispatcher.idle()
  return { ...harness, ci }
}
