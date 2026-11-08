import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge, ends, Gate, parked, type Turn } from './agent.fixture.js'
import type { Outcome } from './ci.fixture.js'
import { callsOf, chainOf, FIX as fix, goOn, underTask as under } from './redmain.fixture.js'
import { ACCOUNT, Harness, PROJECT_ID } from './service.fixture.js'

describe('the fix of a red main end to end', { timeout: 60_000 }, () => {
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
  const launched = () => calls('launch').map((call) => call.task)
  const underTask = (fixed: Outcome, ...turns: Turn[]) => under(run, fixed, fixer, ...turns)

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

  /** ABC-1 lands red; the fix session plays `fixer`, ABC-2 waits for the fix. */
  const redAfterOne = async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.agent.script('ABC-1', commitAndMerge('one.txt'))
    run.agent.script('ABC-2', commitAndMerge('two.txt'))
    run.agent.script(fix, fixer)
    run.ci.outcome = (subject) => (subject.includes('[ABC-1]') ? 'failure' : 'success')
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => calls('launch', fix).length === 1, 'the fix session launched')
  }

  it('closes a fix session that finds nothing to fix once its rerun of the red commit is green (EKR-88)', async () => {
    fixer = async () => {
      run.ci.finish('[ABC-1]', 'success')
      return { noChanges: 'no runner took the jobs; they are rerun' }
    }
    await redAfterOne()
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done after the fix')
    expect(run.log.some((line) => line.includes('chain: ABC-FIX found nothing to fix, main is green at'))).toBe(true)
    expect(calls('launch', fix)).toHaveLength(1)
    expect(launched()).toEqual(['ABC-1', fix, 'ABC-2'])
    expect(calls('stop', fix)).toHaveLength(1)
  })

  it('keeps a fix session that finds nothing to fix while the red commit stays red, and goes on once a later rerun is green (EKR-88)', async () => {
    fixer = ends({ noChanges: 'no runner took the jobs' })
    await redAfterOne()
    await run.until(() => run.agent.sessionsOf(fix)[0]?.resting === true, 'the turn of the fix session over')
    await run.pass(5 * 60_000)
    expect(chain()?.current?.task).toBe(fix)
    expect(calls('launch', 'ABC-2')).toEqual([])
    expect(run.log.some((line) => line.includes('found nothing to fix, and') && line.includes('is still red; it waits for the user'))).toBe(true)

    run.ci.finish('[ABC-1]', 'success')
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done after the rerun')
    expect(calls('launch', fix)).toHaveLength(1)
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

  it('reruns the failed jobs of a red main once and, green on the rerun, neither stops the session nor fixes (BTN-846)', async () => {
    run.ci.rerunnable = true
    const gate = new Gate()
    await underTask('success', parked(gate, goOn))

    run.ci.finish('ABC-1', 'failure')
    await run.until(() => run.ci.reran.length === 1, 'the failed jobs rerun')
    await run.pass(60_000)
    expect(calls('stop', 'ABC-2')).toEqual([])
    expect(calls('launch', fix)).toEqual([])

    run.ci.finish('ABC-1', 'success')
    await run.until(() => run.log.some((line) => line.includes('is green on a rerun of its failed jobs')), 'main green on the rerun')
    gate.open()
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
    expect(calls('launch', fix)).toEqual([])
    expect(calls('launch', 'ABC-2')).toHaveLength(1)
    expect(run.ci.reran).toHaveLength(1)
  })

  it('fixes a red main as before once the rerun is red too, telling the fix session (BTN-846)', async () => {
    run.ci.rerunnable = true
    await underTask('success', parked(new Gate(), ends({ say: 'never' })), goOn)
    const session = calls('launch', 'ABC-2')[0]!.sessionId

    run.ci.finish('ABC-1', 'failure')
    await run.until(() => run.ci.reran.length === 1, 'the failed jobs rerun')
    await run.pass(5_000)
    expect(calls('stop', 'ABC-2')).toEqual([])
    run.ci.finish('ABC-1', 'failure')
    await run.until(() => calls('launch', fix).length === 1, 'the fix session launched')
    expect(calls('stop', 'ABC-2').map((call) => call.sessionId)).toEqual([session])
    expect(calls('launch', fix)[0]!.prompt).toContain('Even Keel already reran the failed jobs of this commit once')

    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
    expect(run.ci.reran).toHaveLength(1)
    expect(calls('launch', fix)).toHaveLength(1)
  })
})
