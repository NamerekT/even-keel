import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveChain, ChainState, CurrentTask, DispatcherDeps } from '../chain/model.js'
import type { HandoffSession, LimitedSession } from '../chain/relay.js'
import { notice, type Notice } from '../notice/notice.js'
import { bench, PROJECT, REPO, tick } from './remote.fixture.js'
import { taskMoves } from './tasks.js'

const NOW = '2026-11-16T10:00:00.000Z'
const OTHER = '22222222-2222-4222-8222-222222222222'

const session: HandoffSession = {
  sessionId: 'session-1',
  agentId: 'claude',
  account: 'main',
  cwd: REPO,
  workdir: REPO,
  branch: null,
  transcript: null,
  lastReplyAt: null,
  recent: [],
  lastMessage: null,
  checkpoint: null,
}

/** The hub's chain of the project with ABC-1 current, its moves over the bench's link and what they pause on. */
async function linked(project = PROJECT, brief?: Parameters<typeof bench>[0]) {
  const made = await bench(brief)
  const machine = made.boot('first')
  await machine.end.start()
  await tick()
  const current: CurrentTask = { task: 'ABC-1', sessionId: 'session-1', since: NOW }
  const chain: ActiveChain = { project, current, paused: false, error: null }
  const state = { active: [chain], ci: {} } as unknown as ChainState
  const halts: Array<{ notice: Notice; keep: boolean | undefined }> = []
  let saves = 0
  const deps = {
    machine: made.port,
    blocked: () => undefined,
    promptLanguage: () => 'en',
    mainBranch: () => 'main',
    pullRequests: () => false,
    plain: () => false,
    save: () => void (saves += 1),
    log: (line: string) => made.log.push(line),
  } as unknown as DispatcherDeps
  const moves = taskMoves(state, deps, (_chain, error, keep) => void halts.push({ notice: error, keep }))
  made.state.live['ABC-1'] = 'session-1'
  await machine.runner.publish()
  await tick()
  const stop = () => {
    machine.end.stop()
    made.hub.stop()
  }
  return { ...made, ...machine, chain, current, moves, halts, saves: () => saves, stop }
}

describe('the moves of a task session over the link', () => {
  let stop: Array<() => void> = []
  const started = async (project?: string) => {
    const made = await linked(project)
    stop.push(made.stop)
    return made
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
  })

  afterEach(() => {
    for (const each of stop) each()
    stop = []
    vi.useRealTimers()
  })

  it('sends no follow while the mirror shows the machine nothing to do', async () => {
    const { moves, chain, current, ran } = await started()
    await moves.follow(chain, current)
    expect(ran.map((command) => command.type)).toEqual([])
  })

  it('carries a fresh hub brief to a handoff on a machine with no earlier launch', async () => {
    const brief = { prompt: '\nUpdated task text\n', task: { title: 'Example', description: 'Updated task text' } }
    const made = await linked(PROJECT, async () => brief)
    stop.push(made.stop)
    const relay = vi.fn(async () => 'session-2')
    Object.assign(made.local, { relay, locate: async () => session })
    const handed = made.moves.handOver(PROJECT, 'ABC-1', session, 'restart')
    await tick()
    expect(await handed).toBe('session-2')
    expect(relay).toHaveBeenCalledWith('ABC-1', session, expect.any(String), 'restart', brief)
  })

  it('carries the limit hold the machine took back into the hub task', async () => {
    const limited: LimitedSession = { ...session, limit: { at: NOW, text: 'rate limited' } }
    const made = await started()
    Object.assign(made.local, {
      limited: () => limited,
      limitResetAfter: () => '2026-11-16T15:00:00.000Z',
      accountAt: () => 'main/john@example.com',
      limitReopenedAt: () => null,
    })
    await made.runner.publish()
    await tick()
    const followed = made.moves.follow(made.chain, made.current)
    await tick()
    await followed
    expect(made.ran.map((command) => command.type)).toEqual(['task.follow'])
    expect(made.current.limit).toEqual({ at: NOW, account: 'main/john@example.com', resetsAt: '2026-11-16T15:00:00.000Z', lastReplyAt: null, then: 'relay', acted: null })
    expect(made.saves()).toBeGreaterThan(0)
    expect(made.halts).toEqual([])
  })

  it('puts the state the machine kept mid-move into the hub task before the move ends', async () => {
    const made = await started()
    let open = () => {}
    const gate = new Promise<void>((resolve) => (open = resolve))
    Object.assign(made.local, {
      handoff: () => session,
      reply: async () => {
        await gate
        return 'session-1'
      },
    })
    let delivered: boolean | undefined
    void made.moves.deliver(made.chain, made.current, session, 'Yes.', 'Go on?').then((value) => (delivered = value))
    await tick()
    expect(made.ran.map((command) => [command.type, command.project])).toEqual([['task.deliver', PROJECT]])
    expect(made.current).toMatchObject({ starting: NOW, move: 'answer', answering: true, reply: 'Yes.', ask: 'Go on?' })
    open()
    await tick()
    expect(delivered).toBe(true)
    expect(made.current).toEqual({ task: 'ABC-1', sessionId: 'session-1', since: NOW, resumedAt: NOW })
    expect(made.journal).toEqual([{ at: NOW, project: PROJECT, task: 'ABC-1', sessionId: 'session-1', reason: 'answer', previous: 'session-1' }])
  })

  it('pauses the hub chain on the halt the machine came to, keeping its task on a refused model', async () => {
    const made = await started()
    const refusal = notice('chain.modelUnavailable', { model: 'openai/denied' })
    Object.assign(made.local, { modelRefusal: (_task: string, sessionId: string) => (sessionId === 'session-1' ? refusal : undefined) })
    await made.runner.publish()
    await tick()
    const followed = made.moves.follow(made.chain, made.current)
    await tick()
    await followed
    expect(made.halts).toEqual([{ notice: refusal, keep: true }])
  })

  it('pauses the chain when the machine refuses the move of a project it does not serve', async () => {
    const made = await started(OTHER)
    made.current.limit = { at: NOW, account: 'main', resetsAt: '2026-11-16T15:00:00.000Z', lastReplyAt: null, then: 'relay', acted: null }
    const followed = made.moves.follow(made.chain, made.current)
    await tick()
    await followed
    expect(made.halts).toEqual([{ notice: { code: 'machine.commandRefused', params: { command: 'task.follow', reason: 'project' } }, keep: undefined }])
  })
})
