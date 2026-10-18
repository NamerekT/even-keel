import type { EvenKeelState, RemoteRef } from '../../../src/state.js'
import { chainStatus, openQuestions, projectTasks } from '../state.js'
import { emptyKind } from './ProjectCard.js'

/** How Home groups the cards: by the repository their checkouts share, by tracker connection, or both (BTN-207). */
export type Grouping = 'remote' | 'tracker' | 'both'

export const GROUPINGS: readonly Grouping[] = ['remote', 'tracker', 'both']

export const parseGrouping = (text: string | null): Grouping => GROUPINGS.find((grouping) => grouping === text) ?? 'remote'

/** `working` — the chain runs, waits in the queue or on a pause, or a question is open; `quiet` — nothing to run. */
export type Zone = 'working' | 'cards' | 'quiet'

export interface HomeSection {
  title: string | null
  projects: string[]
}

/** A group of projects; the one without a title holds the projects left alone in theirs, after the groups. */
export interface HomeBlock {
  title: string | null
  sections: HomeSection[]
}

interface GroupFacts {
  remotes: Record<string, RemoteRef[]>
  trackers: { name: string; title: string; projects: string[] }[]
}

interface Group {
  title: string
  projects: string[]
}

export function homeBlocks(grouping: Grouping, projects: string[], facts: GroupFacts): HomeBlock[] {
  const groups = grouping === 'tracker' ? trackerGroups(projects, facts.trackers) : remoteGroups(projects, facts.remotes)
  const lone = projects.filter((key) => !groups.some((group) => group.projects.includes(key)))
  const blocks: HomeBlock[] = groups.map((group) => ({
    title: group.title,
    sections: grouping === 'both' ? trackerSections(group.projects, facts.trackers) : [{ title: null, projects: group.projects }],
  }))
  if (lone.length > 0) blocks.push({ title: null, sections: [{ title: null, projects: lone }] })
  return blocks
}

/** Projects that share a remote, directly or through another project; groups of one are left out. */
function remoteGroups(projects: string[], remotes: Record<string, RemoteRef[]>): Group[] {
  const root = new Map(projects.map((key) => [key, key]))
  const find = (key: string): string => {
    const parent = root.get(key)!
    if (parent === key) return key
    const top = find(parent)
    root.set(key, top)
    return top
  }
  const owner = new Map<string, string>()
  for (const key of projects) {
    for (const { id } of remotes[key] ?? []) {
      const first = owner.get(id)
      if (first === undefined) owner.set(id, key)
      else root.set(find(key), find(first))
    }
  }
  const members = new Map<string, string[]>()
  for (const key of projects) members.set(find(key), [...(members.get(find(key)) ?? []), key])
  return [...members.values()].filter((group) => group.length > 1).map((group) => ({ title: sharedPath(group, remotes), projects: group }))
}

/** The path of the remote most of the group's projects have; the first one seen of equals. */
function sharedPath(group: string[], remotes: Record<string, RemoteRef[]>): string {
  const counts = new Map<string, { path: string; count: number }>()
  for (const key of group) {
    for (const { id, path } of remotes[key] ?? []) counts.set(id, { path, count: (counts.get(id)?.count ?? 0) + 1 })
  }
  let best = { path: '', count: 0 }
  for (const entry of counts.values()) if (entry.count > best.count) best = entry
  return best.path
}

function trackerGroups(projects: string[], trackers: GroupFacts['trackers']): Group[] {
  return trackers
    .map((view) => ({ title: view.title, projects: projects.filter((key) => trackerOf(key, trackers) === view) }))
    .filter((group) => group.projects.length > 1)
}

/** A remote group's projects by tracker, with titles only when it has more than one. */
function trackerSections(projects: string[], trackers: GroupFacts['trackers']): HomeSection[] {
  const sections = new Map<string | null, string[]>()
  for (const key of projects) {
    const name = trackerOf(key, trackers)?.name ?? null
    sections.set(name, [...(sections.get(name) ?? []), key])
  }
  if (sections.size < 2) return [{ title: null, projects }]
  return [...sections].map(([name, keys]) => ({ title: trackers.find((view) => view.name === name)?.title ?? null, projects: keys }))
}

const trackerOf = (key: string, trackers: GroupFacts['trackers']) => trackers.find((view) => view.projects.includes(key))

export function zoned(projects: string[], zone: (key: string) => Zone): Record<Zone, string[]> {
  const zones: Record<Zone, string[]> = { working: [], cards: [], quiet: [] }
  for (const key of projects) zones[zone(key)].push(key)
  return zones
}

export function zoneOf(state: EvenKeelState, project: string): Zone {
  const status = chainStatus(state.chain, project)
  if (status.kind !== 'idle' || openQuestions(projectTasks(state, project)) > 0) return 'working'
  const kind = emptyKind(state, project)
  return kind === 'ghost' || kind === 'finished' || kind === 'shelved' ? 'quiet' : 'cards'
}
