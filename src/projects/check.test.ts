import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { linkType } from '../account/share.js'
import type { GitResult } from '../git/types.js'
import { englishOf, notice } from '../notice/notice.js'
import type { ProjectDraft } from '../state.js'
import type { TaskSource, TrackerAdapter } from '../tracker/source.js'
import type { TrackerTask } from '../tracker/model.js'
import { checkDraft, isTrusted, sourcedDraft, type CheckDeps } from './check.js'

const draft: ProjectDraft = { repo: 'D:\\new\\src', branch: '', key: 'NEW', name: '', tracker: 'fake', trackerProject: '', profile: null, slot: 0, milestones: [], provider: null }

function task(id: string, category: 'ToDo' | 'Won'): TrackerTask {
  return {
    id,
    title: id,
    status: { name: category, category },
    blockedBy: [],
    parent: null,
    subtasks: 0,
    labels: [],
    priority: 'none',
    milestone: null,
    estimate: 0,
  } as unknown as TrackerTask
}

function fakeAdapter(options: { off?: boolean; fails?: string; tasks?: TrackerTask[]; public?: boolean } = {}): TrackerAdapter & { asked: string[] } {
  const asked: string[] = []
  return {
    title: 'Fake',
    variables: ['FAKE_URL', 'FAKE_TOKEN'],
    asked,
    setup: (_env, projects) =>
      options.off
        ? undefined
        : {
            issueUrl: () => null,
            connect: async () => {
              if (options.fails !== undefined) throw new Error(options.fails)
              asked.push(...Object.values(projects).flatMap((place) => (place.value === undefined ? [] : [`${place.key}=${place.value}`])))
              return {
                chainTasks: async (project: string) => {
                  asked.push(projects[project]?.key ?? project)
                  return { tasks: options.tasks ?? [], statuses: [] }
                },
                ...(options.public === undefined ? {} : { isPublic: async () => options.public }),
                close: async () => {},
              } as unknown as TaskSource
            },
          },
  }
}

const REFS = 'for-each-ref --format=%(refname) %(worktreepath) refs/heads/ refs/remotes/'
const BRANCHES = {
  current: 'trunk',
  head: 'abc1234',
  branches: [
    { name: 'trunk', remote: null },
    { name: 'dev', remote: null },
    { name: 'release', remote: 'origin' },
  ],
}

function deps(fields: Partial<CheckDeps> = {}, answers: Record<string, GitResult> = {}): CheckDeps {
  const git = async (cwd: string, args: string[]): Promise<GitResult> => {
    const answer = answers[`${cwd} ${args.join(' ')}`]
    if (answer !== undefined) return answer
    if (cwd.startsWith('D:\\new') && args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { code: 0, out: 'D:/new' }
    if (cwd === 'D:\\new' && args[0] === 'symbolic-ref') return { code: 0, out: 'trunk' }
    if (cwd === 'D:\\new' && args.join(' ') === REFS) return { code: 0, out: 'refs/heads/trunk\nrefs/heads/dev\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/trunk\nrefs/remotes/origin/release\n' }
    if (cwd === 'D:\\new' && args[0] === 'remote') return { code: 0, out: 'origin' }
    if (cwd === 'D:\\new' && args.join(' ') === 'rev-parse --short HEAD') return { code: 0, out: 'abc1234' }
    if (cwd === 'D:\\new' && args[0] === 'check-ref-format') return { code: args[2]!.includes('..') ? 1 : 0, out: '' }
    return { code: 128, out: `fatal: not a git repository: ${cwd}` }
  }
  return {
    git,
    raw: () => ({ projects: [{ id: 'id-abc', key: 'ABC', repo: 'C:\\abc' }] }),
    adapters: { fake: fakeAdapter({ tasks: [task('NEW-1', 'ToDo'), task('NEW-2', 'ToDo'), task('NEW-3', 'Won')] }) },
    env: {},
    claudeConfigs: () => [{ projects: { 'd:/new': { hasTrustDialogAccepted: true } } }],
    timeoutMs: 1000,
    platform: 'win32',
    folders: { home: 'D:\\home', isFolder: (folder) => folder !== 'D:\\nowhere' },
    user: 'svc',
    service: true,
    ...fields,
  }
}

describe('checkDraft', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('expands Windows variables from the service environment, not the tracker profile', async () => {
    vi.stubEnv('EKR_TEST_FOLDER', 'D:\\new')
    const base = deps({ env: { EKR_TEST_FOLDER: 'D:\\wrong' } })
    const git = vi.fn(base.git)
    const check = await checkDraft({ ...base, git }, { ...draft, repo: '%ekr_test_folder%\\src' })
    expect(check.repo.notice).toBeNull()
    expect(git).toHaveBeenCalledWith('D:\\new\\src', ['rev-parse', '--show-toplevel'])
  })

  it('reports an unknown leading Windows variable as a missing folder without asking git', async () => {
    vi.stubEnv('EKR_TEST_MISSING', undefined)
    const base = deps()
    const git = vi.fn(base.git)
    const check = await checkDraft({ ...base, git }, { ...draft, repo: '%EKR_TEST_MISSING%\\src' })
    expect(check.repo.notice).toMatchObject({ code: 'wizard.noFolder' })
    expect(git).not.toHaveBeenCalled()
  })

  it("reads the wizard's one field first: a repository's top is checked as before and says how it was read (BTN-1093)", async () => {
    const check = await checkDraft(deps(), { ...draft, repo: '', target: 'D:\\new' })
    expect(check.repo).toMatchObject({ root: 'D:\\new', current: 'trunk', notice: null, read: { as: 'existing', remote: null } })
    expect(check.tracker?.ok).toBe(true)
  })

  it('refuses a subfolder of a repository in the one field, naming its top, and an unknown Windows variable as no folder', async () => {
    expect((await checkDraft(deps(), { ...draft, repo: '', target: 'D:\\new\\src' })).repo.notice).toMatchObject({ code: 'wizard.insideRepo', params: { root: 'D:\\new' } })
    vi.stubEnv('EKR_TEST_MISSING', undefined)
    expect((await checkDraft(deps(), { ...draft, repo: '', target: '%EKR_TEST_MISSING%\\src' })).repo.notice).toMatchObject({ code: 'wizard.noFolder' })
  })

  it('gives "Create" the draft with the source the one field names, and refuses as the check does (BTN-1093)', async () => {
    const { git, raw, folders } = deps()
    const clone = await sourcedDraft(git, { ...draft, repo: '', folder: 'shop', target: 'https://example.com/me/shop.git' }, raw(), 'win32', folders, 'D:\\projects')
    expect(clone).toMatchObject({ source: 'clone', remote: 'https://example.com/me/shop.git', folder: 'shop' })
    await expect(sourcedDraft(git, { ...draft, target: 'shop now please' }, raw(), 'win32', folders, 'D:\\projects')).rejects.toMatchObject({ notice: { code: 'wizard.notTarget' } })
    expect(await sourcedDraft(git, draft, raw(), 'win32', folders, 'D:\\projects')).toBe(draft)
  })

  it('leaves the folder a refused remote did not give to the repository step: no entry refusal under a good key (BTN-1107)', async () => {
    const readRemote = async () => notice('git.remoteSshKey', { remote: 'git@example.com:me/shop.git' })
    const check = await checkDraft(deps({ readRemote, projectsDir: 'D:\\projects' }), { ...draft, repo: '', key: 'FGDF', target: 'git@example.com:me/shop.git' })
    expect(check.repo).toMatchObject({ root: null, notice: { code: 'git.remoteSshKey' } })
    expect(check.entry).toBeNull()
    expect(check.tracker).toBeNull()
  })

  it('still says a bad key under a typed folder git refused (BTN-1107)', async () => {
    const check = await checkDraft(deps(), { ...draft, repo: 'D:\\nowhere', key: 'a b' })
    expect(check.repo.notice).toMatchObject({ code: 'wizard.noFolder' })
    expect(check.entry).toEqual(expect.objectContaining({ code: 'wizard.keyShape', params: { value: 'a b' } }))
  })

  it('takes the top of the repository, suggests its branch, asks the tracker and the trust', async () => {
    const check = await checkDraft(deps(), draft)
    expect(check).toEqual({
      repo: { root: 'D:\\new', current: 'trunk', suggested: null, branches: BRANCHES, notice: null },
      entry: null,
      yields: [],
      tracker: { ok: true, missing: [], open: 2, openToAll: false, notice: null },
      trusted: true,
      platform: 'win32',
      user: 'svc',
      service: true,
    })
  })

  it("asks Claude Code's trust of a project on any agent: a task's run can give it to Claude (BTN-429, BTN-983)", async () => {
    const untrusted = { claudeConfigs: () => [{}] }
    expect((await checkDraft(deps(untrusted), { ...draft, provider: 'codex' })).trusted).toBe(false)
    expect((await checkDraft(deps({ ...untrusted, raw: () => ({ provider: 'codex', projects: [] }) }), draft)).trusted).toBe(false)
    expect((await checkDraft(deps({ ...untrusted, raw: () => ({ provider: 'codex', projects: [] }) }), { ...draft, provider: 'claude' })).trusted).toBe(false)
  })

  it("takes the trust of the chain's account folder as well as the global one (BTN-300)", async () => {
    const account = { projects: { 'D:/new': { hasTrustDialogAccepted: true } } }
    expect((await checkDraft(deps({ claudeConfigs: () => [undefined, account] }), draft)).trusted).toBe(true)
    expect((await checkDraft(deps({ claudeConfigs: () => [{}, undefined] }), draft)).trusted).toBe(false)
    expect((await checkDraft(deps({ claudeConfigs: () => [] }), draft)).trusted).toBe(false)
  })

  it('says a folder is not a git repository and checks nothing that needs one', async () => {
    const check = await checkDraft(deps(), { ...draft, repo: 'E:\\plain' })
    expect(check.repo).toEqual({ root: null, current: null, suggested: null, branches: null, notice: expect.objectContaining({ code: 'wizard.notRepo', params: { path: 'E:\\plain' } }) })
    expect(check.trusted).toBeNull()
  })

  it('expands a leading ~ to the home folder before asking git (BTN-744)', async () => {
    const git = { 'D:\\new\\src rev-parse --show-toplevel': { code: 0, out: 'D:/new' } }
    const asked: string[] = []
    const base = deps({}, git)
    const spy = { ...base, git: async (cwd: string, args: string[]) => (asked.push(cwd), base.git(cwd, args)) }
    const check = await checkDraft({ ...spy, folders: { home: 'D:\\new', isFolder: () => true } }, { ...draft, repo: '~\\src' })
    expect(check.repo.notice).toBeNull()
    expect(asked[0]).toBe('D:\\new\\src')
  })

  it('gives a missing folder one wizard.noFolder, without git output and the repository button (BTN-744)', async () => {
    const check = await checkDraft(deps(), { ...draft, repo: 'D:\\nowhere' })
    expect(check.repo).toEqual({ root: null, current: null, suggested: null, branches: null, notice: expect.objectContaining({ code: 'wizard.noFolder', params: { path: 'D:\\nowhere' } }) })
    expect(check.repo.notice?.detail).toBeUndefined()
  })

  it('refuses a relative folder with a full-path message (BTN-744)', async () => {
    const check = await checkDraft(deps(), { ...draft, repo: 'src\\app' })
    expect(check.repo.notice).toMatchObject({ code: 'wizard.relativePath', params: { path: 'src\\app' } })
  })

  it('says git that does not start as missing, not the folder as no repository (BTN-731)', async () => {
    const check = await checkDraft(deps({}, { 'D:\\new\\src rev-parse --show-toplevel': { code: -1, out: 'spawn git ENOENT', missing: true } }), draft)
    expect(check.repo).toEqual({ root: null, current: null, suggested: null, branches: null, notice: expect.objectContaining({ code: 'git.missing' }) })
  })

  it('leaves a blank folder unchecked, without a notice', async () => {
    const check = await checkDraft(deps(), { ...draft, repo: ' ' })
    expect(check.repo).toEqual({ root: null, current: null, suggested: null, branches: null, notice: null })
    expect(check.tracker).toBeNull()
  })

  describe('a project without git', () => {
    const plain: ProjectDraft = { ...draft, git: false }
    const silent = () => {
      const base = deps({ projectsDir: 'D:\\data\\projects' })
      const git = vi.fn(base.git)
      return { base: { ...base, git }, git }
    }

    it('takes a folder that is no repository or does not exist yet, without asking git, and asks the tracker', async () => {
      const { base, git } = silent()
      const check = await checkDraft(base, { ...plain, repo: 'D:\\nowhere' })
      expect(check.repo).toEqual({ root: 'D:\\nowhere', current: null, suggested: null, branches: null, notice: null })
      expect(check.entry).toBeNull()
      expect(check.tracker?.ok).toBe(true)
      expect(git).not.toHaveBeenCalled()
    })

    it("names Even Keel's folder of projects for a blank folder, and asks no trust of a folder not made yet", async () => {
      const { base, git } = silent()
      const check = await checkDraft(base, { ...plain, repo: ' ' })
      expect(check.repo).toEqual({ root: 'D:\\data\\projects', current: null, suggested: null, branches: null, notice: null })
      expect(check.tracker?.ok).toBe(true)
      expect(check.trusted).toBeNull()
      expect(git).not.toHaveBeenCalled()
    })

    it('still refuses a relative folder and one another project has', async () => {
      const { base } = silent()
      expect((await checkDraft(base, { ...plain, repo: 'notes' })).repo.notice).toMatchObject({ code: 'wizard.relativePath' })
      const taken = await checkDraft(base, { ...plain, repo: 'c:\\ABC\\' })
      expect(taken.repo.notice).toMatchObject({ code: 'wizard.folderTaken', params: { project: 'id-abc' } })
    })

    it('ignores a branch name git would refuse', async () => {
      const { base } = silent()
      expect((await checkDraft(base, { ...plain, repo: 'D:\\notes', branch: 'bad..name' })).entry).toBeNull()
    })
  })

  it('takes a branch the repository does not have: adding creates it, the page reads what will happen from the branches (BTN-754)', async () => {
    const check = await checkDraft(deps(), { ...draft, branch: 'main' })
    expect(check.repo).toEqual({ root: 'D:\\new', current: 'trunk', suggested: null, branches: BRANCHES, notice: null })
    expect(check.tracker).not.toBeNull()
  })

  it('reads a detached checkout as no current branch, the branches offered as usual', async () => {
    const detached = { 'D:\\new symbolic-ref --quiet --short HEAD': { code: 1, out: '' } }
    const check = await checkDraft(deps({}, detached), { ...draft, branch: '' })
    expect(check.repo).toMatchObject({ current: null, branches: { current: null, branches: [{ name: 'trunk' }, { name: 'dev' }, { name: 'release' }] }, notice: null })
  })

  it('refuses a name git does not take as a branch', async () => {
    const check = await checkDraft(deps(), { ...draft, branch: 'bad..name' })
    expect(check.repo.notice).toEqual(expect.objectContaining({ code: 'wizard.branchName', params: { value: 'bad..name' } }))
  })

  it("refuses an existing repository whose commits would have no name or e-mail, even in its own config (BTN-1048)", async () => {
    const unset = { 'D:\\new config --get user.email': { code: 1, out: '' } }
    const check = await checkDraft(deps({}, unset), draft)
    expect(check.repo.notice).toEqual(expect.objectContaining({ code: 'git.noIdentity' }))
    expect(check.tracker).toBeNull()
    const named = { 'D:\\new config --get user.name': { code: 0, out: 'John Doe' }, 'D:\\new config --get user.email': { code: 0, out: 'john@example.com' } }
    expect((await checkDraft(deps({}, named), draft)).repo.notice).toBeNull()
  })

  it('says a repository without a commit needs one, whatever the branch, and asks no tracker', async () => {
    const empty = { [`D:\\new ${REFS}`]: { code: 0, out: '' } }
    for (const branch of ['', 'main']) {
      const check = await checkDraft(deps({}, empty), { ...draft, branch })
      expect(check.repo).toEqual({ root: 'D:\\new', current: 'trunk', suggested: null, branches: null, notice: expect.objectContaining({ code: 'wizard.noCommits' }) })
      expect(check.tracker).toBeNull()
    }
  })

  it('refuses a repository another project already has', async () => {
    const check = await checkDraft(deps({ raw: () => ({ projects: [{ id: 'id-abc', key: 'ABC', repo: 'd:\\NEW' }] }) }), draft)
    expect(check.repo.notice).toEqual(expect.objectContaining({ code: 'wizard.repoTaken', params: { project: 'id-abc' } }))
  })

  it('gives what parseConfig says of the config with the draft, and asks no tracker then', async () => {
    const adapter = fakeAdapter()
    const check = await checkDraft(deps({ adapters: { fake: adapter } }), { ...draft, key: 'a b' })
    expect(check.entry).toEqual(expect.objectContaining({ code: 'wizard.keyShape', params: { value: 'a b' } }))
    expect(check.tracker).toBeNull()
    expect(adapter.asked).toEqual([])
  })

  it("says the config's refusals in the form's words, without a path of the config (BTN-297)", async () => {
    const key = await checkDraft(deps(), { ...draft, key: 'NAMЫ' })
    expect(key.entry).toEqual(expect.objectContaining({ code: 'wizard.keyShape', params: { value: 'NAMЫ' } }))
    const shared = await checkDraft(deps({ raw: () => ({ projects: [{ id: 'id-abc', key: 'ABC', tracker: 'fake', repo: 'C:\\abc' }] }) }), { ...draft, key: 'ABC' })
    expect(shared.entry).toEqual(expect.objectContaining({ code: 'wizard.trackerShared', params: { project: 'ABC (main)' } }))
    for (const check of [key, shared]) expect(englishOf(check.entry!)).not.toMatch(/projects\[|wizard-check|\.key\b|config|chain\./)
  })

  it('takes a key another project has (BTN-271), but not two chains on one tracker project without split milestones', async () => {
    const adapter = fakeAdapter()
    const sameTracker = () => ({ projects: [{ id: 'id-abc', key: 'ABC', tracker: 'fake', repo: 'C:\\abc' }] })
    const check = await checkDraft(deps({ raw: sameTracker, adapters: { fake: adapter } }), { ...draft, key: ' ABC ' })
    expect(check.entry).toEqual(expect.objectContaining({ code: 'wizard.trackerShared' }))
    expect(adapter.asked).toEqual([])
    const otherTracker = await checkDraft(deps(), { ...draft, key: 'ABC' })
    expect(otherTracker.entry).toBeNull()
    expect(otherTracker.yields).toEqual([])
  })

  it("passes a second project on one tracker project once it names its milestones, and says who gives them up (BTN-306)", async () => {
    const adapter = fakeAdapter()
    const sameTracker = () => ({ projects: [{ id: 'id-abc', key: 'ABC', tracker: 'fake', repo: 'C:\\abc' }] })
    const check = await checkDraft(deps({ raw: sameTracker, adapters: { fake: adapter } }), { ...draft, key: 'ABC', milestones: ['v1.0.1'] })
    expect(check.entry).toBeNull()
    expect(check.yields).toEqual(['ABC (main)'])
    expect(check.tracker?.ok).toBe(true)
  })

  it('refuses a key another project has on another repository where task ids are made of the key, naming that project', async () => {
    const adapter = fakeAdapter()
    adapter.projectKey = { key: 'fake', pattern: /^\w+\/\w+$/, example: 'org/name' }
    const named = () => ({ projects: [{ id: 'id-abc', key: 'ABC', tracker: 'fake', name: 'Web shop', repo: 'C:\\abc', fake: 'org/abc' }] })
    const check = await checkDraft(deps({ raw: named, adapters: { fake: adapter } }), { ...draft, key: 'ABC', trackerProject: 'org/new' })
    expect(check.entry).toEqual(expect.objectContaining({ code: 'wizard.keyTaken', params: { key: 'ABC', project: 'ABC (Web shop)' } }))
    expect(check.tracker).toBeNull()
    expect(adapter.asked).toEqual([])
  })

  it('names the tracker variables when none is set', async () => {
    const check = await checkDraft(deps({ adapters: { fake: fakeAdapter({ off: true }) } }), draft)
    expect(check.tracker).toEqual({
      ok: false,
      missing: ['FAKE_URL', 'FAKE_TOKEN'],
      open: null,
      openToAll: false,
      notice: expect.objectContaining({ code: 'wizard.trackerOff', params: { tracker: 'Fake', variables: ['FAKE_URL', 'FAKE_TOKEN'] } }),
    })
  })

  it('passes on what the tracker answered when it failed', async () => {
    const check = await checkDraft(deps({ adapters: { fake: fakeAdapter({ fails: 'huly: project NEW not found' }) } }), draft)
    expect(check.tracker).toEqual({
      ok: false,
      missing: [],
      open: null,
      openToAll: false,
      notice: expect.objectContaining({ code: 'wizard.trackerFailed', params: { tracker: 'Fake' }, detail: 'huly: project NEW not found' }),
    })
  })

  it('says anyone can put a task into the chain of a public tracker project that needs no label', async () => {
    const adapter = fakeAdapter({ public: true })
    expect((await checkDraft(deps({ adapters: { fake: adapter } }), draft)).tracker).toEqual({ ok: true, missing: [], open: 0, openToAll: true, notice: null })
    const labelled = deps({ adapters: { fake: adapter }, raw: () => ({ chain: { requiredLabels: ['ready'] }, projects: [] }) })
    expect((await checkDraft(labelled, draft)).tracker?.openToAll).toBe(false)
    expect((await checkDraft(deps({ adapters: { fake: fakeAdapter({ public: false }) } }), draft)).tracker?.openToAll).toBe(false)
  })

  it("names a required label an issue template of the folder's branch puts on, where the folder is the tracker's repository (BTN-1130)", async () => {
    const answers = {
      'D:\\new config --get-regexp ^remote\\..*\\.url$': { code: 0, out: 'remote.origin.url git@github.com:example/app.git\n' },
      'D:\\new ls-tree -r --name-only trunk': { code: 0, out: '.github/ISSUE_TEMPLATE/bug.yml\nsrc/main.ts\n' },
      'D:\\new show trunk:.github/ISSUE_TEMPLATE/bug.yml': { code: 0, out: 'name: Bug\nlabels: [bug]\n' },
    }
    const raw = () => ({ chain: { requiredLabels: ['bug'] }, projects: [] })
    const labelled = deps({ adapters: { fake: fakeAdapter({ public: true }) }, raw }, answers)
    const own = { ...draft, trackerProject: 'example/app' }
    expect((await checkDraft(labelled, own)).tracker?.templateHits).toEqual([{ label: 'bug', template: '.github/ISSUE_TEMPLATE/bug.yml' }])
    expect((await checkDraft(labelled, { ...draft, trackerProject: 'other/app' })).tracker?.templateHits).toBeUndefined()
    const plain = deps({ adapters: { fake: fakeAdapter() }, raw }, answers)
    expect((await checkDraft(plain, own)).tracker?.templateHits).toBeUndefined()
  })

  it('gives the tracker the project it names the project by', async () => {
    const adapter = fakeAdapter()
    adapter.projectKey = { key: 'fake', pattern: /^\w+\/\w+$/, example: 'org/name' }
    const check = await checkDraft(deps({ adapters: { fake: adapter } }), { ...draft, trackerProject: 'org/new' })
    expect(check.tracker?.ok).toBe(true)
    expect(adapter.asked).toEqual(['NEW=org/new', 'NEW'])
  })

  it('checks the rest without the tracker when the page holds its answer (BTN-737)', async () => {
    const adapter = fakeAdapter()
    const check = await checkDraft(deps({ adapters: { fake: adapter } }), draft, { tracker: false })
    expect(adapter.asked).toEqual([])
    expect(check.tracker).toBeNull()
    expect(check.entry).toBeNull()
    expect(check.repo.root).toBe('D:\\new')
  })

  it("suggests the tracker's project by the first remote the adapter takes", async () => {
    const adapter = fakeAdapter()
    adapter.projectOfRemote = (remote) => (remote.host === 'github.com' ? `${remote.owner}/${remote.repo}` : undefined)
    const remotes = { code: 0, out: 'remote.origin.url https://git.example.com/john/new.git\nremote.github.url git@github.com:octo-org/new.git\n' }
    const check = await checkDraft(deps({ adapters: { fake: adapter } }, { 'D:\\new config --get-regexp ^remote\\..*\\.url$': remotes }), draft)
    expect(check.repo.suggested).toBe('octo-org/new')
  })

  it("gives the adapter each remote as git has it and the values of the draft's profile", async () => {
    const adapter = fakeAdapter()
    const asked: unknown[] = []
    adapter.projectOfRemote = (_remote, url, env) => void asked.push([url, env])
    const remotes = { code: 0, out: 'remote.origin.url https://git.example.com/gitlab/acme/tools/new.git\n' }
    const env = { FAKE_URL: 'https://git.example.com/gitlab' }
    await checkDraft(deps({ adapters: { fake: adapter }, env }, { 'D:\\new config --get-regexp ^remote\\..*\\.url$': remotes }), draft)
    expect(asked).toEqual([['https://git.example.com/gitlab/acme/tools/new.git', env]])
  })

  it('suggests nothing when no remote fits or the adapter takes none', async () => {
    const remotes = { 'D:\\new config --get-regexp ^remote\\..*\\.url$': { code: 0, out: 'remote.origin.url https://git.example.com/john/new.git\n' } }
    const adapter = fakeAdapter()
    adapter.projectOfRemote = (remote) => (remote.host === 'github.com' ? `${remote.owner}/${remote.repo}` : undefined)
    expect((await checkDraft(deps({ adapters: { fake: adapter } }, remotes), draft)).repo.suggested).toBeNull()
    expect((await checkDraft(deps({}, remotes), draft)).repo.suggested).toBeNull()
  })
})

describe('isTrusted', () => {
  it('requires a trusted Windows key with forward slashes', () => {
    const config = { projects: { 'D:/other': { hasTrustDialogAccepted: true }, 'd:/new': { hasTrustDialogAccepted: false }, 'D:\\new': { hasTrustDialogAccepted: true } } }
    expect(isTrusted(config, 'D:\\new', 'win32')).toBe(false)
    expect(isTrusted({ projects: { 'D:\\new': { hasTrustDialogAccepted: true } } }, 'D:\\new', 'win32')).toBe(false)
    expect(isTrusted({ projects: { 'd:/NEW': { hasTrustDialogAccepted: true } } }, 'D:\\new', 'win32')).toBe(true)
    expect(isTrusted({ projects: { 'D:/new': { hasTrustDialogAccepted: false } } }, 'D:\\new', 'win32')).toBe(false)
    expect(isTrusted(undefined, 'D:\\new', 'win32')).toBe(false)
  })

  it.each(['linux', 'darwin'] as const)('keeps native path spelling on %s', (platform) => {
    expect(isTrusted({ projects: { '/repo\\name': { hasTrustDialogAccepted: true } } }, '/repo\\name', platform)).toBe(true)
    expect(isTrusted({ projects: { '/repo': { hasTrustDialogAccepted: true } } }, '/repo/child', platform)).toBe(false)
  })

  it('reads a linked folder under its real path on Linux, as the CLI does (EKR-94)', () => {
    const root = mkdtempSync(join(tmpdir(), 'ek-trusted-'))
    try {
      const repo = join(root, 'repo')
      mkdirSync(repo)
      const link = join(root, 'link')
      symlinkSync(repo, link, linkType(process.platform))
      expect(isTrusted({ projects: { [link]: { hasTrustDialogAccepted: true } } }, link, 'linux')).toBe(false)
      expect(isTrusted({ projects: { [realpathSync.native(repo)]: { hasTrustDialogAccepted: true } } }, link, 'linux')).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
