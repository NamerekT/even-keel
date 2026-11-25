import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGit } from '../../git/run.js'
import { RemoteMirror } from './remote-mirror.js'
import { MEMORY_BRANCH } from './sync.js'

const ONE = '11111111-1111-4111-8111-111111111111'
const TWO = '22222222-2222-4222-8222-222222222222'

const identity = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.hooksPath',
  GIT_CONFIG_VALUE_0: 'no-hooks',
  GIT_AUTHOR_NAME: 'John Doe',
  GIT_AUTHOR_EMAIL: 'john.doe@example.com',
  GIT_COMMITTER_NAME: 'John Doe',
  GIT_COMMITTER_EMAIL: 'john.doe@example.com',
}

const git = async (cwd: string, ...args: string[]) => {
  const result = await runGit(cwd, args, identity)
  if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.out}`)
  return result.out
}

let root: string
let address: string | null
let logs: string[]
let mirror: RemoteMirror

const repositoryOf = (project: string) => join(root, 'hub', `${project}.git`)

/** A commit of `file` into the project's hub repository, as a working copy's push would bring it. */
async function land(project: string, file: string, text = 'x'): Promise<string> {
  const work = join(root, `work-${project}`)
  if ((await runGit(root, ['-C', work, 'rev-parse', '--git-dir'])).code !== 0) {
    await git(root, 'clone', '-q', repositoryOf(project), work)
    await git(work, 'checkout', '-q', '-B', MEMORY_BRANCH)
  }
  writeFileSync(join(work, file), text)
  await git(work, 'add', '-A')
  await git(work, 'commit', '-q', '-m', file)
  await git(work, 'push', '-q', 'origin', `HEAD:refs/heads/${MEMORY_BRANCH}`)
  return git(work, 'rev-parse', 'HEAD')
}

const branchOf = async (project: string) => {
  const listed = await runGit(root, ['ls-remote', join(root, 'mirror.git'), `refs/heads/${project}`])
  return listed.code === 0 ? (listed.out.split('\t')[0] ?? '') : ''
}

describe('RemoteMirror (BTN-1649)', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'ek-memory-mirror-'))
    for (const project of [ONE, TWO]) await git(root, 'init', '--bare', '-q', '-b', MEMORY_BRANCH, repositoryOf(project))
    await git(root, 'init', '--bare', '-q', join(root, 'mirror.git'))
    address = join(root, 'mirror.git')
    logs = []
    mirror = new RemoteMirror({ address: () => address, repositoryOf, projects: () => [ONE, TWO], log: (line) => logs.push(line) })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("pushes the project's repository into its own branch of the mirror, named by the project's id", async () => {
    const head = await land(ONE, 'a.md')
    await mirror.push(ONE)
    expect(await branchOf(ONE)).toBe(head)
    expect(await branchOf(TWO)).toBe('')
    expect(logs).toEqual([])
  })

  it('does nothing without an address, or for a repository with no commit yet', async () => {
    address = null
    await land(ONE, 'a.md')
    await mirror.push(ONE)
    expect(await branchOf(ONE)).toBe('')
    address = join(root, 'mirror.git')
    await mirror.push(TWO)
    expect(await branchOf(TWO)).toBe('')
    expect(logs).toEqual([])
  })

  it('logs a failed push once and catches up at the next push once the mirror is reachable', async () => {
    address = join(root, 'missing.git')
    await land(ONE, 'a.md')
    await mirror.push(ONE)
    await mirror.push(ONE)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(new RegExp(`^memory: ${ONE} cannot push to the mirror, tried again at its next push: `))
    address = join(root, 'mirror.git')
    const head = await land(ONE, 'b.md')
    await mirror.push(ONE)
    expect(await branchOf(ONE)).toBe(head)
    expect(logs[1]).toBe(`memory: ${ONE} reached the mirror again`)
  })

  it("never rewrites the mirror's branch when it holds commits the hub lacks", async () => {
    await land(ONE, 'a.md')
    await mirror.push(ONE)
    const other = join(root, 'other')
    await git(root, 'clone', '-q', '-b', ONE, join(root, 'mirror.git'), other)
    writeFileSync(join(other, 'c.md'), 'y')
    await git(other, 'add', '-A')
    await git(other, 'commit', '-q', '-m', 'c')
    await git(other, 'push', '-q', 'origin', `HEAD:refs/heads/${ONE}`)
    const theirs = await git(other, 'rev-parse', 'HEAD')
    await land(ONE, 'b.md')
    await mirror.push(ONE)
    expect(await branchOf(ONE)).toBe(theirs)
    expect(logs).toEqual([`memory: the mirror's branch ${ONE} has commits the hub's repository lacks: it is left as it is`])
  })

  it('shows on the page a branch left behind, until a push reaches it again (BTN-1674)', async () => {
    await land(ONE, 'a.md')
    await mirror.push(ONE)
    const other = join(root, 'other')
    await git(root, 'clone', '-q', '-b', ONE, join(root, 'mirror.git'), other)
    writeFileSync(join(other, 'c.md'), 'y')
    await git(other, 'add', '-A')
    await git(other, 'commit', '-q', '-m', 'c')
    await git(other, 'push', '-q', 'origin', `HEAD:refs/heads/${ONE}`)
    await land(ONE, 'b.md')
    await mirror.push(ONE)
    expect(mirror.view()).toEqual({ code: 'memory.mirrorBehind', params: { address, projects: ONE } })
    await land(ONE, 'd.md')
    await mirror.push(ONE)
    expect(logs).toHaveLength(1)

    await git(root, '-C', join(root, 'mirror.git'), 'update-ref', '-d', `refs/heads/${ONE}`)
    await land(ONE, 'e.md')
    await mirror.push(ONE)
    expect(mirror.view()).toEqual({ code: 'memory.mirrorPrivate', params: { address } })
  })

  it('pushes every project at the first apply and at a new address, not at an unchanged one', async () => {
    const one = await land(ONE, 'a.md')
    const two = await land(TWO, 'b.md')
    await mirror.apply()
    expect([await branchOf(ONE), await branchOf(TWO)]).toEqual([one, two])
    rmSync(join(root, 'mirror.git'), { recursive: true, force: true })
    await git(root, 'init', '--bare', '-q', join(root, 'mirror.git'))
    await mirror.apply()
    expect(await branchOf(ONE)).toBe('')
    address = `${join(root, 'mirror.git')}/`
    await mirror.apply()
    expect(await branchOf(ONE)).toBe(one)
  })

  it('warns that the mirror must be private while one is set', () => {
    expect(mirror.view()).toEqual({ code: 'memory.mirrorPrivate', params: { address } })
    address = null
    expect(mirror.view()).toBeNull()
  })
})
