import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'
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

  it('runs the commands after green for a push of main by hand, once, and files no fix for a red one (BTN-707)', async () => {
    const script = join(run.dir, 'after.js')
    const marks = join(run.dir, 'after.log')
    await writeFile(script, `require('fs').appendFileSync(${JSON.stringify(marks)}, 'run\\n')\n`)
    run.project.commands = { afterGreen: [`node "${script.replaceAll('\\', '/')}"`] }
    const runs = () => (existsSync(marks) ? readFileSync(marks, 'utf8').split('\n').filter(Boolean).length : 0)
    run.ci.outcome = (subject) => (subject.includes('broken') ? 'failure' : 'success')
    await run.start()
    await run.until(() => run.service.ciWatches.shown(PROJECT_ID)[0]?.remoteHead !== null, 'the CI watch reading the remote')

    const byHand = async (file: string, subject: string) => {
      await writeFile(join(run.repo, file), `${subject}\n`)
      run.git('add', file)
      run.git('commit', '-m', subject)
      run.git('push', '--quiet', 'origin', 'main')
      return run.git('rev-parse', 'HEAD').slice(0, 7)
    }
    const green = await byHand('hand.txt', 'Edit by hand')
    await run.until(() => runs() === 1, 'the commands after the green push by hand')
    expect(run.log).toContain(`ci: ABC: ${green} is green, pushed outside the chain`)
    await run.pass(60_000)
    expect(runs()).toBe(1)

    const red = await byHand('broken.txt', 'Edit by hand, broken')
    await run.until(() => run.log.some((line) => line.includes(`${red} is red, pushed outside the chain`)), 'the red push by hand judged')
    await run.pass(30_000)
    expect(runs()).toBe(1)
    expect(run.board.created.size).toBe(0)
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
