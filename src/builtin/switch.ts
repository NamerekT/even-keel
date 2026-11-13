import type { ChainState } from '../chain/model.js'
import { formsOf, withTrackerMove, type TrackerMove } from '../config-form.js'
import { idPrefixOf, parseConfig, projectLabel, readersOf, type EvenKeelConfig } from '../config.js'
import { fail, notice, type Notice } from '../notice/notice.js'
import type { ProfileSet } from '../profiles/model.js'
import type { ExportRow } from '../tracker/export.js'
import type { ExportHeader, ExportTargetFields } from './export-store.js'

/**
 * The switch of a built-in project to the tracker its tasks were copied into (BTN-1074): the project's tracker, place,
 * key and profile become the copy's target, and the dispatcher's own state of its tasks — the saved order, the skips,
 * the tasks' runs — follows them to their new ids. The history stays under the old ids; `tracker_export_tasks` links
 * them. The copy is BTN-1073 (`export.ts`).
 */

export interface SwitchDeps {
  config(): EvenKeelConfig
  /** The settings in the shape of the config file (`ConfigStore.raw`). */
  raw(): Record<string, unknown>
  profiles(): ProfileSet
  chain(): Readonly<ChainState>
  /** Moves the dispatcher's state and the tasks' runs to the new ids. */
  rename(project: string, names: ReadonlyMap<string, string>): void
  /** Writes the project's new tracker and links it to the profile. */
  move(project: string, move: TrackerMove, profile: string): void
}

/** The project's built-in tasks as the switch needs them: each one's row id, its id and whether it is open. */
export interface SwitchTask {
  ref: string
  id: string
  open: boolean
}

export interface SwitchInput {
  project: string
  header: ExportHeader | null
  rows: readonly ExportRow[]
  tasks: readonly SwitchTask[]
}

/** What the switch did: the tracker it moved to and the old ids with their new ones. */
export interface Switched {
  move: TrackerMove
  names: Map<string, string>
}

export function switchTracker(deps: SwitchDeps, { project, header, rows, tasks }: SwitchInput): Switched {
  const config = deps.config()
  if (header === null || header.finishedAt === null) throw fail('switch.noCopy', { key: projectLabel(config, project) })
  const copied = new Map(rows.flatMap((row) => (row.stage === 'marked' && row.key !== null ? [[row.ref, row.key] as const] : [])))
  const left = tasks.filter((task) => task.open && !copied.has(task.ref)).map((task) => task.id)
  if (left.length > 0) throw fail('switch.notCopied', { tasks: left })
  const holds = switchHolds(deps.chain(), project)
  if (holds.length > 0) throw fail('switch.held', { key: projectLabel(config, project) }, { items: holds })

  const { move, profile } = checkMove(deps, project, header)
  const names = new Map(tasks.flatMap((task) => (copied.has(task.ref) ? [[task.id, copied.get(task.ref)!] as const] : [])))
  deps.rename(project, names)
  deps.move(project, move, profile)
  return { move, names }
}

/**
 * The project as it would be on the copy's target, checked as the config would be, its tasks' prefix by `checkPrefix`:
 * the copy asks it before a task is created there, since a copy goes on only with the target it began with.
 */
export function checkMove(deps: Pick<SwitchDeps, 'config' | 'raw' | 'profiles'>, project: string, target: ExportTargetFields): { move: TrackerMove; profile: string } {
  const config = deps.config()
  const profile = deps.profiles().profiles.find((each) => each.id === target.profile)
  if (profile === undefined) throw fail('profiles.unknown', {})
  const move: TrackerMove = { tracker: profile.kind, trackerProject: target.place === '' ? null : target.place, key: target.key }
  checkPrefix(config, project, move)
  parseConfig(withTrackerMove(deps.raw(), project, move, formsOf(config).projects[project]!, profile.rules))
  return { move, profile: profile.id }
}

/**
 * What keeps the project on its tracker now: a chain that runs or waits in the queue, a task the chain holds, released
 * tasks whose sessions rest, open pull requests. Each of them names tasks by their old ids.
 */
export function switchHolds(state: Readonly<ChainState>, project: string): Notice[] {
  const holds: Notice[] = []
  const chain = state.active.find((each) => each.project === project)
  if ((chain !== undefined && !chain.paused) || state.queue.includes(project)) holds.push(notice('switch.chainRuns', {}))
  if (chain?.current != null) holds.push(notice('switch.current', { task: chain.current.task }))
  const released = [...new Set([...(state.released[project] ?? []), ...(state.shelved[project] ?? []).map((each) => each.task)])]
  if (released.length > 0) holds.push(notice('switch.released', { tasks: released }))
  const reviews = (state.reviews[project] ?? []).map((each) => each.task)
  if (reviews.length > 0) holds.push(notice('switch.reviews', { tasks: reviews }))
  return holds
}

/**
 * The new tasks' prefix is neither the old one nor another project's or feed's: otherwise the old `ABC-5` and the new
 * `ABC-5` would be one task in the launch log, the archive, the branches and the stats. Case aside, as branches are.
 * Asked before the config's own checks: a feed's `config.feedPrefix` would name the clash without saying what to do.
 */
export function checkPrefix(config: EvenKeelConfig, project: string, move: TrackerMove): void {
  const readers = readersOf(config)
  const place = move.trackerProject ?? undefined
  const moved = {
    keys: { ...readers.keys, [project]: move.key },
    trackers: { ...readers.trackers, [project]: move.tracker },
    trackerProjects: Object.fromEntries([...Object.entries(readers.trackerProjects).filter(([id]) => id !== project), ...(place === undefined ? [] : [[project, place]])]),
  }
  const prefix = idPrefixOf(moved, project)
  const same = (other: string) => other.toLowerCase() === prefix.toLowerCase()
  if (same(idPrefixOf(config, project))) throw fail('switch.samePrefix', { prefix })
  const other = Object.keys(readers.projects).find((reader) => reader !== project && same(idPrefixOf(readers, reader)))
  if (other === undefined) return
  const owner = readers.owners[other]
  const label = owner === undefined ? projectLabel(config, other) : `${projectLabel(config, owner)} · ${readers.keys[other]}`
  throw fail('switch.prefixTaken', { prefix, other: label })
}
