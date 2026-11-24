import { expect, it } from 'vitest'
import { refreshShares } from './limit-shares-stored.js'

// When a collector run refreshes the stored limit shares (BTN-1658): only after it wrote rows they are computed from.

function counted() {
  const db = { refreshes: 0, refreshLimitShares: async () => void db.refreshes++ }
  return db
}

it('keeps the shares after a run that wrote nothing they are computed from', async () => {
  const db = counted()
  expect(await refreshShares(db, { lines: 0, snapshots: 0, pings: 0 })).toBe('limit shares kept')
  expect(db.refreshes).toBe(0)
})

it('refreshes them once after new lines, limit snapshots or keep-warm pings', async () => {
  for (const run of [{ lines: 3, snapshots: 0, pings: 0 }, { lines: 0, snapshots: 1, pings: 0 }, { lines: 0, snapshots: 0, pings: 2 }]) {
    const db = counted()
    let clock = 1_000
    expect(await refreshShares(db, run, () => (clock += 1_200))).toBe('limit shares refreshed in 1.2 s')
    expect(db.refreshes).toBe(1)
  }
})
