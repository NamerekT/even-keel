import { existsSync, readFileSync } from 'node:fs'
import { ADAPTERS } from '../tracker/adapters.js'
import type { TrackerAdapter, TrackerPlace } from '../tracker/source.js'

/**
 * A live tracker the contract runs against (`docs/trackers.md`, "Contract tests on live trackers"): a test project of its
 * own, credentials outside git. The matrix is the list of stands; a new tracker is one more entry.
 */
export interface Stand {
  /** Unique within the file: `gitlab-ce` and `gitlab-com` are two stands of one adapter. */
  name: string
  /** The adapter's name in `ADAPTERS`. */
  tracker: string
  /** A profile's values, by the adapter's variables. */
  values: Record<string, string>
  /** The project as a project entry names it: the key and the value of the adapter's `projectKey`. */
  place: TrackerPlace
  /** Two tasks of the stand seeded once by hand, the first blocking the second: the contract has no write of a link. */
  blocks?: [string, string]
  /** A status of the `Active` category to move a task to, for an adapter with `moves`. */
  active?: string
  /** The `Won` status `complete` takes; none — the tracker's first done one. */
  done?: string
}

/** The variable that holds the stands: their JSON itself (a CI secret) or the path of a file with it. */
export const STANDS_VARIABLE = 'EVEN_KEEL_TRACKER_STANDS'

export function readStands(env: NodeJS.ProcessEnv = process.env): Stand[] {
  const raw = env[STANDS_VARIABLE]?.trim()
  if (raw === undefined || raw === '') return []
  const text = raw.startsWith('[') || raw.startsWith('{') ? raw : existsSync(raw) ? readFileSync(raw, 'utf8') : null
  if (text === null) throw new Error(`${STANDS_VARIABLE} names no file: ${raw}`)
  const parsed: unknown = JSON.parse(text)
  const list = Array.isArray(parsed) ? parsed : (parsed as { stands?: unknown }).stands
  if (!Array.isArray(list)) throw new Error(`${STANDS_VARIABLE}: expected a list of stands or { "stands": [...] }`)
  const stands = list.map((entry, index) => checked(entry as Stand, index))
  const names = stands.map((stand) => stand.name)
  const twice = names.find((name, index) => names.indexOf(name) !== index)
  if (twice !== undefined) throw new Error(`${STANDS_VARIABLE}: the stand ${twice} is named twice`)
  return stands
}

function checked(stand: Stand, index: number): Stand {
  const where = `${STANDS_VARIABLE}, stand ${stand.name ?? index}`
  if (typeof stand.name !== 'string' || stand.name === '') throw new Error(`${where}: no name`)
  if (ADAPTERS[stand.tracker] === undefined) throw new Error(`${where}: no adapter ${stand.tracker}`)
  if (typeof stand.place?.key !== 'string') throw new Error(`${where}: no place.key`)
  if (typeof stand.values !== 'object' || stand.values === null) throw new Error(`${where}: no values`)
  return stand
}

/**
 * Stands up only on demand (self-hosted Huly since 2026-11-22) are split from the night: the night passes over the ones
 * in `SKIP_VARIABLE`, the run before a release takes only those in `ONLY_VARIABLE`. Each holds stand names or adapter
 * names, comma-separated.
 */
export const SKIP_VARIABLE = 'EVEN_KEEL_TRACKER_STANDS_SKIP'
export const ONLY_VARIABLE = 'EVEN_KEEL_TRACKER_STANDS_ONLY'

export interface StandSelection {
  run: Stand[]
  skipped: { stand: Stand; reason: string }[]
}

export function selectStands(stands: readonly Stand[], env: NodeJS.ProcessEnv = process.env): StandSelection {
  const only = namesIn(env[ONLY_VARIABLE])
  const skip = namesIn(env[SKIP_VARIABLE])
  const named = (names: Set<string>, stand: Stand): boolean => names.has(stand.name) || names.has(stand.tracker)
  const lacking = [...only].filter((name) => !stands.some((stand) => stand.name === name || stand.tracker === name))
  if (lacking.length > 0) throw new Error(`${ONLY_VARIABLE} names no stand: ${lacking.join(', ')}`)
  const selection: StandSelection = { run: [], skipped: [] }
  for (const stand of stands) {
    if (only.size > 0 && !named(only, stand)) selection.skipped.push({ stand, reason: `not in ${ONLY_VARIABLE}` })
    else if (named(skip, stand)) selection.skipped.push({ stand, reason: `up only on demand (${SKIP_VARIABLE}), run before a release` })
    else selection.run.push(stand)
  }
  return selection
}

function namesIn(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map((name) => name.trim()).filter((name) => name !== ''))
}

export const adapterOf =(stand: Stand): TrackerAdapter => ADAPTERS[stand.tracker]!

/** The prefix of the stand's task ids: `TT` of Linear's `TT-12` when the key is Even Keel's own. */
export function idPrefix(stand: Stand): string {
  const placeOf = adapterOf(stand).projectKey?.placeOf
  return placeOf === undefined ? stand.place.key : placeOf(stand.place.key, stand.place.value).ids
}
