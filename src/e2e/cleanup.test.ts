import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge, Gate, parked, type Turn } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

describe('what a project leaves behind', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const launches = () => run.agent.calls.filter((call) => call.kind === 'launch')
  const chain = () => run.service.dispatcher.state.active.find((each) => each.project === PROJECT_ID)

  it('refuses to remove a project while its chain runs and its session lives, and removes it once both are over', async () => {
    run.board.add('ABC-1')
    const gate = new Gate()
    run.agent.script('ABC-1', parked(gate, commitAndMerge()))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.service.sessions.some((view) => view.task === 'ABC-1'), 'the session of ABC-1 seen')
    const [first] = launches()

    const refusal = await run.refused('project/remove', { project: PROJECT_ID })
    expect(refusal).toMatchObject({
      code: 'project.removeBlocked',
      items: expect.arrayContaining([
        expect.objectContaining({ code: 'project.removeChain' }),
        expect.objectContaining({ code: 'project.removeSessions', params: { sessions: [expect.stringContaining('ABC-1')] } }),
      ]),
    })
    expect(run.service.configStore.current.projects[PROJECT_ID]).toBeDefined()

    gate.open()
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    await run.until(() => chain() === undefined && !existsSync(first!.cwd), 'the chain over and the worktree removed')
    await run.until(() => run.service.sessions.find((view) => view.sessionId === first!.sessionId)?.lamp === 'finished', 'the session of ABC-1 finished')
    await run.post('project/remove', { project: PROJECT_ID })
    expect(run.service.configStore.current.projects[PROJECT_ID]).toBeUndefined()
  })

  it.skipIf(process.platform !== 'win32')('removes a worktree after Done that holds an ignored file at a path past 260 characters', async () => {
    /** Leaves an ignored build output at a 373-character path, as a nested `node_modules` does. */
    const deep: Turn = async (turn) => {
      const nested = Array.from({ length: 40 }, (_, index) => `level-${String(index).padStart(2, '0')}`).join('\\')
      const file = join(turn.cwd, '.temp', nested).slice(0, 360)
      await mkdir(file, { recursive: true })
      await writeFile(join(file, 'out.txt'), 'built\n')
      expect(join(file, 'out.txt').length).toBeGreaterThan(260)
      return commitAndMerge()(turn)
    }
    run.board.add('ABC-1')
    run.agent.script('ABC-1', deep)
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    const [first] = launches()
    await run.until(() => !existsSync(first!.cwd), 'the worktree of ABC-1 removed')
    expect(run.service.dispatcher.state.leftovers).toEqual({})
    expect(run.git('worktree', 'list').split('\n')).toHaveLength(1)
  })
})
