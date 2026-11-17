import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkpoint, commitAndMerge, Gate, parked } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

describe('task branches on the remote end to end (BTN-1270)', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
    run.forge = true
  })

  afterEach(async () => {
    await run.stop()
  })

  const remoteBranches = () => run.gitIn(run.remote, 'branch', '--list', 'abc-*')

  it('pushes the task branch at a checkpoint and deletes it from the remote after Done', async () => {
    const merge = new Gate()
    run.board.add('ABC-1')
    run.agent.script('ABC-1', checkpoint('.temp/handoff.md', 'Half of it is done.\n'), parked(merge, commitAndMerge()))
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => remoteBranches().includes('abc-1/task'), 'the branch of ABC-1 pushed at the handoff')
    merge.open()

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    await run.until(() => remoteBranches() === '', 'the branch of ABC-1 gone from the remote')
    expect(run.git('branch', '--list', 'abc-*')).toBe('')
  })
})
