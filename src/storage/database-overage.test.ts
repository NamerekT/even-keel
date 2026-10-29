import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { loadChainState, saveChainState } from '../chain/store.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'

it('step 18 preserves old state and freezes retained paid-usage stops for restart', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined)
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(18))
    expect(await databaseVersion(frozen)).toBe(18)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 18)
    const state = await loadChainState(frozen)
    expect(state.active[0]?.current?.limit?.overage).toMatchObject({
      stopped: true,
      session: { sessionId: state.active[0]?.current?.sessionId, workdir: 'C:/repos/example-project/.claude/worktrees/abc-2', checkpoint: '.temp/handoff.md' },
    })
    await saveChainState(made, state)
    expect((await loadChainState(made)).active).toEqual(state.active)
    await upgraded.exec(fixture(17))
    const old = await loadChainState(upgraded)
    await upgraded.exec(STEPS.at(-1)!)
    expect((await loadChainState(upgraded)).active).toEqual(old.active)
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
