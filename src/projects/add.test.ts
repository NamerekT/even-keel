import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigStore } from '../config-store.js'
import type { Git } from '../git/types.js'
import { importConfig } from '../settings/import.js'
import { fileOf } from '../settings/file.js'
import { mirrorDefinitions, readSettings } from '../settings/store.js'
import type { ProjectDraft } from '../state.js'
import { Writes } from '../storage/database.js'
import { memoryDatabase } from '../storage/memory.js'
import { ADAPTERS } from '../tracker/adapters.js'
import { addProject } from './add.js'
import { checkDraft } from './check.js'

const root = join(process.cwd(), '.temp', 'add-repo')
const draft: ProjectDraft = { repo: join(root, 'src'), branch: 'trunk', key: 'NEW', name: '', tracker: 'github', trackerProject: 'example/new', profile: 'profile', slot: 0, milestones: [], provider: null }

describe('project addition', () => {
  let configStore: ConfigStore
  let read: () => Promise<unknown>
  const link = vi.fn()
  const git: Git = async (cwd, args) => {
    if (cwd.endsWith('missing') || cwd.endsWith('plain')) return { code: 128, out: `fatal: not a git repository: ${cwd}` }
    if (args[0] === 'rev-parse') return { code: 0, out: root.replaceAll('\\', '/') }
    if (args[0] === 'symbolic-ref') return { code: 0, out: 'trunk' }
    if (args[0] === 'for-each-ref') return { code: 0, out: 'trunk\ndev' }
    return { code: 1, out: '' }
  }
  const deps = () => ({ configStore, profiles: { link }, git })

  beforeEach(async () => {
    const db = await memoryDatabase()
    await mirrorDefinitions(db)
    await importConfig(db, { projects: [] })
    const writes = new Writes(() => {})
    configStore = await ConfigStore.open({ db, writes, intervalMs: 1000, onChange: () => {}, warn: () => {} })
    read = async () => {
      await writes.settled()
      return fileOf(await readSettings(db))
    }
    link.mockClear()
  })

  it.each(['missing', 'plain'])('refuses a %s folder with the check notice and leaves the config and profile links alone', async (folder) => {
    const invalid = { ...draft, repo: join(root, folder) }
    const checked = await checkDraft({ git, raw: () => configStore.raw(), adapters: ADAPTERS, env: {}, claudeConfigs: () => [], timeoutMs: 100, user: 'svc' }, invalid)
    expect(checked.repo.notice?.code).toBe('wizard.notRepo')
    const before = await read()
    await expect(Promise.resolve().then(() => addProject(deps(), invalid))).rejects.toMatchObject({ notice: checked.repo.notice })
    expect(configStore.raw()).toEqual(before)
    expect(await read()).toEqual(before)
    expect(link).not.toHaveBeenCalled()
  })

  it('stores the repository root for a nested folder and links its profile', async () => {
    await addProject(deps(), draft)
    expect(Object.values(configStore.current.projects)).toEqual([root])
    expect(await read()).toMatchObject({ projects: [{ repo: root }] })
    expect(link).toHaveBeenCalledWith(Object.keys(configStore.current.projects)[0], 'profile')
  })

  it('refuses a repository already added through another subfolder', async () => {
    await addProject(deps(), draft)
    const before = await read()
    link.mockClear()
    await expect(Promise.resolve().then(() => addProject(deps(), { ...draft, repo: join(root, 'other'), key: 'OTHER', trackerProject: 'example/other' }))).rejects.toMatchObject({ notice: { code: 'wizard.repoTaken' } })
    expect(await read()).toEqual(before)
    expect(link).not.toHaveBeenCalled()
  })

  it.each([
    { branches: '', code: 'wizard.noCommits' },
    { branches: 'dev', code: 'wizard.noBranch' },
  ])('refuses $code before writing', async ({ branches, code }) => {
    const before = await read()
    const withBranches: Git = (cwd, args) => args[0] === 'for-each-ref' ? Promise.resolve({ code: 0, out: branches }) : git(cwd, args)
    await expect(addProject({ ...deps(), git: withBranches }, draft)).rejects.toMatchObject({ notice: { code } })
    expect(await read()).toEqual(before)
    expect(link).not.toHaveBeenCalled()
  })

  it('adds with the default profile without creating a profile link', async () => {
    await addProject(deps(), { ...draft, profile: null })
    expect(await read()).toMatchObject({ projects: [{ repo: root }] })
    expect(link).not.toHaveBeenCalled()
  })

  it.each([
    { change: { key: 'bad key' }, code: 'config.projectKey' },
    { change: { trackerProject: 'bad place' }, code: 'config.trackerProject' },
    { change: { repo: ' ' }, code: 'config.repoEmpty' },
  ])('keeps config validation for $code', async ({ change, code }) => {
    const before = await read()
    await expect(Promise.resolve().then(() => addProject(deps(), { ...draft, ...change }))).rejects.toMatchObject({ notice: { code } })
    expect(await read()).toEqual(before)
    expect(link).not.toHaveBeenCalled()
  })
})
