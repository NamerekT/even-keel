import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BuiltinStore } from '../builtin/store.js'
import { commitAndMerge, Gate, type Turn } from './agent.fixture.js'
import { Elsewhere } from './elsewhere.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'
import { scaled } from '../../test/slow-runner.js'

const IDENTITY = ['-c', 'user.name=John Doe', '-c', 'user.email=john@example.com']
const HELD = 'the next task waits while ABC-1 resolves its landing'

describe('the landing hold over two machines end to end (BTN-1582)', { timeout: scaled(240_000) }, () => {
  let run: Harness
  let elsewhere: Elsewhere
  let pushes = 0
  /** Holds ABC-1's turn after its conflict came back: the session resolving its landing. */
  let resolve: Gate
  /** Holds ABC-2's turn until ABC-1 resolves, so it lands and frees its lane meanwhile. */
  let second: Gate

  beforeEach(() => {
    run = new Harness()
    elsewhere = new Elsewhere(run)
    pushes = 0
    resolve = new Gate()
    second = new Gate()
  })

  afterEach(async () => {
    resolve.open()
    second.open()
    await elsewhere.stop()
    await run.stop()
  })

  const statusOf = async (number: number) => (await new BuiltinStore(run.service.db).get({ project: PROJECT_ID, number }))?.status.name
  const landing = () => run.service.dispatcher.state.landings[PROJECT_ID]?.find((each) => each.task === 'ABC-1')
  const launched = (task: string) => run.agent.calls.some((call) => call.kind === 'launch' && call.task === task)

  /** Another clone of the remote pushes `file` with `text` to its main: work that landed meanwhile. */
  async function pushedElsewhere(file: string, text: string): Promise<void> {
    const other = join(run.dir, `other-${++pushes}`)
    run.gitIn(run.dir, 'clone', '-q', '-c', 'core.autocrlf=false', run.remote, other)
    await writeFile(join(other, file), text)
    run.gitIn(other, 'add', file)
    run.gitIn(other, ...IDENTITY, 'commit', '-q', '-m', `Elsewhere ${pushes}`)
    run.gitIn(other, 'push', '-q', 'origin', 'main')
  }

  /** ABC-1 merges a line the remote changed meanwhile; back from the landing it waits for `resolve`, then merges again. */
  const conflicting: Turn[] = [
    async ({ task, cwd, repo, git }) => {
      await pushedElsewhere('shared.txt', 'elsewhere\n')
      await writeFile(join(cwd, 'shared.txt'), `${task}\n`)
      await git('add', 'shared.txt')
      await git('commit', '-m', `[${task}] Work`)
      run.gitIn(repo, 'merge', '--no-edit', await git('rev-parse', '--abbrev-ref', 'HEAD'))
      return { say: `${task} merged` }
    },
    async (turn) => {
      await turn.park(resolve)
      await turn.git('merge', '--no-edit', 'origin/main').catch(() => 'conflict')
      await writeFile(join(turn.cwd, 'shared.txt'), `${turn.task}\nelsewhere\n`)
      await turn.git('add', 'shared.txt')
      await turn.git('commit', '--no-edit')
      run.gitIn(turn.repo, 'merge', '--no-edit', await turn.git('rev-parse', '--abbrev-ref', 'HEAD'))
      return { say: `${turn.task} merged again` }
    },
  ]

  /** Three tasks of the built-in tracker on the own machine and one elsewhere, two at once. */
  async function twoLanes(hold: boolean): Promise<void> {
    run.forge = true
    run.project.tracker = 'builtin'
    if (!hold) run.project.landingHold = false
    run.agent.script('ABC-1', ...conflicting)
    run.agent.script('ABC-2', async (turn) => {
      await turn.park(second)
      return commitAndMerge('two.txt')(turn)
    })
    run.agent.script('ABC-3', commitAndMerge('three.txt'))
    await run.start(() => elsewhere.prepare())
    await run.post('packages/plugin', { plugin: 'tasks', marketplace: 'even-keel', project: PROJECT_ID })
    await run.until(() => run.service.packages.unready(PROJECT_ID).length === 0, 'the tasks package installed on the hub')
    for (const title of ['One', 'Two', 'Three']) await run.post('builtin/create', { project: PROJECT_ID, title })
    const machine = await elsewhere.join()
    await run.post('machines/connect', { project: PROJECT_ID, machine, clone: true })
    let enabled = false
    await run.until(() => {
      void run.answer<{ machines: { id: string; enabled: boolean }[] }>('machines/pool', { project: PROJECT_ID }).then(({ machines }) => (enabled = machines.some((row) => row.id === machine && row.enabled)))
      return enabled
    }, 'the machine connected', { step: 500 })
    await run.until(() => !elsewhere.host.packages.blocked(PROJECT_ID), 'the packages of the machine ready')
    run.service.configStore.saveWidth(PROJECT_ID, 2)
    await run.startChain(PROJECT_ID)
    await run.until(() => landing()?.resolving !== undefined && landing()?.waitingRemote === undefined, `ABC-1 resolving its landing: ${JSON.stringify(landing())}`, { limitMs: 10 * 60_000 })
    second.open()
    let two: string | undefined
    await run.until(() => {
      void statusOf(2).then((status) => (two = status))
      return two === 'Done'
    }, 'ABC-2 landed and done', { limitMs: 10 * 60_000 })
  }

  const done = async (number: number) => {
    let last: string | undefined
    await run.until(() => {
      void statusOf(number).then((status) => (last = status))
      return last === 'Done'
    }, `ABC-${number} done`, { limitMs: 10 * 60_000 })
  }

  it('starts no next task while ABC-1 resolves its landing, and starts it once ABC-1 lands', async () => {
    await twoLanes(true)
    await run.until(() => run.log.some((line) => line.includes(HELD)), 'the hold logged')
    // The freed lane keeps waiting: the hold is the only thing between it and ABC-3.
    let ticks = 0
    await run.until(() => ++ticks > 30 || launched('ABC-3'), 'half a minute of the service')
    expect(launched('ABC-3')).toBe(false)
    expect(run.log.filter((line) => line.includes(HELD))).toHaveLength(1)

    resolve.open()
    await done(1)
    await run.until(() => launched('ABC-3'), 'ABC-3 launched after ABC-1 landed', { limitMs: 10 * 60_000 })
  })

  it('with landingHold off starts the next task while ABC-1 still resolves', async () => {
    await twoLanes(false)
    await run.until(() => launched('ABC-3'), 'ABC-3 launched while ABC-1 resolves', { limitMs: 10 * 60_000 })
    expect(landing()?.resolving).toBeDefined()
    expect(run.log.some((line) => line.includes(HELD))).toBe(false)
  })
})
