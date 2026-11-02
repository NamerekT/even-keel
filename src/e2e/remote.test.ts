import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge, ends, Gate, parked, type Turn } from './agent.fixture.js'
import { Harness, PROJECT_ID, SECOND_ID } from './service.fixture.js'

describe('two projects on one remote end to end', { timeout: 90_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
    run.forge = true
  })

  afterEach(async () => {
    await run.stop()
  })

  const chainOf = (project: string) => run.service.dispatcher.state.active.find((each) => each.project === project)
  const calls = (kind: 'launch' | 'resume' | 'stop', task?: string) => run.agent.calls.filter((call) => call.kind === kind && (task === undefined || call.task === task))
  const remoteLog = () => run.gitIn(run.remote, 'log', '--format=%s', 'main').split('\n')

  describe('a red main of the remote', () => {
    const fix = 'ABC-FIX'
    let fixing: Gate
    let other: Gate
    /** Whether DEF-2 started from a tree with the fix in it. */
    let started: boolean | undefined

    beforeEach(() => {
      started = undefined
      fixing = new Gate()
      other = new Gate()
    })

    /**
     * ABC-1 breaks main (its file is the bug, `fix.txt` the fix); DEF-1 works on until `other` opens, then lands on
     * top of the red main. The fix session plays `fixed`.
     */
    async function brokenBy(fixed: Turn): Promise<void> {
      run.second = {}
      run.config.parallel = 2
      run.board.add('ABC-1')
      run.board.add('ABC-2', 'ABC-1')
      run.board.add('DEF-1')
      run.board.add('DEF-2', 'DEF-1')
      run.agent.script('ABC-1', commitAndMerge('one.txt'))
      run.agent.script('ABC-2', commitAndMerge('two.txt'))
      run.agent.script('DEF-1', parked(other, commitAndMerge('three.txt')))
      run.agent.script('DEF-2', async (turn) => {
        started = existsSync(join(turn.cwd, 'fix.txt'))
        return commitAndMerge('four.txt')(turn)
      })
      run.agent.script(fix, fixed)
      const has = (commit: string, file: string) => run.gitIn(run.remote, 'ls-tree', '--name-only', commit, file) === file
      run.ci.outcome = (_subject, commit) => (has(commit, 'fix.txt') || !has(commit, 'one.txt') ? 'success' : 'failure')
      await run.start()
      await run.startChain(PROJECT_ID)
      await run.startChain(SECOND_ID)

      await run.until(() => calls('launch', fix).length === 1 && calls('launch', 'DEF-1').length === 1, 'the fix launched while DEF-1 works')
      await run.pass(15_000)
      // DEF-1 is at work when the main of the remote goes red: invariant 1 leaves it alone.
      expect(calls('stop', 'DEF-1')).toEqual([])
      other.open()
      await run.until(() => run.board.status('DEF-1') === 'Done' && chainOf(SECOND_ID)?.ciWait?.by === PROJECT_ID, 'DEF waiting for the fix of ABC')
    }

    it('holds the other project on its red push, starts no second fix and lets it go on the green push of the fix',async () => {
      await brokenBy(parked(fixing, commitAndMerge('fix.txt')))
      expect(run.log.some((line) => line.includes(`${fix} of`) && line.includes('is already fixing main of the remote'))).toBe(true)
      await run.pass(60_000)
      expect(calls('launch', 'DEF-2')).toEqual([])
      expect(calls('launch', 'DEF-FIX')).toEqual([])

      fixing.open()
      await run.until(() => calls('launch', 'DEF-2').length === 1, 'DEF-2 launched after the fix')
      expect(remoteLog()).toContain(`[${fix}] Work`)
      expect(chainOf(SECOND_ID)?.ciWait).toBeUndefined()
      // DEF's main came up to the fix before DEF-2 branched off it.
      await run.until(() => run.board.status('DEF-2') === 'Done', 'DEF-2 done')
      expect(started).toBe(true)
      expect(run.gitIn(run.repo2, 'log', '--format=%s', 'main')).toContain(`[${fix}] Work`)
      expect(calls('launch', 'DEF-FIX')).toEqual([])
    })

    it('lets the other project go once the fix is dropped with Skip', async () => {
      await brokenBy(ends({ say: 'Cannot fix it' }))
      await run.until(() => run.agent.sessionsOf(fix)[0]?.resting === true, 'the fix session idle')
      await run.pass(15_000)
      expect(calls('launch', 'DEF-2')).toEqual([])

      await run.post('chain/skip', { project: PROJECT_ID, task: fix })
      await run.until(() => calls('launch', 'DEF-2').length === 1, 'DEF-2 launched after the fix was dropped')
      expect(chainOf(SECOND_ID)?.ciWait).toBeUndefined()
      expect(calls('launch', 'DEF-FIX')).toEqual([])
    })

    it('holds the other project on a fix session stopped from outside as its own chain is held, and lets it go on Skip', async () => {
      await brokenBy(parked(fixing, ends({ crash: true })))
      fixing.open()
      await run.until(() => run.agent.isGone(run.agent.sessionsOf(fix)[0]!.sessionId), 'the fix session gone')
      // Invariant 1: the stopped fix session still leads the chain of ABC, main is still red, and DEF waits with it.
      await run.pass(5 * 60_000, 10_000)
      expect(chainOf(PROJECT_ID)?.current?.task).toBe(fix)
      expect(chainOf(SECOND_ID)?.ciWait?.by).toBe(PROJECT_ID)
      expect(calls('launch', 'DEF-2')).toEqual([])

      await run.post('chain/skip', { project: PROJECT_ID, task: fix })
      await run.until(() => calls('launch', 'DEF-2').length === 1, 'DEF-2 launched after the stopped fix was dropped')
      expect(chainOf(SECOND_ID)?.ciWait).toBeUndefined()
      expect(calls('launch', 'DEF-FIX')).toEqual([])
    })
  })
})
