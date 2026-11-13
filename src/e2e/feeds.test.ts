import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge, ends } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

describe("a project's task feed end to end", { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const launches = () => run.agent.calls.filter((call) => call.kind === 'launch')
  const resumes = () => run.agent.calls.filter((call) => call.kind === 'resume')

  it("runs the feed's tasks in the project's chain: on their run, asking and answered in the feed's tracker, closed there by the merge", async () => {
    run.feed = true
    Object.assign(run.project, { models: { claude: 'sonnet' } })
    run.board.add('ABC-1')
    run.lane.add('GHI-1')
    run.lane.add('GHI-2', 'GHI-1')
    run.agent.script('ABC-1', commitAndMerge('ABC-1.txt'))
    run.agent.script('GHI-1', ends({ ask: 'Keep the old format?' }), commitAndMerge('GHI-1.txt'))
    run.agent.script('GHI-2', commitAndMerge('GHI-2.txt'))
    await run.start()
    await run.until(() => run.service.knownTask('GHI-2') !== undefined, "the feed's tasks read")
    await run.post('task/run', { task: 'GHI-2', provider: 'claude', model: 'haiku' })
    await run.startChain(PROJECT_ID)

    await run.until(() => run.lane.commentsOf('GHI-1').length === 1, "the question posted on the feed's tracker")
    expect(run.lane.commentsOf('GHI-1')[0]).toContain('Keep the old format?')
    expect(run.board.commentsOf('GHI-1')).toEqual([])
    run.lane.reply('GHI-1', '2')

    await run.until(() => ['GHI-1', 'GHI-2'].every((task) => run.lane.status(task) === 'Done') && run.board.status('ABC-1') === 'Done', 'all three done')
    const asked = launches().find((call) => call.task === 'GHI-1')!
    expect(resumes()).toEqual([expect.objectContaining({ task: 'GHI-1', sessionId: asked.sessionId, prompt: expect.stringContaining('No') })])
    expect(launches().map(({ task, model }) => ({ task, model }))).toEqual(
      expect.arrayContaining([
        { task: 'ABC-1', model: 'sonnet' },
        { task: 'GHI-1', model: 'sonnet' },
        { task: 'GHI-2', model: 'haiku' },
      ]),
    )
    expect(launches()).toHaveLength(3)
    expect(run.board.completions).toBe(1)

    await run.until(() => launches().every((call) => !existsSync(call.cwd)), 'the worktrees removed')
    expect(run.git('branch', '--list', 'ghi-*')).toBe('')
    expect(run.git('worktree', 'list').split('\n')).toHaveLength(1)
    expect(run.git('log', '--format=%s', 'main')).toMatch(/\[GHI-2\] Work[\s\S]*\[GHI-1\] Work/)
  })
})
