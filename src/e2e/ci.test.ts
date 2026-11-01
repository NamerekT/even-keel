import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge, ends, Gate, lingers, parked, type Turn } from './agent.fixture.js'
import type { Outcome } from './ci.fixture.js'
import { ACCOUNT, Harness, PROJECT_ID } from './service.fixture.js'
import { STUCK_MS } from '../ci/model.js'

describe('the CI of main end to end', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
    run.forge = true
  })

  afterEach(async () => {
    await run.stop()
  })

  const chain = () => run.service.dispatcher.state.active.find((each) => each.project === PROJECT_ID)
  const calls = (kind: 'launch' | 'resume' | 'stop', task?: string) => run.agent.calls.filter((call) => call.kind === kind && (task === undefined || call.task === task))
  const launched = () => calls('launch').map((call) => call.task)

  it('launches the next task once the push of the last one is green', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.agent.script('ABC-1', commitAndMerge('one.txt'))
    run.agent.script('ABC-2', commitAndMerge('two.txt'))
    run.ci.outcome = (subject) => (subject.includes('ABC-1') ? 'running' : 'success')
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.status('ABC-1') === 'Done' && run.ci.runOf('ABC-1') !== undefined, 'the push of ABC-1 taken by the CI')
    await run.until(() => chain()?.ciWait !== undefined, 'the chain waiting for the verdict')
    await run.pass(60_000)
    expect(launched()).toEqual(['ABC-1'])

    run.ci.finish('ABC-1', 'success')
    await run.until(() => run.ci.runOf('ABC-2') !== undefined, 'the push of ABC-2 taken by the CI')
    expect(launched()).toEqual(['ABC-1', 'ABC-2'])
    expect(run.gitIn(run.remote, 'log', '--format=%s', 'main').split('\n').slice(0, 2)).toEqual(['[ABC-2] Work', '[ABC-1] Work'])
  })

  it('waits for a queued run until it counts as stuck, then launches the next task with the push unchecked', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.agent.script('ABC-1', commitAndMerge('one.txt'))
    run.agent.script('ABC-2', commitAndMerge('two.txt'))
    run.ci.outcome = (subject) => (subject.includes('ABC-1') ? 'queued' : 'success')
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.status('ABC-1') === 'Done' && run.ci.runOf('ABC-1') !== undefined, 'the push of ABC-1 queued by the CI')
    await run.until(() => chain()?.ciWait !== undefined, 'the chain waiting for the verdict')
    const queuedAt = Date.parse(run.ci.runOf('ABC-1')!.createdAt)
    await run.pass(60_000)
    expect(launched()).toEqual(['ABC-1'])

    await run.until(() => calls('launch', 'ABC-2').length === 1, 'ABC-2 launched past the stuck run')
    expect(Date.now() - queuedAt).toBeGreaterThanOrEqual(STUCK_MS)
    const commit = run.ci.runOf('ABC-1')!.commit.slice(0, 7)
    expect(run.log).toContain(`ci: ABC: ${commit} stays unchecked: Forgejo: no runner took ${commit}`)
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
  })

  it('runs the commands after green once per push, and not again after a restart', async () => {
    const script = join(run.dir, 'after.js')
    const marks = join(run.dir, 'after.log')
    await writeFile(script, `require('fs').appendFileSync(${JSON.stringify(marks)}, 'run\\n')\n`)
    run.project.commands = { afterGreen: [`node "${script.replaceAll('\\', '/')}"`] }
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.agent.script('ABC-1', commitAndMerge('one.txt'))
    run.agent.script('ABC-2', commitAndMerge('two.txt'))
    const runs = () => (existsSync(marks) ? readFileSync(marks, 'utf8').split('\n').filter(Boolean).length : 0)
    run.ci.outcome = (subject) => (subject.includes('ABC-2') ? 'running' : 'success')
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => runs() === 1 && calls('launch', 'ABC-2').length === 1, 'the commands after the green push of ABC-1')
    await run.until(() => run.ci.runOf('ABC-2') !== undefined, 'the push of ABC-2 taken by the CI')
    await run.restart()
    await run.pass(60_000)
    expect(runs()).toBe(1)

    run.ci.finish('ABC-2', 'success')
    await run.until(() => runs() === 2, 'the commands after the green push of ABC-2')
    await run.pass(30_000)
    expect(runs()).toBe(2)
  })

  it('files the fix of a red main as a task with ci.fixTask and runs it first', async () => {
    run.project.ci = { fixTask: true }
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.agent.script('ABC-1', commitAndMerge('one.txt'))
    run.agent.script('ABC-2', commitAndMerge('two.txt'))
    run.agent.script('ABC-101', commitAndMerge('fix.txt'))
    run.ci.outcome = (subject) => (subject.includes('[ABC-1]') ? 'failure' : 'success')
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
    expect(launched()).toEqual(['ABC-1', 'ABC-101', 'ABC-2'])
    const red = run.ci.runOf('[ABC-1]')!.commit.slice(0, 7)
    expect(run.board.created.get('ABC-101')).toMatchObject({ project: PROJECT_ID, title: `CI on main failed: ${red}`, priority: 'high', description: expect.stringContaining('AssertionError: expected 3 to be 4') })
    expect(calls('launch', 'ABC-FIX')).toEqual([])
  })

  describe('a red main', () => {
    const fix = 'ABC-FIX'
    /** The turn of the fix session; a scenario may set another before `underTask`. */
    let fixer: Turn

    beforeEach(() => {
      fixer = commitAndMerge('fix.txt')
    })

    /**
     * ABC-1 lands and its run stays under way; ABC-2 starts once `waitMinutes` runs out and plays `turns`. The fix
     * session merges a commit whose run comes out as `fixed`.
     */
    async function underTask(fixed: Outcome, ...turns: Turn[]): Promise<void> {
      run.project.ci = { waitMinutes: 1 }
      run.board.add('ABC-1')
      run.board.add('ABC-2', 'ABC-1')
      run.agent.script('ABC-1', commitAndMerge('one.txt'))
      run.agent.script('ABC-2', ...turns)
      run.agent.script(fix, fixer)
      run.ci.outcome = (subject) => (subject.includes('ABC-1') ? 'running' : subject.includes(fix) ? fixed : 'success')
      await run.start()
      await run.startChain(PROJECT_ID)
      await run.until(() => calls('launch', 'ABC-2').length === 1 && run.ci.runOf('ABC-1') !== undefined, 'ABC-2 launched while the run of ABC-1 is under way')
    }

    /** Commits what the session left uncommitted, merges main and lands the task. */
    const goOn: Turn = async (turn) => {
      await turn.git('add', '-A')
      await turn.git('merge', '--no-edit', 'main')
      return commitAndMerge('two.txt')(turn)
    }

    it('stops a session mid-turn in its first turn, fixes main with the log tail and hands the task to a new session in the same folder', async () => {
      let notes = false
      await underTask('success', parked(new Gate(), ends({ say: 'never' })), async (turn) => {
        notes = existsSync(join(turn.cwd, 'notes.txt'))
        return goOn(turn)
      })
      const { sessionId: session, cwd } = calls('launch', 'ABC-2')[0]!
      // What the session wrote mid-turn and has not committed yet.
      await writeFile(join(cwd, 'notes.txt'), 'uncommitted\n')

      run.ci.finish('ABC-1', 'failure')
      await run.until(() => calls('launch', fix).length === 1, 'the fix session launched')
      expect(calls('stop', 'ABC-2').map((call) => call.sessionId)).toEqual([session])
      expect(chain()?.interrupted).toMatchObject({ task: 'ABC-2', sessionId: session })
      expect(calls('launch', fix)[0]!.prompt).toContain('AssertionError: expected 3 to be 4')

      await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
      // A session that never replied has no warm cache: the task goes on by a handoff, not a resume.
      expect(calls('resume')).toEqual([])
      expect(calls('launch', 'ABC-2')[1]).toMatchObject({ cwd, prompt: expect.stringContaining('Even Keel stopped the previous session on this task because the check of main failed') })
      expect(run.log).toContain(`chain: ABC-2 handed over by relay from the session ${session} to ${calls('launch', 'ABC-2')[1]!.sessionId}`)
      expect(notes).toBe(true)
      expect(run.git('show', 'main:notes.txt')).toBe('uncommitted')
      expect(calls('launch', fix)).toHaveLength(1)
    })

    it('resumes a session with a warm cache once the fix lands, telling it to merge main', async () => {
      const gate = new Gate()
      await underTask('success', ends({ say: 'A first look' }), parked(gate, ends({ say: 'never' })), goOn)
      await run.until(() => run.agent.sessionsOf('ABC-2')[0]?.resting === true, 'the first turn of ABC-2 over')
      // The monitor reads the resting session before the chat may answer it.
      await run.pass(15_000)
      const session = calls('launch', 'ABC-2')[0]!.sessionId
      await run.post('session/answer', { project: PROJECT_ID, task: 'ABC-2', sessionId: session, ask: null, answers: {}, text: 'Go on' })
      await run.until(() => calls('resume', 'ABC-2').length === 1, 'ABC-2 working on the chat message')
      // A resume stops the resting session first.
      const stops = calls('stop', 'ABC-2').length

      run.ci.finish('ABC-1', 'failure')
      await run.until(() => calls('launch', fix).length === 1, 'the fix session launched')
      expect(calls('stop', 'ABC-2').slice(stops).map((call) => call.sessionId)).toEqual([session])

      await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
      expect(calls('resume', 'ABC-2')[1]).toMatchObject({ sessionId: session, prompt: expect.stringContaining('It is fixed, main is now at commit') })
      expect(calls('launch', 'ABC-2')).toHaveLength(1)
    })

    it('halts with ci.fixFailed when main is red after the fix, gives the stopped session back and starts no second fix', async () => {
      await underTask('failure', parked(new Gate(), ends({ say: 'never' })))
      const session = calls('launch', 'ABC-2')[0]!.sessionId

      run.ci.finish('ABC-1', 'failure')
      await run.until(() => chain()?.paused === true, 'the chain halted')
      expect(chain()).toMatchObject({ error: { code: 'ci.fixFailed' }, current: { task: 'ABC-2', sessionId: session } })
      expect(chain()?.interrupted).toBeUndefined()
      await run.pass(5 * 60_000)
      expect(calls('launch', fix)).toHaveLength(1)
      expect(calls('launch', 'ABC-2')).toHaveLength(1)
      expect(calls('resume')).toEqual([])
    })

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

    it('goes on after the fix on an account with no e-mail, the stopped session resumed (BTN-537)', async () => {
      run.agent.statuses.set(ACCOUNT, { email: null })
      const gate = new Gate()
      await underTask('success', ends({ say: 'A first look' }), parked(gate, ends({ say: 'never' })), goOn)
      await run.until(() => run.agent.sessionsOf('ABC-2')[0]?.resting === true, 'the first turn of ABC-2 over')
      await run.pass(15_000)
      const session = calls('launch', 'ABC-2')[0]!.sessionId
      await run.post('session/answer', { project: PROJECT_ID, task: 'ABC-2', sessionId: session, ask: null, answers: {}, text: 'Go on' })
      await run.until(() => calls('resume', 'ABC-2').length === 1, 'ABC-2 working on the chat message')

      run.ci.finish('ABC-1', 'failure')
      await run.until(() => calls('launch', fix).length === 1, 'the fix session launched')
      await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done after the fix')
      expect(calls('resume', 'ABC-2')[1]).toMatchObject({ sessionId: session, prompt: expect.stringContaining('It is fixed, main is now at commit') })
      expect(calls('launch', 'ABC-2')).toHaveLength(1)
      expect(chain()?.interrupted).toBeUndefined()
    })
  })

  it('watches the CI of a remote added to the checkout while the service runs, within a minute', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.agent.script('ABC-1', commitAndMerge('one.txt'))
    run.agent.script('ABC-2', commitAndMerge('two.txt'))
    run.ci.outcome = (subject) => (subject.includes('ABC-1') ? 'running' : 'success')
    await run.start()
    // As written, not as `insteadOf` leads git: the forge's address.
    const url = run.git('config', '--get', 'remote.origin.url')
    // The first start made the Forgejo profile from the remote; the project comes back without it.
    await run.restart(() => void run.git('remote', 'remove', 'origin'))
    await run.pass(2 * 60_000)
    expect(run.service.ciWatches.shown(PROJECT_ID)).toEqual([])

    run.git('remote', 'add', 'origin', url)
    const added = Date.now()
    const before = run.log.length
    await run.until(() => run.service.ciWatches.shown(PROJECT_ID).length === 1, 'the CI of the new remote watched')
    expect(Date.now() - added).toBeLessThanOrEqual(60_000)
    expect(run.log.slice(before)).toContain('ci: ABC watches forgejo on origin')

    await run.startChain(PROJECT_ID)
    await run.until(() => run.board.status('ABC-1') === 'Done' && chain()?.ciWait !== undefined, 'the chain waiting for the verdict on the push of ABC-1')
    await run.pass(60_000)
    expect(launched()).toEqual(['ABC-1'])
    run.ci.finish('ABC-1', 'success')
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done after the green push')
  })
})
