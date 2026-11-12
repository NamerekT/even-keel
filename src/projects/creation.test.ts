import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CloneRequest } from '../git/remote-run.js'
import type { GitResult } from '../git/types.js'
import { StepJobs } from '../jobs/runner.js'
import { fail, notice } from '../notice/notice.js'
import type { ProjectCheck, ProjectDraft } from '../state.js'
import { creationPlan, type CreationDeps } from './creation.js'

const REMOTE = 'https://example.com/acme/storefront.git'
const base: ProjectDraft = { repo: '', branch: '', key: 'SHOP', name: '', tracker: 'fake', trackerProject: '', profile: null, slot: 0, milestones: [], provider: null }

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'creation-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

interface Seen {
  clones: CloneRequest[]
  added: ProjectDraft[]
  trusted: string[]
  git: string[]
}

function deps(path: string | null, fields: Partial<CreationDeps> = {}, repo: Partial<ProjectCheck['repo']> = {}): CreationDeps & { seen: Seen } {
  const seen: Seen = { clones: [], added: [], trusted: [], git: [] }
  return {
    seen,
    git: async (cwd: string, args: string[]): Promise<GitResult> => {
      seen.git.push(args.join(' '))
      if (args[0] === 'config') return { code: 0, out: 'John Doe' }
      if (args[0] === 'init') mkdirSync(join(cwd, '.git'))
      return { code: 0, out: '' }
    },
    clone: async (request) => {
      seen.clones.push(request)
      writeFileSync(join(request.path, 'README.md'), '')
      request.onProgress({ stage: 'receiving', percent: 100 })
    },
    readRemote: async () => ({ head: 'main', branches: ['main'] }),
    check: async () => ({ root: path, current: null, suggested: null, branches: null, notice: null, ...(path === null ? {} : { place: { dir, name: 'storefront', state: 'free' as const } }), ...repo }),
    add: async (draft) => {
      seen.added.push(draft)
      return 'project-1'
    },
    folderOf: () => path ?? join(dir, 'own'),
    trustFiles: () => ['C:\\home\\.claude.json'],
    trust: (file, folder) => void seen.trusted.push(`${file} ${folder}`),
    packages: { turnOnTasks: () => {}, installingOf: () => [], unready: () => [] },
    wait: async () => {},
    ...fields,
  }
}

async function run(made: CreationDeps, draft: ProjectDraft) {
  const jobs = new StepJobs()
  const id = jobs.start(await creationPlan(made, draft))
  await jobs.settled(id)
  return { jobs, id, view: jobs.view()[0]! }
}

describe('creationPlan', () => {
  it('makes the folder, clones the default branch where the remote lacks the wanted one, writes the entry and trusts the folder', async () => {
    const path = join(dir, 'storefront')
    const made = deps(path)
    const { view } = await run(made, { ...base, source: 'clone', remote: ` ${REMOTE} `, branch: 'dev', folder: 'storefront' })
    expect(view.steps.map((step) => `${step.id}:${step.state}`)).toEqual(['folder:done', 'clone:done', 'project:done', 'trust:done', 'packages:done'])
    expect(view).toEqual(expect.objectContaining({ done: true, result: 'project-1', subject: path }))
    expect(made.seen.clones[0]).toEqual(expect.objectContaining({ remote: REMOTE, path, branch: null }))
    expect(made.seen.added).toEqual([{ ...base, branch: 'dev', repo: path }])
    expect(made.seen.trusted).toEqual([`C:\\home\\.claude.json ${path}`])
  })

  it('clones the wanted branch the remote has, and shows the LFS step once git filters content', async () => {
    const path = join(dir, 'storefront')
    const made = deps(path, {
      clone: async (request) => {
        request.onProgress({ stage: 'receiving', percent: 100 })
        request.onProgress({ stage: 'lfs', percent: 50 })
      },
    })
    const { view } = await run(made, { ...base, source: 'clone', remote: REMOTE, branch: 'main' })
    expect(view.steps.map((step) => step.id)).toEqual(['folder', 'clone', 'lfs', 'project', 'trust', 'packages'])
  })

  it('starts no job for a draft the check refuses', async () => {
    const refused = notice('wizard.folderFilled', { path: dir })
    await expect(creationPlan(deps(dir, {}, { notice: refused }), { ...base, source: 'clone', remote: REMOTE })).rejects.toEqual(expect.objectContaining({ notice: refused }))
  })

  it('Cancel after a failed clone removes the folder the job made', async () => {
    const path = join(dir, 'storefront')
    const made = deps(path, {
      clone: async (request) => {
        writeFileSync(join(request.path, 'half'), '')
        throw fail('git.remoteNetwork', { remote: REMOTE })
      },
    })
    const { jobs, id, view } = await run(made, { ...base, source: 'clone', remote: REMOTE })
    expect(view.failure).toEqual(expect.objectContaining({ code: 'git.remoteNetwork' }))
    await jobs.cancel(id)
    expect(existsSync(path)).toBe(false)
  })

  it('Retry of a clone into an empty folder that was there empties what the broken clone left, and Cancel keeps the folder', async () => {
    const path = join(dir, 'storefront')
    mkdirSync(path)
    let tries = 0
    const made = deps(path, {
      clone: async (request) => {
        tries += 1
        writeFileSync(join(request.path, `part-${tries}`), '')
        if (tries === 1) throw fail('git.remoteNetwork', { remote: REMOTE })
        expect(readdirSync(request.path)).toEqual(['part-2'])
        throw fail('git.remoteNetwork', { remote: REMOTE })
      },
    })
    const { jobs, id } = await run(made, { ...base, source: 'clone', remote: REMOTE })
    jobs.retry(id)
    await jobs.settled(id)
    expect(tries).toBe(2)
    await jobs.cancel(id)
    expect(existsSync(path)).toBe(true)
    expect(readdirSync(path)).toEqual([])
  })

  it('makes a filled folder a repository with all it holds in the first commit; Cancel takes back only the .git', async () => {
    const path = join(dir, 'shop')
    mkdirSync(path)
    writeFileSync(join(path, 'notes.md'), '')
    const made = deps(path, { add: async () => { throw fail('wizard.keyShape', { value: 'x' }) } })
    const { jobs, id, view } = await run(made, { ...base, source: 'new', branch: 'trunk' })
    expect(view.steps.map((step) => `${step.id}:${step.state}`)).toEqual(['folder:done', 'init:done', 'project:failed', 'trust:waiting', 'packages:waiting'])
    expect(made.seen.git).toEqual(['config --get user.name', 'config --get user.email', 'init -b trunk', 'add -A', 'commit --allow-empty -m Initial commit'])
    await jobs.cancel(id)
    expect(readdirSync(path)).toEqual(['notes.md'])
  })

  it('refuses a first commit without a name and e-mail, leaving the folder as it was', async () => {
    const path = join(dir, 'shop')
    const made = deps(path, { git: async (_cwd, args) => (args[0] === 'config' ? { code: 1, out: '' } : { code: 0, out: '' }) })
    const { view } = await run(made, { ...base, source: 'new' })
    expect(view.failure).toEqual(expect.objectContaining({ code: 'git.noIdentity' }))
  })

  it('adds a checkout already there as it is: no folder step and no trust, which the user gives', async () => {
    const made = deps(null, {}, { root: 'D:\\shop' })
    const { view } = await run(made, { ...base, repo: 'D:\\shop', source: 'existing' })
    expect(view.steps.map((step) => step.id)).toEqual(['project', 'packages'])
    expect(made.seen.added).toEqual([{ ...base, repo: 'D:\\shop' }])
  })

  it("turns on the tasks package for the project as soon as its entry is written, before the packages' wait (BTN-1028)", async () => {
    const order: string[] = []
    const made = deps(null, { packages: { turnOnTasks: (project) => void order.push(`tasks ${project}`), installingOf: () => (order.push('wait'), []), unready: () => [] } }, { root: 'D:\\shop' })
    await run(made, { ...base, repo: 'D:\\shop' })
    expect(order).toEqual(['tasks project-1', 'wait'])
  })

  it("trusts Even Keel's own folder of a project without git", async () => {
    const made = deps(null, {}, { root: dir })
    const { view } = await run(made, { ...base, git: false })
    expect(view.steps.map((step) => step.id)).toEqual(['project', 'trust', 'packages'])
    expect(made.seen.trusted).toEqual([`C:\\home\\.claude.json ${join(dir, 'own')}`])
  })

  it('waits for the packages still installing, then fails on those only the user can make ready, the project kept', async () => {
    let asked = 0
    const made = deps(null, { packages: { turnOnTasks: () => {}, installingOf: () => (asked++ < 2 ? ['tasks'] : []), unready: () => ['huly'] } }, { root: 'D:\\shop' })
    const { view } = await run(made, { ...base, repo: 'D:\\shop' })
    expect(asked).toBe(3)
    expect(view.failure).toEqual(expect.objectContaining({ code: 'job.packagesUnready', params: { packages: ['huly'] } }))
    expect(view.undoable).toBe(false)
  })
})
