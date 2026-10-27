import type { CheckResult } from '../state.js'
import type { TrackerProject } from '../tracker/source.js'
import type { ServerDeps } from '../server.js'
import { textOf } from '../server-request.js'
import type { ProfileRules } from './model.js'
import { profileDraftOf } from './request.js'
import type { ProfileDraft } from './service.js'

/** The trackers' profiles of the same tab; a project is named by its key. */
export interface ProfilesControl {
  check(draft: ProfileDraft): Promise<CheckResult>
  /** Returns the profile's id. */
  save(draft: ProfileDraft & { name: string }): Promise<string>
  remove(id: string): void
  setDefault(id: string): void
  /** The chain rules of the profile's projects; refused when one of them would clash. */
  setRules(id: string, rules: ProfileRules): void
  /** `null` — the project runs on its tracker's default profile. */
  link(project: string, profile: string | null): void
  projects(id: string, query: string): Promise<TrackerProject[]>
}

export const PROFILE_QUERIES: Record<string, (deps: ServerDeps, body: Record<string, unknown>) => Promise<unknown>> = {
  'profiles/check': ({ profiles }, body) => profiles.check(profileDraftOf(body)),
  'profiles/save': async ({ profiles }, body) => ({ id: await profiles.save({ ...profileDraftOf(body), name: typeof body.name === 'string' ? body.name : '' }) }),
  'profiles/projects': ({ profiles }, body) => profiles.projects(textOf(body.id, 'id'), typeof body.query === 'string' ? body.query : ''),
}
