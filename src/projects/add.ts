import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import type { ConfigStore } from '../config-store.js'
import { DEFAULT_BRANCH } from '../config.js'
import type { Git } from '../git/types.js'
import { NoticeError } from '../notice/notice.js'
import type { ProjectDraft } from '../state.js'
import { moveBranch } from './branch-move.js'
import { checkRepo } from './check.js'
import type { Folders } from './folder.js'
import { ownFolder, projectsDir } from './own-folder.js'

export interface AddDeps {
  configStore: Pick<ConfigStore, 'addProject' | 'raw'>
  git: Git
  profiles: { link(project: string, profile: string): void }
  folders?: Folders
  /** Where a project without git that names no folder gets its own; `projectsDir()` by default. */
  projectsDir?: string
}

/**
 * The checkout goes onto the draft's branch first, created or taken from a remote (BTN-754); the entry is written once
 * it stands there. A project without git has no checkout: its folder, typed or Even Keel's own, is made once the entry is in.
 */
export async function addProject(deps: AddDeps, draft: ProjectDraft): Promise<string> {
  const ownDir = deps.projectsDir ?? projectsDir()
  const repo = await checkRepo(deps.git, draft, deps.configStore.raw(), process.platform, undefined, {}, deps.folders, ownDir)
  if (repo.notice !== null) throw new NoticeError(repo.notice)
  const id = draft.git === false ? await addPlain(deps, draft, draft.repo.trim() === '' ? null : repo.root!, ownDir) : await addCheckout(deps, draft, repo)
  if (draft.profile !== null) deps.profiles.link(id, draft.profile)
  console.log(`page: the project ${draft.key.trim()} is added to the config`)
  return id
}

async function addCheckout(deps: AddDeps, draft: ProjectDraft, repo: Awaited<ReturnType<typeof checkRepo>>): Promise<string> {
  const root = repo.root ?? draft.repo
  const branch = draft.branch.trim() || repo.current || DEFAULT_BRANCH
  return moveBranch(deps.git, root, repo.branches, branch, () => deps.configStore.addProject({ ...draft, repo: root }))
}

async function addPlain(deps: AddDeps, draft: ProjectDraft, typed: string | null, ownDir: string): Promise<string> {
  const id = randomUUID()
  const folder = typed ?? ownFolder(ownDir, draft.key, id)
  deps.configStore.addProject({ ...draft, repo: folder }, {}, id)
  await mkdir(folder, { recursive: true })
  return id
}
