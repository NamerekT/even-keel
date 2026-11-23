import { idPrefixOf, type EvenKeelConfig } from '../config.js'
import { defaultProfile, profileFor, type ProfileSet, type TrackerProfile } from '../profiles/model.js'
import type { HulyProfiles } from './tally.js'

const usable = (profile: TrackerProfile | undefined) => (profile === undefined || profile.disabled ? undefined : profile.values)

/**
 * The Huly profiles' values Tally reads task titles and writes times with. A turned-off profile (BTN-830) is left out of
 * every part, as the service reaches nothing of its host.
 */
export function hulyProfilesOf(config: Pick<EvenKeelConfig, 'keys' | 'trackers' | 'trackerProjects'>, set: ProfileSet): HulyProfiles {
  // By the Huly project, which Tally knows the tasks by; a feed is a reader of its own (BTN-66).
  const projects = Object.entries(config.trackers).flatMap(([project, kind]) => {
    const values = kind === 'huly' ? usable(profileFor(set, project, kind)) : undefined
    return values === undefined ? [] : [[idPrefixOf(config, project), values] as const]
  })
  const elsewhere = Object.entries(config.trackers).flatMap(([project, kind]) => (kind === 'huly' ? [] : [idPrefixOf(config, project)]))
  const prefixes = Object.keys(config.trackers).map((project) => idPrefixOf(config, project))
  const byId = Object.fromEntries(set.profiles.filter((profile) => profile.kind === 'huly' && !profile.disabled).map((profile) => [profile.id, profile.values]))
  return { projects: Object.fromEntries(projects), fallback: usable(defaultProfile(set, 'huly')) ?? null, elsewhere, prefixes, byId }
}
