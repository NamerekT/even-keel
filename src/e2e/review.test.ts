import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { forReview } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

/** The address of the bench's remote, as `service.fixture.ts` sets it up. */
const FORGE_URL = 'http://127.0.0.1:9/john/example.git'

describe('PR mode end to end: opening and closing', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
    run.forge = true
    run.project.pullRequests = true
  })

  afterEach(async () => {
    await run.stop()
  })

  const chain = () => run.service.dispatcher.state.active.find((each) => each.project === PROJECT_ID)
  const calls = (kind: 'launch' | 'resume' | 'stop', task?: string) => run.agent.calls.filter((call) => call.kind === kind && (task === undefined || call.task === task))
  const worktree = (task: string) => join(run.repo, '.claude', 'worktrees', task.toLowerCase())
  const branches = (repo: string) => run.gitIn(repo, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean)
  const cleanedUp = (task: string) => {
    const branch = `${task.toLowerCase()}/task`
    return !existsSync(worktree(task)) && !branches(run.repo).includes(branch) && !branches(run.remote).includes(branch)
  }

  it('opens the pull request on the mark and, once it is merged, moves the task to Done and removes the worktree and both branches', async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', forReview('one.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.pulls.of('ABC-1') !== undefined, 'the pull request of ABC-1 opened')
    const pull = run.pulls.of('ABC-1')!
    expect(pull).toMatchObject({ branch: 'abc-1/task', base: 'main', title: '[ABC-1] Work', body: 'What the task did.' })
    expect(branches(run.remote)).toContain('abc-1/task')
    expect(run.board.status('ABC-1')).not.toBe('Done')

    await run.pulls.merge(pull.number)
    await run.until(() => run.board.status('ABC-1') === 'Done' && cleanedUp('ABC-1'), 'ABC-1 done and cleaned up')
    expect(run.gitIn(run.remote, 'log', '-1', '--format=%s', 'main')).toBe(`Merge pull request #${pull.number}`)
  })

  it('skips the task of a pull request closed unmerged and removes its worktree and branches, the task left open', async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', forReview('one.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.pulls.of('ABC-1') !== undefined, 'the pull request of ABC-1 opened')

    run.pulls.close(run.pulls.of('ABC-1')!.number)
    await run.until(() => cleanedUp('ABC-1') && (run.service.dispatcher.state.skipped[PROJECT_ID] ?? []).includes('ABC-1'), 'ABC-1 cleaned up and skipped')
    expect(run.board.status('ABC-1')).toBe('Todo')
    expect(run.log.some((line) => line.includes('ABC-1') && line.includes('is closed unmerged with 0 remark(s), the task is skipped'))).toBe(true)
  })

  it('moves a task with nothing beyond main and a clean worktree to Done without a pull request', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.agent.script('ABC-1', forReview(null))
    run.agent.script('ABC-2', forReview('two.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.pulls.of('ABC-2') !== undefined, 'the pull request of ABC-2 opened')
    expect(run.board.status('ABC-1')).toBe('Done')
    expect(run.pulls.of('ABC-1')).toBeUndefined()
    expect(cleanedUp('ABC-1')).toBe(true)
  })

  it('pauses with review.notReady while the project has no remote and goes on by itself once one is added', async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', forReview('one.txt'))
    await run.start()
    // The first start made the Forgejo profile from the remote; the project comes back without it.
    await run.restart(() => void run.git('remote', 'remove', 'origin'))
    await run.startChain(PROJECT_ID)

    await run.until(() => chain()?.paused === true, 'the chain paused')
    expect(chain()).toMatchObject({ paused: true, error: { code: 'review.notReady', cause: { code: 'review.noRemote' } } })
    await run.pass(120_000)
    expect(calls('launch')).toEqual([])

    run.git('remote', 'add', 'origin', FORGE_URL)
    await run.until(() => run.pulls.of('ABC-1') !== undefined, 'the pull request of ABC-1 opened')
    expect(calls('launch').map((call) => call.task)).toEqual(['ABC-1'])
  })

  it('pauses with review.notOpened on a token without the right to open, and Resume opens it in the same session once access is fixed', async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', forReview('one.txt'))
    run.pulls.refuse = 403
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => chain()?.paused === true, 'the chain paused on the refusal')
    expect(chain()).toMatchObject({ paused: true, error: { code: 'review.notOpened', params: { task: 'ABC-1' }, cause: { code: 'review.denied' } } })
    await run.pass(180_000)
    expect(run.pulls.creates).toBe(1)

    run.pulls.refuse = null
    await run.post('chain/resume', { project: PROJECT_ID })
    await run.until(() => run.pulls.of('ABC-1') !== undefined, 'the pull request of ABC-1 opened after Resume')
    expect(run.pulls.creates).toBe(2)
    expect(calls('launch', 'ABC-1')).toHaveLength(1)
    expect(calls('resume', 'ABC-1')).toEqual([])
  })
})
