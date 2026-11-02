import type { Patch } from '../../../src/patch.js'

/** The data after a patch of the service (`EventHub`): the parts and entries it does not name stay the same objects. */
export function applyPatch<T extends object>(base: T, patch: Patch): T {
  const next: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const name of patch.gone ?? []) delete next[name]
  Object.assign(next, patch.parts)
  for (const [name, { by, order, changed }] of Object.entries(patch.keyed ?? {})) {
    const idOf = (entry: unknown) => (entry as Record<string, unknown>)[by] as string
    const old = Array.isArray(next[name]) ? (next[name] as unknown[]) : []
    const byId = new Map(old.map((entry) => [idOf(entry), entry]))
    for (const entry of changed) byId.set(idOf(entry), entry)
    next[name] = (order ?? old.map(idOf)).map((id) => byId.get(id))
  }
  return next as T
}
