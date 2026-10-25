import type { ConfigStore } from '../config-store.js'
import type { ProjectDraft } from '../state.js'

export interface AddDeps {
  configStore: Pick<ConfigStore, 'addProject'>
  profiles: { link(project: string, profile: string): void }
}

export function addProject(deps: AddDeps, draft: ProjectDraft): void {
  const id = deps.configStore.addProject(draft)
  if (draft.profile !== null) deps.profiles.link(id, draft.profile)
  console.log(`page: the project ${draft.key.trim()} is added to the config`)
}
