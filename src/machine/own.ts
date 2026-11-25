import { createHash } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { HubStore } from '../link/hub-store.js'
import type { HubEnd } from '../link/hub.js'
import { storedToken, storeToken } from '../link/machine-store.js'
import { parseToken, type ConnectionToken } from '../link/protocol.js'
import type { Queryable } from '../storage/database.js'
import { setStateValue, stateValue } from '../storage/service-state.js'

/** The address in the token of a machine that shares its hub's process: never dialled, the carrier is a call. */
export const LOCAL_HUB = 'https://localhost'

export interface OwnMachineDeps {
  hub: HubEnd
  hubStore: HubStore
  /** The state database: the hub's side. */
  db: Queryable
  /** The machine's own database, which keeps the token. */
  machineDb: PGlite
  /** How the machine is called in the hub's list. */
  name: string
}

/**
 * The machine this installation itself is (`docs/machines/seam.md`, "One process"): made at the first start of a version
 * that has machines, found again at every later one. The hub's database names it (`machines.own`) and keeps the hash
 * of its secret, the machine's database keeps the token; when the two no longer agree — one of the folders was
 * restored or removed — a new machine is made and the old one revoked. The old one's place in the projects' pools
 * goes to the new one; the tasks it held stay with it, for a person to move (BTN-1270).
 */
export async function ownMachine(deps: OwnMachineDeps): Promise<ConnectionToken> {
  const { hub, hubStore, db, machineDb } = deps
  const line = await storedToken(machineDb)
  const kept = line === undefined ? undefined : parseToken(line)
  const named = await stateValue(db, 'machines.own')
  if (kept !== undefined && kept.machine === named) {
    const record = await hubStore.machine(kept.machine)
    if (record !== undefined && record.revokedAt === null && record.secretHash === createHash('sha256').update(kept.secret).digest('hex')) return kept
  }
  const issued = await hub.issue(deps.name, LOCAL_HUB, '')
  const token = parseToken(issued)
  if (token === undefined) throw new Error('link: the token of the own machine could not be read back')
  // A state database restored on another host, or beside a lost machine folder: the projects keep running here.
  if (typeof named === 'string') await db.query('update project_machines set machine_id = $2 where machine_id = $1', [named, token.machine])
  for (const old of new Set([named, kept?.machine])) if (typeof old === 'string') await hub.revoke(old)
  await storeToken(machineDb, issued)
  await setStateValue(db, 'machines.own', token.machine)
  return token
}
