import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge, ends, Gate, lingers, parked, type Turn } from './agent.fixture.js'
import type { Outcome } from './ci.fixture.js'
import { callsOf, chainOf, FIX as fix, underTask as under } from './redmain.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

describe('the sessions a red main finds end to end', { timeout: 60_000 }, () => {
  let run: Harness
  /** The turn of the fix session; a scenario may set another before `underTask`. */
  let fixer: Turn

  beforeEach(() => {
    run = new Harness()
    run.forge = true
    fixer = commitAndMerge('fix.txt')
  })

  afterEach(async () => {
    await run.stop()
  })

  const chain = () => chainOf(run)
  const calls = (kind: 'launch' | 'resume' | 'stop', task?: string) => callsOf(run, kind, task)
  const underTask = (fixed: Outcome, ...turns: Turn[]) => under(run, fixed, fixer, ...turns)

  it('leaves a session whose branch is in main alone, fixes main after its turn and starts no second fix on its red push', async () => {
    const gate = new Gate()
    const fixing = new Gate()
    fixer = parked(fixing, commitAndMerge('fix.txt'))
    await underTask('success', lingers(commitAndMerge('two.txt'), gate))
    // The push of ABC-2 carries the red commit of ABC-1.
    run.ci.outcome = (subject) => (subject.includes(fix) ? 'success' : subject.includes('ABC-1') ? 'running' : 'failure')
    await run.until(() => run.git('log', '--format=%s', 'main').includes('[ABC-2] Work'), 'ABC-2 merged mid-turn')

    run.ci.finish('ABC-1', 'failure')
    await run.pass(60_000)
    expect(calls('stop', 'ABC-2')).toEqual([])
    expect(calls('launch', fix)).toEqual([])

    gate.open()
    await run.until(() => calls('launch', fix).length === 1, 'the fix launched after the turn of ABC-2')
    expect(run.board.status('ABC-2')).toBe('Done')
    expect(chain()?.interrupted).toBeUndefined()
    const second = () => run.ci.runOf('[ABC-2]')?.commit.slice(0, 7)
    await run.until(() => run.log.includes(`ci: ABC: ${second()} is red; the session ${fix} is already fixing main`), 'the red push of ABC-2 judged while the fix works')

    fixing.open()
    await run.until(() => run.ci.runOf(fix) !== undefined && run.log.some((line) => line.endsWith('is green')), 'the push of the fix green')
    expect(calls('launch', fix)).toHaveLength(1)
    expect(calls('launch', 'ABC-2')).toHaveLength(1)
  })

  it('keeps a task launched just before the red verdict until its session is seen, then stops it for the fix', async () => {
    const listing = new Gate()
    run.project.ci = { waitMinutes: 1 }
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.agent.script('ABC-1', commitAndMerge('one.txt'))
    run.agent.script('ABC-2', parked(new Gate(), ends({ say: 'never' })))
    run.agent.script(fix, commitAndMerge('fix.txt'))
    run.ci.outcome = (subject) => (subject.includes('ABC-1') ? 'running' : 'success')
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.ci.runOf('ABC-1') !== undefined, 'the push of ABC-1 taken by the CI')
    // The monitor does not list the new session yet (BTN-550).
    run.agent.listing = listing
    await run.until(() => calls('launch', 'ABC-2').length === 1, 'ABC-2 launched')

    run.ci.finish('ABC-1', 'failure')
    await run.pass(30_000)
    expect(calls('launch', fix)).toEqual([])
    expect(calls('stop', 'ABC-2')).toEqual([])
    expect(chain()?.current?.task).toBe('ABC-2')

    listing.open()
    run.agent.listing = null
    await run.until(() => calls('launch', fix).length === 1, 'the fix launched once ABC-2 is seen')
    expect(calls('stop', 'ABC-2')).toHaveLength(1)
    expect(chain()?.interrupted).toMatchObject({ task: 'ABC-2', sessionId: calls('launch', 'ABC-2')[0]!.sessionId })
  })

  it('leaves a session waiting on its question alone and gives it back with the same question after the fix', async () => {
    await underTask('success', ends({ ask: 'Keep the old format?' }))
    await run.until(() => run.agent.sessionsOf('ABC-2')[0]?.ask !== undefined, 'ABC-2 asking')
    const session = run.agent.sessionsOf('ABC-2')[0]!

    run.ci.finish('ABC-1', 'failure')
    await run.until(() => calls('launch', fix).length === 1, 'the fix session launched')
    await run.until(() => run.ci.runOf(fix) !== undefined && chain()?.current?.task === 'ABC-2', 'ABC-2 current again after the fix')
    expect(calls('stop', 'ABC-2')).toEqual([])
    expect(calls('resume', 'ABC-2')).toEqual([])
    expect(calls('launch', 'ABC-2')).toHaveLength(1)
    expect(run.agent.sessionsOf('ABC-2')[0]!.ask?.id).toBe(session.ask!.id)
    expect(chain()?.current?.sessionId).toBe(session.sessionId)
  })
})
