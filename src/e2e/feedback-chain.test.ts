import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ends, forReview, Gate, parked, type Turn } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

describe('PR mode end to end: feedback past its session and chain', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
    run.forge = true
    run.project.pullRequests = true
    run.pulls.access.set('jane', 'write')
  })

  afterEach(async () => {
    await run.stop()
  })

  const chain = () => run.service.dispatcher.state.active.find((each) => each.project === PROJECT_ID)
  const calls = (kind: 'launch' | 'resume' | 'stop', task?: string) => run.agent.calls.filter((call) => call.kind === kind && (task === undefined || call.task === task))
  const headSubject = () => run.gitIn(run.remote, 'log', '-1', '--format=%s', 'abc-1/task')
  const record = () => run.service.dispatcher.state.reviews[PROJECT_ID]?.find((pull) => pull.task === 'ABC-1')

  /** ABC-1 plays `turns` after its first, which opens the pull request; returns once it is open and the session rests. */
  async function opened(...turns: Turn[]): Promise<number> {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', forReview('one.txt'), ...turns)
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.pulls.of('ABC-1') !== undefined && record() !== undefined, 'the pull request of ABC-1 opened')
    return run.pulls.of('ABC-1')!.number
  }

  it('hands a remark that comes once the session cache went cold to a new session', async () => {
    const pull = await opened(forReview('one.txt', 'fixed\n', 'Fix review'))

    // Past `WARM_CACHE_MS`; nothing happens meanwhile, so the steps are long.
    await run.pass(60 * 60_000, 5 * 60_000)
    run.pulls.comment(pull, 'jane', 'Rename it, please')
    await run.until(() => calls('launch', 'ABC-1').length === 2, 'a new session launched with the remark')
    expect(calls('launch', 'ABC-1')[1]!.prompt).toContain('Rename it, please')
    expect(calls('resume', 'ABC-1')).toEqual([])
    await run.until(() => headSubject() === '[ABC-1] Fix review', 'the fix pushed by the new session')
    expect(run.pulls.pulls).toHaveLength(1)
  })

  it('starts a chain that ended by itself again on a remark on its pull request', async () => {
    const pull = await opened(ends({ say: 'Renamed' }))
    await run.until(() => chain() === undefined, 'the chain ended with no task left')

    run.pulls.comment(pull, 'jane', 'Rename it, please')
    await run.until(() => calls('resume', 'ABC-1').length === 1, 'the remark delivered')
    expect(run.log.some((line) => line.includes('starts again: feedback came on a pull request of its tasks'))).toBe(true)
  })

  it('leaves a chain the user stopped stopped on a remark, and Start takes the remark as work', async () => {
    const gate = new Gate()
    run.board.add('ABC-1')
    run.board.add('ABC-2')
    run.agent.script('ABC-1', forReview('one.txt'), ends({ say: 'Renamed' }))
    run.agent.script('ABC-2', parked(gate, ends({ say: 'Done' })))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.pulls.of('ABC-1') !== undefined && calls('launch', 'ABC-2').length === 1, 'ABC-1 out for review, ABC-2 launched')
    const pull = run.pulls.of('ABC-1')!.number

    await run.post('chain/stop', { project: PROJECT_ID })
    gate.open()
    await run.pass(60_000)
    run.pulls.comment(pull, 'jane', 'Rename it, please')
    await run.pass(180_000)
    expect(calls('resume', 'ABC-1')).toEqual([])
    expect(chain()).toBeUndefined()

    await run.startChain(PROJECT_ID)
    await run.until(() => calls('resume', 'ABC-1').length === 1, 'the remark delivered after Start')
    expect(calls('resume', 'ABC-1')[0]!.prompt).toContain('Rename it, please')
  })
})
