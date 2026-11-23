import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readBranches } from '../git/branches.js'
import { runGit } from '../git/run.js'
import { notice } from '../notice/notice.js'
import { branchHere } from '../machine/branch-here.js'
import { BranchControl } from './branch-control.js'
import { branchMove } from './branch.js'

let top: string
let repo: string

const gitIn = async (cwd: string, ...args: string[]) => {
  const result = await runGit(cwd, args)
  if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.out}`)
  return result.out
}
const git = (...args: string[]) => gitIn(repo, ...args)
const commit = async (cwd: string, name: string, text = name) => {
  writeFileSync(join(cwd, name), text)
  await gitIn(cwd, 'add', name)
  await gitIn(cwd, 'commit', '-q', '-m', name)
}
const identity = async (cwd: string) => {
  await gitIn(cwd, 'config', 'user.email', 'john.doe@example.com')
  await gitIn(cwd, 'config', 'user.name', 'John Doe')
  await gitIn(cwd, 'config', 'core.hooksPath', join(cwd, 'no-hooks'))
}

// One pair made once and copied per test: an upstream with `main` and `shared`, its clone with a local `local` of its own.
let base: string

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'even-keel-branch-'))
  const upstream = join(base, 'upstream')
  await runGit(base, ['init', '-q', '--template=', '-b', 'main', upstream])
  await identity(upstream)
  await commit(upstream, 'base')
  await gitIn(upstream, 'branch', 'shared')
  await gitIn(base, 'clone', '-q', '--template=', upstream, join(base, 'repo'))
  const clone = join(base, 'repo')
  await identity(clone)
  await gitIn(clone, 'switch', '-q', '-c', 'local')
  await commit(clone, 'note', 'local')
  await gitIn(clone, 'switch', '-q', 'main')
}, 60_000)

afterAll(() => rmSync(base, { recursive: true, force: true }))

beforeEach(async () => {
  top = mkdtempSync(join(tmpdir(), 'even-keel-branch-'))
  await cp(base, top, { recursive: true })
  repo = join(top, 'repo')
  // The copy's remote still points at the first upstream: point it at its own.
  await git('remote', 'set-url', 'origin', join(top, 'upstream'))
})

afterEach(() => rmSync(top, { recursive: true, force: true }))

function control(options: { busy?: boolean; branch?: string; write?: (branch: string) => void } = {}) {
  const writes: string[] = []
  let branch = options.branch ?? 'main'
  const changes: number[] = []
  const branches = new BranchControl({
    git: runGit,
    repo: (project) => (project === 'p1' ? repo : undefined),
    branch: () => branch,
    key: () => 'ABC',
    busy: () => options.busy ?? false,
    write: (_project, next) => {
      options.write?.(next)
      writes.push(next)
      branch = next
    },
    changed: () => changes.push(1),
  })
  const save = (next: string) =>
    branches.change('p1', repo, next, () => {
      options.write?.(next)
      writes.push(next)
      branch = next
    })
  return { branches, writes, changes, save }
}

const head = () => git('symbolic-ref', '--short', 'HEAD')

describe('readBranches', { timeout: 30_000 }, () => {
  it('lists the current branch first, then the local ones, then those only on a remote, without HEAD', async () => {
    const read = await readBranches(runGit, repo)
    expect(read?.current).toBe('main')
    expect(read?.head).toMatch(/^[0-9a-f]{7,}$/)
    expect(read?.branches).toEqual([
      { name: 'main', remote: null },
      { name: 'local', remote: null },
      { name: 'shared', remote: 'origin' },
    ])
  })

  it('reads a detached HEAD as no current branch', async () => {
    await git('switch', '-q', '--detach', 'HEAD')
    const read = await readBranches(runGit, repo)
    expect(read?.current).toBeNull()
    expect(read?.branches.map((each) => each.name)).toEqual(['local', 'main', 'shared'])
  })

  it('marks hidden a branch another worktree holds and a task branch left without its worktree', async () => {
    await git('worktree', 'add', '-q', '-b', 'abc-1/task', join(top, 'task'))
    await git('branch', 'abc-2/task')
    const read = await readBranches(runGit, repo)
    expect(read?.branches).toEqual([
      { name: 'main', remote: null },
      { name: 'abc-1/task', remote: null, hidden: true },
      { name: 'abc-2/task', remote: null, hidden: true },
      { name: 'local', remote: null },
      { name: 'shared', remote: 'origin' },
    ])
  })
})

describe('branchMove', () => {
  const repoBranches = { current: 'main', head: 'abc1234', branches: [{ name: 'main', remote: null }, { name: 'local', remote: null }, { name: 'shared', remote: 'origin' }] }

  it('says what saving does to the checkout', () => {
    expect(branchMove(repoBranches, 'main')).toEqual({ kind: 'stay' })
    expect(branchMove(repoBranches, 'local')).toEqual({ kind: 'switch', from: 'main' })
    expect(branchMove(repoBranches, 'shared')).toEqual({ kind: 'track', remote: 'origin', from: 'main' })
    expect(branchMove(repoBranches, 'next')).toEqual({ kind: 'create', from: 'main', head: 'abc1234' })
  })

  it('moves to a hidden branch as to any other, so git refuses one a worktree holds rather than a new one being made', () => {
    const withTask = { ...repoBranches, branches: [...repoBranches.branches, { name: 'abc-1/task', remote: null, hidden: true as const }] }
    expect(branchMove(withTask, 'abc-1/task')).toEqual({ kind: 'switch', from: 'main' })
  })
})

describe('BranchControl.change', { timeout: 30_000 }, () => {
  it('switches the checkout to a local branch, then writes', async () => {
    const { save, writes } = control()
    await save('local')
    expect(await head()).toBe('local')
    expect(writes).toEqual(['local'])
  })

  it('creates a branch no one has from the current one, carrying the uncommitted changes', async () => {
    writeFileSync(join(repo, 'base'), 'edited')
    const { save } = control()
    await save('next')
    expect(await head()).toBe('next')
    expect(await git('rev-parse', 'next')).toBe(await git('rev-parse', 'main'))
    expect(readFileSync(join(repo, 'base'), 'utf8')).toBe('edited')
  })

  it('takes a branch that is only on the remote, tracking it', async () => {
    const { save } = control()
    await save('shared')
    expect(await head()).toBe('shared')
    expect(await git('rev-parse', '--abbrev-ref', 'shared@{upstream}')).toBe('origin/shared')
  })

  it('refuses uncommitted changes that conflict with the branch: the config and the checkout stay', async () => {
    writeFileSync(join(repo, 'note'), 'mine')
    const { save, writes } = control()
    await expect(save('local')).rejects.toMatchObject({ notice: notice('branch.dirty', { branch: 'local', current: 'main' }) })
    expect(await head()).toBe('main')
    expect(writes).toEqual([])
    expect(readFileSync(join(repo, 'note'), 'utf8')).toBe('mine')
  })

  it('refuses a branch another worktree has checked out', async () => {
    await git('worktree', 'add', '-q', join(top, 'other'), 'local')
    const { save, writes } = control()
    await expect(save('local')).rejects.toMatchObject({ notice: notice('branch.taken', { branch: 'local' }) })
    expect(await head()).toBe('main')
    expect(writes).toEqual([])
  })

  it('refuses a task branch its worktree holds, though the field does not offer it', async () => {
    await git('worktree', 'add', '-q', '-b', 'abc-1/task', join(top, 'task'))
    const { save, writes } = control()
    await expect(save('abc-1/task')).rejects.toMatchObject({ notice: notice('branch.taken', { branch: 'abc-1/task' }) })
    expect(await git('branch', '--list', 'abc-1/task')).toContain('abc-1/task')
    expect(writes).toEqual([])
  })

  it('refuses a name git does not take as a branch, as the field error of the config', async () => {
    const { save, writes } = control()
    await expect(save('bad..name')).rejects.toMatchObject({ notice: notice('config.branch', { where: 'ABC.branch', value: '"bad..name"' }) })
    expect(writes).toEqual([])
  })

  it('refuses while a task of the project is in work', async () => {
    const { save, writes } = control({ busy: true })
    await expect(save('local')).rejects.toMatchObject({ notice: notice('branch.busy', { project: 'p1' }) })
    expect(await head()).toBe('main')
    expect(writes).toEqual([])
  })

  it('puts the checkout back and drops the branch it made when the write fails', async () => {
    const { save } = control({
      write: () => {
        throw new Error('the config would not parse')
      },
    })
    await expect(save('next')).rejects.toThrow('the config would not parse')
    expect(await head()).toBe('main')
    expect((await runGit(repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/next'])).code).not.toBe(0)
  })
})

describe('BranchControl drift', { timeout: 30_000 }, () => {
  it('notes a checkout moved by hand when the branches are read, and forgets it once it is back', async () => {
    await git('switch', '-q', 'local')
    const { branches, changes } = control()
    await branches.branches('p1')
    expect(branches.view()).toEqual({ p1: { branch: 'main', current: 'local' } })
    await git('switch', '-q', 'main')
    await branches.refresh('p1')
    expect(branches.view()).toEqual({})
    expect(changes).toHaveLength(2)
  })

  it('"Make it the main branch" writes the checkout\'s branch and leaves git alone', async () => {
    await git('switch', '-q', 'local')
    const { branches, writes } = control()
    await branches.adopt('p1')
    expect(writes).toEqual(['local'])
    expect(await head()).toBe('local')
    expect(branches.view()).toEqual({})
  })

  it('"Put the folder back" switches the checkout onto the branch, with the same refusals', async () => {
    await git('switch', '-q', 'local')
    writeFileSync(join(repo, 'note'), 'mine')
    const { branches, writes } = control()
    await expect(branches.restore('p1')).rejects.toMatchObject({ notice: notice('branch.dirty', { branch: 'main', current: 'local' }) })
    await git('checkout', '--', 'note')
    await branches.restore('p1')
    expect(await head()).toBe('main')
    expect(writes).toEqual([])
    expect(branches.view()).toEqual({})
  })

  it('refuses both buttons while a task is in work', async () => {
    await git('switch', '-q', 'local')
    const { branches } = control({ busy: true })
    await expect(branches.adopt('p1')).rejects.toMatchObject({ notice: notice('branch.busy', { project: 'p1' }) })
    await expect(branches.restore('p1')).rejects.toMatchObject({ notice: notice('branch.busy', { project: 'p1' }) })
    expect(await head()).toBe('local')
  })
})

describe('BranchControl with machines elsewhere (BTN-1567)', { timeout: 60_000 }, () => {
  /** Two machines of the pool, each with its clone of the project; their side of the link is `branchHere` called directly. */
  async function pooled(online: Record<string, boolean> = {}) {
    const folders: Record<string, string> = { m1: join(top, 'm1'), m2: join(top, 'm2') }
    for (const folder of Object.values(folders)) {
      await cp(repo, folder, { recursive: true })
      await gitIn(folder, 'remote', 'set-url', 'origin', join(top, 'upstream'))
    }
    const here = (machine: string) => branchHere({ git: runGit, folderOf: () => folders[machine], moved: () => {} })
    const checkouts: Record<string, string | null> = {}
    let branch = 'main'
    const writes: string[] = []
    const branches = new BranchControl({
      git: runGit,
      repo: () => repo,
      branch: () => branch,
      key: () => 'ABC',
      busy: () => false,
      write: (_project, next) => {
        writes.push(next)
        branch = next
      },
      changed: () => {},
      machines: {
        pool: () => Object.keys(folders).map((id) => ({ id, name: id.toUpperCase(), online: online[id] ?? true })),
        move: (machine, project, next) => here(machine).move(project, next),
        back: (machine, project, next, shift) => here(machine).back(project, next, shift),
        checkouts: () => ({ p1: checkouts }),
      },
    })
    const save = (next: string) =>
      branches.change('p1', repo, next, () => {
        writes.push(next)
        branch = next
      })
    const headOf = (machine: string) => gitIn(folders[machine]!, 'symbolic-ref', '--short', 'HEAD')
    return { branches, folders, checkouts, writes, save, headOf }
  }

  it('moves the folder of every machine of the pool with the checkout, a branch only on the remote tracked there too', async () => {
    const { save, headOf, folders, writes } = await pooled()
    // The second machine has not fetched since `shared` came: the move fetches first and tracks it.
    await gitIn(folders.m2!, 'update-ref', '-d', 'refs/remotes/origin/shared')
    await save('shared')
    expect(await head()).toBe('shared')
    expect(await headOf('m1')).toBe('shared')
    expect(await headOf('m2')).toBe('shared')
    expect(await gitIn(folders.m2!, 'rev-parse', '--abbrev-ref', 'shared@{upstream}')).toBe('origin/shared')
    expect(writes).toEqual(['shared'])
  })

  it('refuses with the machine named when its folder cannot move: the machines moved go back, the hub and the config stay', async () => {
    const { save, headOf, folders, writes } = await pooled()
    writeFileSync(join(folders.m2!, 'note'), 'mine')
    const refused = await save('local').catch((error: unknown) => error)
    expect(refused).toMatchObject({ notice: { code: 'branch.machineFailed', params: { project: 'p1', name: 'M2' }, cause: notice('branch.dirty', { branch: 'local', current: 'main' }) } })
    expect(await headOf('m1')).toBe('main')
    expect(await headOf('m2')).toBe('main')
    expect(await head()).toBe('main')
    expect(writes).toEqual([])
  })

  it('drops the branch a machine made when the hub then refuses', async () => {
    const { save, headOf, folders } = await pooled()
    writeFileSync(join(repo, 'note'), 'mine')
    await gitIn(folders.m1!, 'branch', '-D', 'local')
    await expect(save('local')).rejects.toMatchObject({ notice: notice('branch.dirty', { branch: 'local', current: 'main' }) })
    expect(await headOf('m1')).toBe('main')
    expect((await runGit(folders.m1!, ['rev-parse', '--verify', '--quiet', 'refs/heads/local'])).code).not.toBe(0)
    expect(await headOf('m2')).toBe('main')
  })

  it('refuses while a machine of the pool is offline, naming it, and moves nothing', async () => {
    const { save, headOf, writes } = await pooled({ m2: false })
    await expect(save('local')).rejects.toMatchObject({ notice: notice('branch.machineOffline', { project: 'p1', name: 'M2' }) })
    expect(await headOf('m1')).toBe('main')
    expect(await head()).toBe('main')
    expect(writes).toEqual([])
  })

  it("shows a machine's folder off the branch as its drift, puts it back there, or makes its branch the project's", async () => {
    const { branches, checkouts, headOf, folders, writes } = await pooled()
    await gitIn(folders.m2!, 'switch', '-q', 'local')
    checkouts.m2 = 'local'
    checkouts.m1 = 'main'
    expect(branches.machineDrift()).toEqual({ p1: { m2: { branch: 'main', current: 'local' } } })
    expect(branches.held('p1', 'm2')).toBe(true)
    expect(branches.held('p1', 'm1')).toBe(false)

    await branches.restore('p1', 'm2')
    expect(await headOf('m2')).toBe('main')

    await gitIn(folders.m2!, 'switch', '-q', 'local')
    await branches.adopt('p1', 'm2')
    expect(writes).toEqual(['local'])
    expect(await head()).toBe('local')
    expect(await headOf('m1')).toBe('local')
    expect(await headOf('m2')).toBe('local')
  })
})
