import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_BRANCH } from '../config.js'
import { isHeads, type Clone, type ReadRemote } from '../git/remote-run.js'
import { requireStarted } from '../git/setup.js'
import type { Git } from '../git/types.js'
import type { JobPlan, StepDef, StepTools } from '../jobs/runner.js'
import { fail, NoticeError } from '../notice/notice.js'
import type { ProjectCheck, ProjectDraft } from '../state.js'

const FIRST_COMMIT = 'Initial commit'
const PACKAGES_POLL_MS = 500
const PACKAGES_WAIT_MS = 5 * 60_000

export interface CreationDeps {
  git: Git
  clone: Clone
  readRemote: ReadRemote
  /** The wizard's check of the draft's folder, as "Create" finds it. */
  check: (draft: ProjectDraft) => Promise<ProjectCheck['repo']>
  /** Writes the project of a draft whose folder is there; its id. */
  add: (draft: ProjectDraft) => Promise<string>
  /** The folder the added project has. */
  folderOf: (project: string) => string
  /** The `.claude.json` of each account the draft's sessions may run on; none — Claude Code never runs it, and the step is left out. */
  trustFiles: (draft: ProjectDraft) => string[]
  trust: (file: string, folder: string) => void
  /** The project's packages still installing, and those only the user can make ready. */
  packages: { installingOf(project: string): string[]; unready(project: string): string[] }
  wait?: (ms: number) => Promise<void>
}

/** What the job made on the disk, for Cancel to take back: never a folder or a file that was there before it. */
interface Made {
  /** The folder was made by the job; `false` — it was there, and only what the job put into it is the job's. */
  folder: boolean
  /** The folder was empty or absent: all it holds now came from the clone. */
  contents: boolean
  /** The `.git` of a new repository in a folder that had none. */
  git: boolean
}

/**
 * The steps that create a project from the wizard's draft (BTN-1048): the folder, the clone with its LFS files or the
 * new repository's first commit, the project's entry on its main branch, Claude Code's trust for its accounts and the
 * project's packages. The draft is checked first, as the wizard checked it: a refusal starts no job. Cancel removes
 * what the job made until the entry is written; from then on the project stays.
 */
export async function creationPlan(deps: CreationDeps, draft: ProjectDraft): Promise<JobPlan> {
  const repo = await deps.check(draft)
  if (repo.notice !== null) throw new NoticeError(repo.notice)
  const plain = draft.git === false
  const source = plain ? 'plain' : (draft.source ?? 'existing')
  const path = repo.place === undefined ? null : repo.root
  if (!plain && repo.root === null) throw fail('request.required', { field: source === 'clone' ? 'remote' : 'repo' })
  const made: Made = { folder: false, contents: false, git: false }
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let project: string | undefined
  // A folder that was there already is trusted by the user, as the wizard asks; one Even Keel makes is trusted here.
  const ours = path !== null || (plain && draft.repo.trim() === '')
  const trustFiles = ours ? deps.trustFiles(draft) : []

  const folder: StepDef = {
    id: 'folder',
    run: async () => {
      if (existsSync(path!)) made.contents = made.contents || readdirSync(path!).length === 0
      else {
        mkdirSync(path!, { recursive: true })
        made.folder = true
        made.contents = true
      }
    },
  }

  const clone: StepDef = {
    id: 'clone',
    run: async (tools: StepTools) => {
      // A clone broken off halfway left its files: git takes only an empty folder.
      if (made.contents) emptyFolder(path!)
      const remote = draft.remote!.trim()
      const heads = await deps.readRemote(remote)
      if (!isHeads(heads)) throw new NoticeError(heads)
      const branch = draft.branch.trim()
      await deps.clone({
        remote,
        path: path!,
        // A branch the remote lacks is created when the entry is written, as for a repository already there.
        branch: heads.branches.includes(branch) ? branch : null,
        signal: tools.signal,
        onProgress: (progress) => {
          if (progress.stage === 'lfs') tools.begin('lfs')
          tools.progress(progress)
        },
      })
    },
  }

  const init: StepDef = {
    id: 'init',
    run: async () => {
      const branch = draft.branch.trim() || DEFAULT_BRANCH
      const run = async (args: string[]) => {
        const result = requireStarted(await deps.git(path!, args))
        if (result.code !== 0) throw fail('git.initFailed', { path: path! }, { detail: result.out })
      }
      // The commit needs them: refused here, the folder is left as it was.
      for (const key of ['user.name', 'user.email']) {
        const value = requireStarted(await deps.git(path!, ['config', '--get', key]))
        if (value.code !== 0 || value.out.trim() === '') throw fail('git.noIdentity', {})
      }
      if (!existsSync(join(path!, '.git'))) {
        await run(['init', '-b', branch])
        made.git = true
      }
      await run(['add', '-A'])
      await run(['commit', '--allow-empty', '-m', FIRST_COMMIT])
    },
  }

  const entry: StepDef = {
    id: 'project',
    run: async () => {
      const { source: _source, remote: _remote, folder: _folder, ...rest } = draft
      project = await deps.add(path === null ? rest : { ...rest, repo: path })
    },
  }

  const trust: StepDef = {
    id: 'trust',
    run: async () => {
      const at = deps.folderOf(project!)
      for (const file of trustFiles) deps.trust(file, at)
    },
  }

  const packages: StepDef = {
    id: 'packages',
    run: async ({ signal }) => {
      const until = Date.now() + PACKAGES_WAIT_MS
      while (deps.packages.installingOf(project!).length > 0 && Date.now() < until && !signal.aborted) await wait(PACKAGES_POLL_MS)
      const unready = deps.packages.unready(project!)
      if (unready.length > 0 && !signal.aborted) throw fail('job.packagesUnready', { packages: unready })
    },
  }

  const steps = [
    ...(path === null ? [] : [folder]),
    ...(source === 'clone' ? [clone, { id: 'lfs', hidden: true }] : []),
    ...(source === 'new' ? [init] : []),
    entry,
    ...(trustFiles.length === 0 ? [] : [trust]),
    packages,
  ]
  return {
    kind: 'project',
    subject: path ?? repo.root ?? '',
    steps,
    keptAfter: 'project',
    result: () => project,
    undo: async () => {
      if (path === null) return
      if (made.folder) rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      else if (made.contents) emptyFolder(path)
      else if (made.git) rmSync(join(path, '.git'), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    },
  }
}

function emptyFolder(folder: string): void {
  for (const name of readdirSync(folder)) rmSync(join(folder, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
