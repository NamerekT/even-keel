import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseConfig } from '../config.js'
import { root } from '../locations.js'
import { trackerGroupsOwned, trackersOwned } from '../storage/migrations.js'
import { FULL } from './full.fixture.js'

// The output of `parseConfig` as it was before the settings registry (BTN-186): the registry changes the way from the
// file to `EvenKeelConfig`, not the result. A sample older than v13 is read as its upgrade leaves it: its shared tracker
// moved into its projects (BTN-345); one older than v20 has its tracker group of Protection split per tracker (BTN-541).
const fixtures = join(root, 'test', 'fixtures')
const samples = readdirSync(fixtures).filter((name) => name.startsWith('schema-v'))
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const owned = (raw: { version?: number }) => {
  const trackers = (raw.version ?? 1) < 13 ? trackersOwned(raw) : raw
  return (raw.version ?? 1) < 20 ? trackerGroupsOwned(trackers) : trackers
}
const golden = (name: string) => `./golden/${name}.json`
const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

describe('the config of the file', () => {
  for (const name of samples) {
    it(`reads ${name}`, async () => {
      await expect(text(parseConfig(owned(json(join(fixtures, name, 'even-keel.config.json')))))).toMatchFileSnapshot(golden(name))
    })
  }

  it('reads the example config', async () => {
    await expect(text(parseConfig(json(join(root, 'even-keel.config.example.json'))))).toMatchFileSnapshot(golden('example'))
  })

  it('reads a config with every key', async () => {
    await expect(text(parseConfig(FULL))).toMatchFileSnapshot(golden('full'))
  })
})
