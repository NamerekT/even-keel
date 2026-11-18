import { existsSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BuiltinStore } from '../builtin/store.js'
import { commitAndMerge } from './agent.fixture.js'
import { Elsewhere } from './elsewhere.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

const TASKS = 'tasks@even-keel'

interface PoolRow {
  id: string
  own: boolean
  enabled: boolean
}

describe('a machine elsewhere end to end', { timeout: 180_000 }, () => {
  let run: Harness
  let elsewhere: Elsewhere

  beforeEach(() => {
    run = new Harness()
    elsewhere = new Elsewhere(run)
  })

  afterEach(async () => {
    await elsewhere.stop()
    await run.stop()
  })

  const statusOf = async (number: number) => (await new BuiltinStore(run.service.db).get({ project: PROJECT_ID, number }))?.status.name
  const installsOf = (file: string): string[] => {
    const read = JSON.parse(readFileSync(file, 'utf8')) as { packages: Record<string, { installs: { id: string }[] }> }
    return (read.packages[TASKS]?.installs ?? []).map((install) => install.id)
  }

  it("without a catalog of its own takes the tasks package under the hub's install and runs a task of the built-in tracker (BTN-1306)", async () => {
    run.forge = true
    run.project.tracker = 'builtin'
    run.agent.script('ABC-1', commitAndMerge('ABC-1.txt'))
    await run.start(() => elsewhere.prepare())
    await run.post('packages/plugin', { plugin: 'tasks', marketplace: 'even-keel', project: PROJECT_ID })
    await run.until(() => run.service.packages.view().packages.some((each) => each.name === TASKS && each.installed) && run.service.packages.unready(PROJECT_ID).length === 0, 'the tasks package installed on the hub')
    const hubInstalls = installsOf(join(run.dir, 'data', 'state', 'packages.json'))
    expect(hubInstalls).toHaveLength(1)
    await run.post('builtin/create', { project: PROJECT_ID, title: 'Work elsewhere' })

    const machine = await elsewhere.join()
    // Only the built-in package was seeded there: the tracker's server is missing until the hub's catalog comes.
    expect(elsewhere.host.packages.view().packages.map((each) => each.name)).not.toContain(TASKS)
    await run.post('machines/connect', { project: PROJECT_ID, machine, clone: true })
    const pool = async () => (await run.answer<{ machines: PoolRow[] }>('machines/pool', { project: PROJECT_ID })).machines
    let rows: PoolRow[] = []
    await run.until(() => {
      void pool().then((each) => (rows = each))
      return rows.some((row) => row.id === machine && row.enabled)
    }, 'the machine connected', { step: 500 })
    const own = rows.find((row) => row.own)!
    await run.post('machines/enable', { project: PROJECT_ID, machine: own.id, enabled: false })

    expect(existsSync(join(elsewhere.checkout, '.git'))).toBe(true)
    expect(installsOf(join(elsewhere.dir, 'state', 'packages.json'))).toEqual(hubInstalls)
    expect(existsSync(join(elsewhere.dir, 'state', 'packages', TASKS, hubInstalls[0]!))).toBe(true)
    expect(elsewhere.host.packages.trackerMissing(PROJECT_ID)).toBeUndefined()
    // The servers the hub runs answer the machine's gateway over the link once probed.
    await run.until(() => !elsewhere.host.packages.blocked(PROJECT_ID), `the packages of the machine ready: ${JSON.stringify(elsewhere.host.packages.check(PROJECT_ID).cells)}`)

    await run.startChain(PROJECT_ID)
    let last: string | undefined
    await run.until(() => {
      void statusOf(1).then((status) => (last = status))
      return last === 'Done'
    }, 'ABC-1 done', { limitMs: 10 * 60_000 })

    const launches = run.agent.calls.filter((call) => call.kind === 'launch')
    expect(launches.map((call) => call.task)).toEqual(['ABC-1'])
    expect(launches[0]!.cwd.startsWith(elsewhere.checkout + sep) || launches[0]!.cwd.startsWith(`${elsewhere.checkout}/`)).toBe(true)
    expect(run.gitIn(elsewhere.checkout, 'log', '--format=%s', 'main').split('\n')).toContain('[ABC-1] Work')
  })
})
