import type { Queryable } from '../storage/database.js'
import { setStateValue, stateValue } from '../storage/service-state.js'
import { createCertificate, type HubCertificate } from './cert.js'

const isCertificate = (value: unknown): value is HubCertificate => {
  if (typeof value !== 'object' || value === null) return false
  const { cert, key, fingerprint } = value as Record<string, unknown>
  return typeof cert === 'string' && typeof key === 'string' && typeof fingerprint === 'string'
}

/**
 * The hub's certificate and key for machines, made at the first call and kept in the state database
 * (`machines.certificate`): every connection token pins it, so a new one would turn every machine away.
 */
export async function hubIdentity(db: Queryable): Promise<HubCertificate> {
  const kept = await stateValue(db, 'machines.certificate')
  if (isCertificate(kept)) return kept
  const made = createCertificate()
  await setStateValue(db, 'machines.certificate', made)
  return made
}
