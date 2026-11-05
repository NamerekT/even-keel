import type { ConfigStore } from '../config-store.js'
import { DEFAULT_BRANCH } from '../config.js'
import type { Git } from '../git/types.js'
import { NoticeError } from '../notice/notice.js'
import type { ProjectDraft } from '../state.js'
import { moveBranch } from './branch-move.js'
import { checkRepo } from './check.js'
import type { Folders } from './folder.js'

export interface AddDeps {
  configStore: Pick<ConfigStore, 'addProject' | 'raw'>
  git: Git
  profiles: { link(project: string, profile: string): void }
  folders?: Folders
}

/** The checkout goes onto the draft's branch first, created or taken from a remote (BTN-754); the entry is written once it stands there. */
export async function addProject(deps: AddDeps, draft: ProjectDraft): Promise<void> {
  const repo = await checkRepo(deps.git, draft, deps.configStore.raw(), process.platform, undefined, {}, deps.folders)
  if (repo.notice !== null) throw new NoticeError(repo.notice)
  const root = repo.root ?? draft.repo
  const branch = draft.branch.trim() || repo.current || DEFAULT_BRANCH
  const id = await moveBranch(deps.git, root, repo.branches, branch, () => deps.configStore.addProject({ ...draft, repo: root }))
  if (draft.profile !== null) deps.profiles.link(id, draft.profile)
  console.log(`page: the project ${draft.key.trim()} is added to the config`)
}
