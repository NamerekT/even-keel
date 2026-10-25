import type { ConfigStore } from '../config-store.js'
import type { Git } from '../git/types.js'
import { NoticeError } from '../notice/notice.js'
import type { ProjectDraft } from '../state.js'
import { checkRepo } from './check.js'

export interface AddDeps {
  configStore: Pick<ConfigStore, 'addProject' | 'raw'>
  git: Git
  profiles: { link(project: string, profile: string): void }
}

export async function addProject(deps: AddDeps, draft: ProjectDraft): Promise<void> {
  const repo = await checkRepo(deps.git, draft, deps.configStore.raw())
  if (repo.notice !== null) throw new NoticeError(repo.notice)
  const id = deps.configStore.addProject({ ...draft, repo: repo.root ?? draft.repo })
  if (draft.profile !== null) deps.profiles.link(id, draft.profile)
  console.log(`page: the project ${draft.key.trim()} is added to the config`)
}
