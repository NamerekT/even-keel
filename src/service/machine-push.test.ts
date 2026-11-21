import { beforeEach, describe, expect, it, vi } from 'vitest'
import { launchBriefs } from './chain-prompts.js'
import type { MachineContext } from './machine-context.js'

const pushed = vi.hoisted(() => vi.fn(async () => ({ remote: 'origin', branch: 'abc-1/task' })))
vi.mock('../git/push.js', async (original) => ({ ...(await original<typeof import('../git/push.js')>()), pushTaskBranch: pushed }))

const { pushOf } = await import('./machine-chain.js')

const folder = 'C:/example/repo/.claude/worktrees/abc-1'

function contextOf(pullRequests = false) {
  const briefed = launchBriefs()
  const ctx = {
    configStore: { current: { projects: { p1: 'C:/example/repo' }, trackers: {}, settings: {} } },
    branchOf: () => 'trunk',
    pullRequestsOn: () => pullRequests,
    briefed,
  } as unknown as MachineContext
  return { ctx, briefed }
}

const optionsOf = () => (pushed.mock.calls.at(-1) as unknown as [unknown, string, string, { held?: unknown; onlyNew?: boolean; main: string }])[3]

describe('pushOf and an outsider’s task (BTN-1419)', () => {
  beforeEach(() => pushed.mockClear())

  it('pushes a task the hub vouched for as not an outsider’s without looking at its files', async () => {
    const { ctx, briefed } = contextOf()
    briefed.apply('ABC-1', '', { prompt: 'Task text', own: true })
    await pushOf(ctx, 'p1', 'ABC-1', folder, true)
    expect(optionsOf()).toEqual({ main: 'trunk', onlyNew: true })
  })

  it('keeps the guarded files check for an outsider’s task, or one the hub said nothing of', async () => {
    const { ctx, briefed } = contextOf()
    briefed.apply('ABC-1', '', { prompt: 'Task text' })
    await pushOf(ctx, 'p1', 'ABC-1', folder)
    expect(optionsOf().held).toBeTypeOf('function')
    await pushOf(ctx, 'p1', 'ABC-2', folder)
    expect(optionsOf().held).toBeTypeOf('function')
  })

  it('pushes at the end of a turn in PR mode too, with the same check', async () => {
    const { ctx, briefed } = contextOf(true)
    await pushOf(ctx, 'p1', 'ABC-2', folder, true)
    expect(optionsOf()).toMatchObject({ main: 'trunk', onlyNew: true })
    expect(optionsOf().held).toBeTypeOf('function')
    briefed.apply('ABC-1', '', { prompt: 'Task text', own: true })
    await pushOf(ctx, 'p1', 'ABC-1', folder, true)
    expect(optionsOf()).toEqual({ main: 'trunk', onlyNew: true })
  })
})
