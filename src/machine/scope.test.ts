import { describe, expect, it } from 'vitest'
import type { HandoffSession } from '../chain/relay.js'
import { MAX_BODY_BYTES } from '../link/protocol.js'
import type { SessionView } from '../state.js'
import { machineOf, PROJECT } from './remote.fixture.js'
import { MachineRunner, type RunnerDeps } from './runner.js'
import { RECENT_MS, factsScope, scopedDeps, type FactsScope } from './scope.js'

const NOW = Date.parse('2026-11-23T18:00:00Z')
const feed = Array.from({ length: 30 }, (_, index) => ({ kind: 'tool', text: `Read src/example/file-${index}.ts and a line of what it found there`, at: '2026-01-01T00:00:00Z' }))

const view = (task: string, sessionId: string, lamp: SessionView['lamp'], lastActivityAt: string | null): SessionView => ({
  task, sessionId, lamp, lastActivityAt, feed, startedAt: '2026-01-01T00:00:00Z', cwd: 'C:/repos/example',
} as unknown as SessionView)

describe('factsScope', () => {
  const asked = new Set(['ABC-1'])
  const scope = (views: SessionView[], journal: { sessionId: string; task: string }[] = []) =>
    factsScope({ views, journal, asked: (task) => asked.has(task), now: NOW })

  it('keeps a task the hub asks about, a live one and one active lately; drops a finished one of long ago', () => {
    const got = scope([
      view('ABC-1', 's1', 'finished', '2026-01-01T00:00:00Z'),
      view('ABC-2', 's2', 'working', '2026-01-01T00:00:00Z'),
      view('ABC-3', 's3', 'finished', new Date(NOW - RECENT_MS + 60_000).toISOString()),
      view('ABC-4', 's4', 'finished', new Date(NOW - RECENT_MS - 60_000).toISOString()),
      view('ABC-5', 's5', 'finished', null),
    ])
    expect(['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5'].filter((task) => got.task(task))).toEqual(['ABC-1', 'ABC-2', 'ABC-3'])
    expect(['s1', 's2', 's3', 's4', 's5'].filter((id) => got.session(id))).toEqual(['s1', 's2', 's3'])
  })

  it('a task asked about with no session of its own is kept, and the journal\'s older sessions of a kept task go with it', () => {
    const got = scope([view('ABC-4', 's4', 'finished', null)], [{ sessionId: 's0', task: 'ABC-1' }, { sessionId: 's9', task: 'ABC-4' }])
    expect(got.task('ABC-1')).toBe(true)
    expect(got.session('s0')).toBe(true)
    expect(got.session('s9')).toBe(false)
  })
})

describe('a machine with a project of thousands of tasks', () => {
  const TASKS = 3000
  const OLD = 1600
  const handoffOf = (task: string): HandoffSession => ({
    sessionId: `session-${task}`, agentId: `session-${task}`, account: 'main', cwd: 'C:/repos/example', workdir: 'C:/repos/example/.claude/worktrees/x',
    branch: 'abc-1/task', transcript: 'C:/Users/John/.claude/projects/example/session.jsonl', lastReplyAt: '2026-01-01T00:00:00Z', recent: feed,
    lastMessage: 'Done: the change and its tests. '.repeat(40), checkpoint: null, pullRequest: null, noChanges: null, warmMs: 300_000,
  } as unknown as HandoffSession)

  function runnerOf(scope: (views: SessionView[]) => FactsScope | undefined) {
    const { local } = machineOf()
    const old = Array.from({ length: OLD }, (_, index) => `ABC-${index + 1}`)
    const views = old.map((task) => view(task, `session-${task}`, 'finished', '2026-01-01T00:00:00Z'))
    Object.assign(local, { handoff: (task: string) => (old.includes(task) ? handoffOf(task) : undefined) })
    const deps: RunnerDeps = {
      local,
      emit: async () => {},
      boot: 'boot',
      projects: () => [PROJECT],
      tasks: () => old.map((task) => ({ task, sessions: [`session-${task}`] })),
      runs: () => [],
      reported: () => [],
      model: () => null,
      accounts: () => ['main'],
      limitsOf: () => null,
      ledger: () => ({}),
      sessions: () => views,
      mailbox: () => ({}),
      owners: () => Object.fromEntries(old.map((task) => [`session-${task}`, 'main'])),
      compactions: () => Object.fromEntries(old.map((task) => [`session-${task}`, 2])),
      log: () => {},
    }
    return new MachineRunner(scopedDeps(deps, () => scope(views)))
  }

  it('sends a snapshot under the hub\'s limit: only the tasks the hub lists and the sessions of lately', () => {
    // The hub's trackers list thousands of open tasks; the old sessions are of tasks done long ago, but one.
    const listed = new Set(Array.from({ length: TASKS }, (_, index) => `ABC-${OLD + index + 1}`).concat(['ABC-7']))
    const runner = runnerOf((views) => factsScope({ views, journal: [], asked: (task) => listed.has(task), now: NOW }))
    const snapshot = runner.snapshot()
    const { facts } = snapshot
    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThan(MAX_BODY_BYTES / 8)
    expect(Object.keys(facts.tasks)).toEqual(['ABC-7'])
    expect(Object.keys(facts.sessions ?? {})).toEqual(['session-ABC-7'])
    expect(Object.keys(facts.owners ?? {})).toEqual(['session-ABC-7'])
    expect(Object.keys(facts.compactions ?? {})).toEqual(['session-ABC-7'])
  })

  it('the same machine unscoped, as the hub\'s own one, names them all', () => {
    const runner = runnerOf(() => undefined)
    expect(Buffer.byteLength(JSON.stringify(runner.snapshot()))).toBeGreaterThan(MAX_BODY_BYTES)
  })
})
