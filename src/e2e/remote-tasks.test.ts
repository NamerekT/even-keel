import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge, ends, Gate, parked } from './agent.fixture.js'
import type { TaskMilestone } from '../tracker/model.js'
import { Harness, KEY, PROJECT_ID, SECOND_ID } from './service.fixture.js'
import { DONE } from './tracker.fixture.js'

describe('the tasks of two projects on one remote end to end', { timeout: 90_000 }, () => {
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

  it('lets the other project go once the fix task of ci.fixTask is closed by hand with no push', async () => {
    const fix = 'ABC-101'
    run.project.ci = { fixTask: true }
    run.second = {}
    run.config.parallel = 2
    const other = new Gate()
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.board.add('DEF-1')
    run.board.add('DEF-2', 'DEF-1')
    run.agent.script('ABC-1', commitAndMerge('one.txt'))
    run.agent.script(fix, ends({ say: 'A first look' }))
    run.agent.script('DEF-1', parked(other, commitAndMerge('three.txt')))
    run.agent.script('DEF-2', commitAndMerge('four.txt'))
    const has = (commit: string, file: string) => run.gitIn(run.remote, 'ls-tree', '--name-only', commit, file) === file
    run.ci.outcome = (_subject, commit) => (has(commit, 'one.txt') ? 'failure' : 'success')
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.startChain(SECOND_ID)

    await run.until(() => calls('launch', fix).length === 1 && run.agent.sessionsOf(fix)[0]?.resting === true, 'the fix task at rest')
    other.open()
    await run.until(() => run.board.status('DEF-1') === 'Done' && chainOf(SECOND_ID)?.ciWait?.by === PROJECT_ID, 'DEF waiting for the fix task of ABC')
    await run.pass(60_000)
    expect(calls('launch', 'DEF-2')).toEqual([])

    run.board.move(fix, DONE)
    await run.until(() => calls('launch', 'DEF-2').length === 1, 'DEF-2 launched after the fix task was closed by hand')
    expect(chainOf(SECOND_ID)?.ciWait).toBeUndefined()
    expect(calls('launch', 'DEF-FIX')).toEqual([])
    expect([...run.board.created.keys()]).toEqual([fix])
  })

  it('splits one tracker project by milestone: a task closed by one chain is never taken by the other', async () => {
    const release: TaskMilestone = { label: 'v0.2', targetDate: null }
    run.project.chain = { excludedMilestones: [release.label] }
    run.second = { key: KEY, chain: { requiredMilestones: [release.label] } }
    run.config.parallel = 2
    const first = new Gate()
    run.board.add('ABC-1')
    run.board.add('ABC-2')
    run.board.add('ABC-3', 'ABC-2')
    for (const task of ['ABC-2', 'ABC-3']) run.board.tasks.get(task)!.milestone = release
    run.agent.script('ABC-1', commitAndMerge('one.txt'))
    run.agent.script('ABC-2', parked(first, commitAndMerge('two.txt')))
    run.agent.script('ABC-3', commitAndMerge('three.txt'))
    // Both projects read the one place of the key.
    await run.start(() => void run.board.keys.set(SECOND_ID, KEY))
    await run.startChain(PROJECT_ID)
    await run.startChain(SECOND_ID)

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done by the first chain')
    // Closed, it moves into the other project's milestone: that chain still leaves it be.
    run.board.tasks.get('ABC-1')!.milestone = release
    first.open()
    await run.until(() => run.board.status('ABC-3') === 'Done' && chainOf(SECOND_ID) === undefined, 'the second chain over')
    await run.pass(60_000)
    const where = (task: string) => calls('launch', task).map((call) => (call.cwd.startsWith(run.repo2) ? 'second' : 'first'))
    expect([where('ABC-1'), where('ABC-2'), where('ABC-3')]).toEqual([['first'], ['second'], ['second']])
    expect(calls('resume')).toEqual([])
    expect(run.board.completions).toBe(3)
    expect(run.gitIn(run.repo2, 'log', '--format=%s', 'main')).toContain('[ABC-1] Work')
  })

  it('syncs once more when another clone pushes between the fetch and the push', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    const other = join(run.dir, 'other')
    const armed = join(run.dir, 'armed')
    const slash = (path: string) => path.replaceAll('\\', '/')
    const identity = '-c user.name="John Doe" -c user.email=john@example.com'
    // Armed by the session after its merge, the hook fires on the cleanup's merge of the remote: another clone pushes.
    // That merge runs the hook only when it brings something: an "Already up to date" one does not.
    const early = join(run.dir, 'early')
    const hook = [
      '#!/bin/sh',
      `[ -f "${slash(armed)}" ] || exit 0`,
      `rm "${slash(armed)}"`,
      'unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE',
      `git clone -q "${slash(run.remote)}" "${slash(other)}"`,
      `git -C "${slash(other)}" ${identity} commit -q --allow-empty -m "Another clone"`,
      `git -C "${slash(other)}" push -q origin main`,
      '',
    ].join('\n')
    run.agent.script('ABC-1', async (turn) => {
      const end = await commitAndMerge('one.txt')(turn)
      await writeFile(join(turn.repo, '.git', 'hooks', 'post-merge'), hook, { mode: 0o755 })
      await writeFile(armed, '')
      run.gitIn(run.dir, 'clone', '-q', run.remote, early)
      run.gitIn(early, '-c', 'user.name=John Doe', '-c', 'user.email=john@example.com', 'commit', '-q', '--allow-empty', '-m', 'Earlier clone')
      run.gitIn(early, 'push', '-q', 'origin', 'main')
      return end
    })
    run.agent.script('ABC-2', commitAndMerge('two.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => calls('launch', 'ABC-2').length === 1, 'ABC-2 launched')
    expect(existsSync(armed)).toBe(false)
    // The first push was rejected: the remote had the other clone's commit the fetch did not see.
    expect(remoteLog()).toEqual(expect.arrayContaining(['[ABC-1] Work', 'Earlier clone', 'Another clone']))
    expect(run.service.dispatcher.state.leftovers[PROJECT_ID] ?? []).toEqual([])
  })

  it('syncs once more when another clone pushes inside the push, after it read the remote', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    const other = join(run.dir, 'other')
    const armed = join(run.dir, 'armed')
    const slash = (path: string) => path.replaceAll('\\', '/')
    const identity = '-c user.name="John Doe" -c user.email=john@example.com'
    // A pre-push hook runs once the push has the remote's refs: the remote refuses the old value it was sent.
    const hook = [
      '#!/bin/sh',
      `[ -f "${slash(armed)}" ] || exit 0`,
      `rm "${slash(armed)}"`,
      'unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE',
      `git clone -q "${slash(run.remote)}" "${slash(other)}"`,
      `git -C "${slash(other)}" ${identity} commit -q --allow-empty -m "Another clone"`,
      `git -C "${slash(other)}" push -q origin main`,
      '',
    ].join('\n')
    run.agent.script('ABC-1', async (turn) => {
      const end = await commitAndMerge('one.txt')(turn)
      await writeFile(join(turn.repo, '.git', 'hooks', 'pre-push'), hook, { mode: 0o755 })
      await writeFile(armed, '')
      return end
    })
    run.agent.script('ABC-2', commitAndMerge('two.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => calls('launch', 'ABC-2').length === 1, 'ABC-2 launched')
    expect(existsSync(armed)).toBe(false)
    expect(remoteLog()).toEqual(expect.arrayContaining(['[ABC-1] Work', 'Another clone']))
    expect(run.service.dispatcher.state.leftovers[PROJECT_ID] ?? []).toEqual([])
  })
})
