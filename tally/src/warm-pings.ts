import { readWarmPings, type StoredWarmPing } from '../../src/sessions/warm-pings.js'
import { stateValue } from '../../src/storage/service-state.js'
import type { Queryable } from '../../src/storage/database.js'
import { machineAccount } from './machine-rows.js'

/**
 * The pings Even Keel kept (BTN-1413) as Tally's `warm_pings` takes them (step 20), each under the account its
 * machine's messages go by: the hub's own with no machine, a machine elsewhere's as `<key>@<machine>`. `undefined` — a
 * database before Even Keel's step 70.
 */
export async function warmPings(db: Queryable): Promise<StoredWarmPing[] | undefined> {
  const pings = await readWarmPings(db).catch(() => undefined)
  if (pings === undefined) return undefined
  const own = await stateValue(db, 'machines.own')
  return pings.map((ping) => (ping.machine === own ? { ...ping, machine: '' } : { ...ping, account: machineAccount(ping.account, ping.machine) }))
}
