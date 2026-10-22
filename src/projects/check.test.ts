import { describe, expect, it } from 'vitest'
import type { GitResult } from '../git/types.js'
import type { ProjectDraft } from '../state.js'
import type { TaskSource, TrackerAdapter } from '../tracker/source.js'
import type { TrackerTask } from '../tracker/model.js'
import { checkDraft, isTrusted, type CheckDeps } from './check.js'

const draft: ProjectDraft = { repo: 'D:\\new\\src', branch: '', key: 'NEW', name: '', tracker: 'fake', trackerProject: '', profile: null, slot: 0 }

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
              asked.push(...Object.entries(projects).map(([key, place]) => `${key}=${place}`))
              return {
                chainTasks: async (project: string) => {
                  asked.push(project)
                  return { tasks: options.tasks ?? [], statuses: [] }
                },
                ...(options.public === undefined ? {} : { isPublic: async () => options.public }),
                close: async () => {},
              } as unknown as TaskSource
            },
          },
  }
}

function deps(fields: Partial<CheckDeps> = {}, answers: Record<string, GitResult> = {}): CheckDeps {
  const git = async (cwd: string, args: string[]): Promise<GitResult> => {
    const answer = answers[`${cwd} ${args.join(' ')}`]
    if (answer !== undefined) return answer
    if (cwd.startsWith('D:\\new') && args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { code: 0, out: 'D:/new' }
    if (cwd === 'D:\\new' && args[0] === 'symbolic-ref') return { code: 0, out: 'trunk' }
    if (cwd === 'D:\\new' && args.join(' ') === 'for-each-ref --format=%(refname:short) refs/heads/') return { code: 0, out: 'trunk\ndev\n' }
    return { code: 128, out: `fatal: not a git repository: ${cwd}` }
  }
  return {
    git,
    raw: () => ({ projects: [{ id: 'id-abc', key: 'ABC', repo: 'C:\\abc' }] }),
    adapters: { fake: fakeAdapter({ tasks: [task('NEW-1', 'ToDo'), task('NEW-2', 'ToDo'), task('NEW-3', 'Won')] }) },
    env: {},
    claudeConfig: () => ({ projects: { 'd:/new': { hasTrustDialogAccepted: true } } }),
    timeoutMs: 1000,
    platform: 'win32',
    ...fields,
  }
}

describe('checkDraft', () => {
  it('takes the top of the repository, suggests its branch, asks the tracker and the trust', async () => {
    const check = await checkDraft(deps(), draft)
    expect(check).toEqual({
      repo: { root: 'D:\\new', current: 'trunk', suggested: null, notice: null },
      entry: null,
      tracker: { ok: true, missing: [], open: 2, openToAll: false, notice: null },
      trusted: true,
      platform: 'win32',
    })
  })

  it('says a folder is not a git repository and checks nothing that needs one', async () => {
    const check = await checkDraft(deps(), { ...draft, repo: 'E:\\plain' })
    expect(check.repo).toEqual({ root: null, current: null, suggested: null, notice: expect.objectContaining({ code: 'wizard.notRepo', params: { path: 'E:\\plain' } }) })
    expect(check.trusted).toBeNull()
  })

  it('leaves a blank folder unchecked, without a notice', async () => {
    const check = await checkDraft(deps(), { ...draft, repo: ' ' })
    expect(check.repo).toEqual({ root: null, current: null, suggested: null, notice: null })
    expect(check.tracker).toBeNull()
  })

  it('refuses a branch the repository does not have and names the ones it has', async () => {
    const check = await checkDraft(deps(), { ...draft, branch: 'main' })
    expect(check.repo.notice).toEqual(expect.objectContaining({ code: 'wizard.noBranch', params: { branch: 'main', branches: ['trunk', 'dev'] } }))
  })

  it('says a repository without a commit needs one, whatever the branch, and asks no tracker', async () => {
    const empty = { 'D:\\new for-each-ref --format=%(refname:short) refs/heads/': { code: 0, out: '' } }
    for (const branch of ['', 'main']) {
      const check = await checkDraft(deps({}, empty), { ...draft, branch })
      expect(check.repo).toEqual({ root: 'D:\\new', current: 'trunk', suggested: null, notice: expect.objectContaining({ code: 'wizard.noCommits' }) })
      expect(check.tracker).toBeNull()
    }
  })

  it('refuses a repository another project already has', async () => {
    const check = await checkDraft(deps({ raw: () => ({ projects: [{ id: 'id-abc', key: 'ABC', repo: 'd:\\NEW' }] }) }), draft)
    expect(check.repo.notice).toEqual(expect.objectContaining({ code: 'wizard.repoTaken', params: { project: 'ABC' } }))
  })

  it('gives what parseConfig says of the config with the draft, and asks no tracker then', async () => {
    const adapter = fakeAdapter()
    const check = await checkDraft(deps({ adapters: { fake: adapter } }), { ...draft, key: 'a b' })
    expect(check.entry).toEqual(expect.objectContaining({ code: 'config.projectKey' }))
    expect(check.tracker).toBeNull()
    expect(adapter.asked).toEqual([])
  })

  it('names the project that has the key already, not its place in the config', async () => {
    const adapter = fakeAdapter()
    const named = () => ({ projects: [{ id: 'id-abc', key: 'ABC', name: 'Web shop', repo: 'C:\\abc' }] })
    const check = await checkDraft(deps({ raw: named, adapters: { fake: adapter } }), { ...draft, key: ' ABC ' })
    expect(check.entry).toEqual(expect.objectContaining({ code: 'wizard.keyTaken', params: { key: 'ABC', project: 'Web shop' } }))
    expect(check.tracker).toBeNull()
    expect(adapter.asked).toEqual([])
    const bare = await checkDraft(deps(), { ...draft, key: 'ABC' })
    expect(bare.entry).toEqual(expect.objectContaining({ code: 'wizard.keyTaken', params: { key: 'ABC', project: 'ABC' } }))
  })

  it('says a team taken by another project is one project per team in this version', async () => {
    const team = { ...fakeAdapter(), title: 'Linear', projectKey: { key: 'fake', optional: true, pattern: /\S/, example: 'Web app' } }
    const check = await checkDraft(deps({ adapters: { fake: team } }), { ...draft, key: 'ABC', trackerProject: 'Mobile' })
    expect(check.entry).toEqual(expect.objectContaining({ code: 'wizard.teamTaken', params: { tracker: 'Linear', team: 'ABC', project: 'ABC' } }))
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

  it('gives the tracker the project it names the project by', async () => {
    const adapter = fakeAdapter()
    adapter.projectKey = { key: 'fake', pattern: /^\w+\/\w+$/, example: 'org/name' }
    const check = await checkDraft(deps({ adapters: { fake: adapter } }), { ...draft, trackerProject: 'org/new' })
    expect(check.tracker?.ok).toBe(true)
    expect(adapter.asked).toEqual(['NEW=org/new', 'NEW'])
  })

  it("suggests the tracker's project by the first remote the adapter takes", async () => {
    const adapter = fakeAdapter()
    adapter.projectOfRemote = (remote) => (remote.host === 'github.com' ? `${remote.owner}/${remote.repo}` : undefined)
    const remotes = { code: 0, out: 'remote.origin.url https://git.example.com/john/new.git\nremote.github.url git@github.com:octo-org/new.git\n' }
    const check = await checkDraft(deps({ adapters: { fake: adapter } }, { 'D:\\new config --get-regexp ^remote\\..*\\.url$': remotes }), draft)
    expect(check.repo.suggested).toBe('octo-org/new')
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
  it('finds the folder under any spelling the CLI wrote it by', () => {
    const config = { projects: { 'D:/other': { hasTrustDialogAccepted: true }, 'd:/new': { hasTrustDialogAccepted: false }, 'D:\\new': { hasTrustDialogAccepted: true } } }
    expect(isTrusted(config, 'D:\\new', 'win32')).toBe(true)
    expect(isTrusted({ projects: { 'D:/new': { hasTrustDialogAccepted: false } } }, 'D:\\new', 'win32')).toBe(false)
    expect(isTrusted(undefined, 'D:\\new', 'win32')).toBe(false)
  })
})
