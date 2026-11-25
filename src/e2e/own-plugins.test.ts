import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../storage/schema.js'
import { Elsewhere } from './elsewhere.fixture.js'
import { Harness } from './service.fixture.js'
import { scaled } from '../../test/slow-runner.js'

const BRIDGE = 'agent-bridge@even-keel'
const OLD = '0.0.1'

/** The version of the built-in plugin in this checkout, the marketplace the service offers its own plugins from. */
const offered = (JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'plugins', 'agent-bridge', '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }).version

/** `state/packages.json` in `state` with only the built-in package, on an install older than the checkout's. */
function seedOld(state: string): string {
  const file = join(state, 'packages.json')
  mkdirSync(state, { recursive: true })
  const old = { id: 'old', version: OLD, at: '2026-11-01T00:00:00.000Z', servers: {}, extras: true }
  const packages = { [BRIDGE]: { kind: 'plugin', plugin: { name: 'agent-bridge', marketplace: 'even-keel' }, default: true, settings: {}, installs: [old] } }
  writeFileSync(file, JSON.stringify({ version: SCHEMA_VERSION, packages, projects: {}, pins: {} }))
  return file
}

const replaced = (log: string[]) => log.filter((line) => line.includes(`${BRIDGE} ${offered} in Even Keel's marketplace replaces ${OLD}`))

describe('a newer plugin in Even Keel’s own marketplace, through the service’s own assembly (BTN-1689)', { timeout: scaled(180_000) }, () => {
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

  it('becomes the current install on the hub’s own machine by itself, with a line in the log', async () => {
    let file = ''
    await run.start(() => void (file = seedOld(join(run.dir, 'data', 'state'))))
    const versions = () => (JSON.parse(readFileSync(file, 'utf8')) as { packages: Record<string, { installs: { version: string | null }[] }> }).packages[BRIDGE]!.installs.map((each) => each.version)
    await run.until(() => versions().at(-1) === offered, `${BRIDGE} ${offered} installed`)
    expect(replaced(run.log)).toHaveLength(1)
  })

  it('is left to the hub on a machine elsewhere, which follows the hub’s installs', async () => {
    run.forge = true
    await run.start(() => {
      elsewhere.prepare()
      seedOld(join(elsewhere.dir, 'state'))
    })
    await elsewhere.join()
    await run.pass(2 * 60_000)
    // The machine's packages log through `console`, into the bench's log: the hub's own catalog has no old install.
    expect(replaced(run.log)).toEqual([])
  })
})
