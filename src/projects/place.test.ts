import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RemoteHeads } from '../git/remote-run.js'
import { runGit } from '../git/run.js'
import type { Git, GitResult } from '../git/types.js'
import { notice, type Notice } from '../notice/notice.js'
import type { ProjectDraft } from '../state.js'
import { checkPlace, folderNames, measureFolder, type PlaceDeps } from './place.js'

const REMOTE = 'https://example.com/acme/storefront.git'
const base: ProjectDraft = { repo: '', branch: '', key: 'SHOP', name: '', tracker: 'fake', trackerProject: '', profile: null, slot: 0, milestones: [], provider: null }
const clone = (fields: Partial<ProjectDraft> = {}): ProjectDraft => ({ ...base, source: 'clone', remote: REMOTE, ...fields })

let dir: string
let own: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'place-'))
  own = join(dir, 'projects')
  mkdirSync(own)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

function deps(fields: Partial<PlaceDeps> = {}, answers: Record<string, GitResult> = {}, read: RemoteHeads | Notice = { head: 'main', branches: ['main', 'release/v0.2'] }): PlaceDeps & { asked: string[] } {
  const asked: string[] = []
  return {
    git: async (cwd, args) => {
      const answer = answers[`${cwd} ${args.join(' ')}`]
      if (answer !== undefined) return answer
      if (args[0] === 'check-ref-format') return { code: args[2]!.includes('..') ? 1 : 0, out: '' }
      if (args[0] === 'init' || args.includes('ls-files')) return runGit(cwd, args)
      return { code: 128, out: 'fatal: not a git repository' }
    },
    platform: process.platform,
    folders: { home: dir, isFolder: () => true },
    ownDir: own,
    readRemote: async (remote) => {
      asked.push(remote)
      return read
    },
    projectOf: () => undefined,
    asked,
    ...fields,
  }
}

describe('folderNames', () => {
  it('tries the name, then with the branch, then numbered', () => {
    const names = [...folderNames('storefront', 'release/v0.2')]
    expect(names.slice(0, 4)).toEqual(['storefront', 'storefront-release-v0.2', 'storefront-release-v0.2-2', 'storefront-release-v0.2-3'])
    expect([...folderNames('storefront', null)].slice(0, 2)).toEqual(['storefront', 'storefront-2'])
  })
})

describe('measureFolder', () => {
  it('counts files and bytes down the tree and stops at its cap', async () => {
    mkdirSync(join(dir, 'a', 'b'), { recursive: true })
    writeFileSync(join(dir, 'a', 'one.txt'), '12345')
    writeFileSync(join(dir, 'a', 'b', 'two.txt'), '123')
    expect(await measureFolder(runGit, join(dir, 'a'))).toEqual({ files: 2, bytes: 8, capped: false })
    expect(await measureFolder(runGit, join(dir, 'a'), 1)).toEqual(expect.objectContaining({ files: 1, capped: true }))
  })

  it('counts only what the first commit takes: .gitignore files down the tree leave the rest out', async () => {
    const folder = join(dir, 'with-files')
    mkdirSync(join(folder, 'node_modules', 'left-pad'), { recursive: true })
    mkdirSync(join(folder, 'src', 'cache'), { recursive: true })
    writeFileSync(join(folder, '.gitignore'), 'node_modules/\n*.log\n')
    writeFileSync(join(folder, 'README.md'), '# app\n')
    writeFileSync(join(folder, 'debug.log'), 'x'.repeat(100))
    writeFileSync(join(folder, 'node_modules', 'left-pad', 'index.js'), 'x'.repeat(100))
    writeFileSync(join(folder, 'src', '.gitignore'), 'cache/\n')
    writeFileSync(join(folder, 'src', 'app.js'), '1;\n')
    writeFileSync(join(folder, 'src', 'cache', 'big.bin'), 'x'.repeat(100))
    const bytes = 'node_modules/\n*.log\n'.length + '# app\n'.length + 'cache/\n'.length + '1;\n'.length
    expect(await measureFolder(runGit, folder)).toEqual({ files: 4, bytes, capped: false })
  })

  it('walks the whole folder when git cannot be asked', async () => {
    mkdirSync(join(dir, 'a'))
    writeFileSync(join(dir, 'a', '.gitignore'), '*.log\n')
    writeFileSync(join(dir, 'a', 'debug.log'), '1')
    const broken: Git = async () => ({ code: 128, out: 'fatal: broken' })
    expect(await measureFolder(broken, join(dir, 'a'))).toEqual({ files: 2, bytes: 7, capped: false })
  })
})

describe('checkPlace', () => {
  it('names a clone after its remote in the projects folder and reads its default branch', async () => {
    const check = await checkPlace(deps(), clone())
    expect(check).toEqual({ root: join(own, 'storefront'), current: 'main', suggested: null, branches: null, place: { dir: own, name: 'storefront', state: 'free' }, notice: null })
  })

  it('asks no remote and says nothing while the address is blank', async () => {
    const made = deps()
    expect(await checkPlace(made, clone({ remote: ' ' }))).toEqual(expect.objectContaining({ root: null, notice: null }))
    expect(made.asked).toEqual([])
  })

  it("passes on the remote's refusal", async () => {
    const refused = notice('git.remoteDenied', { remote: REMOTE })
    expect((await checkPlace(deps({}, {}, refused), clone())).notice).toEqual(refused)
  })

  it('takes the next name with the branch, then with a number, past a filled folder or one a project has', async () => {
    mkdirSync(join(own, 'storefront'))
    writeFileSync(join(own, 'storefront', 'x'), '')
    const taken = join(own, 'storefront-release-v0.2')
    const check = await checkPlace(deps({ projectOf: (folder) => (folder === taken ? 'OLD' : undefined) }), clone({ branch: 'release/v0.2' }))
    expect(check.place?.name).toBe('storefront-release-v0.2-2')
    expect(check.notice).toBeNull()
  })

  it('refuses a named folder that is filled, a bad name and a file', async () => {
    mkdirSync(join(own, 'mine'))
    writeFileSync(join(own, 'mine', 'x'), '')
    writeFileSync(join(own, 'file'), '')
    expect((await checkPlace(deps(), clone({ folder: 'mine' }))).notice).toEqual(expect.objectContaining({ code: 'wizard.folderFilled' }))
    expect((await checkPlace(deps(), clone({ folder: 'a/b' }))).notice).toEqual(expect.objectContaining({ code: 'wizard.folderName' }))
    expect((await checkPlace(deps(), clone({ folder: 'file' }))).notice).toEqual(expect.objectContaining({ code: 'wizard.folderIsFile' }))
  })

  it('takes "another folder" as a full path and refuses a relative one', async () => {
    const other = join(dir, 'elsewhere', 'shop')
    expect(await checkPlace(deps(), clone({ repo: other }))).toEqual(expect.objectContaining({ root: other, place: { dir: null, name: 'shop', state: 'free' }, notice: null }))
    expect((await checkPlace(deps(), clone({ repo: 'shop' }))).notice).toEqual(expect.objectContaining({ code: 'wizard.relativePath' }))
  })

  it('offers a clone of the same remote on the same branch that lies in the projects folder', async () => {
    const there = join(own, 'storefront')
    mkdirSync(there)
    writeFileSync(join(there, 'README.md'), '')
    const answers = {
      [`${there} rev-parse --show-toplevel`]: { code: 0, out: there },
      [`${there} config --get remote.origin.url`]: { code: 0, out: 'git@example.com:acme/storefront.git' },
      [`${there} symbolic-ref --short -q HEAD`]: { code: 0, out: 'main' },
    }
    const check = await checkPlace(deps({}, answers), clone())
    expect(check.place).toEqual(expect.objectContaining({ name: 'storefront-main', existing: there }))
  })

  it('gives a new repository a filled folder with what goes into its first commit, and refuses a repository already there', async () => {
    const draft = { ...base, source: 'new' as const, name: 'Shop' }
    mkdirSync(join(own, 'Shop'))
    writeFileSync(join(own, 'Shop', 'a.txt'), '1234')
    const filled = await checkPlace(deps(), { ...draft, folder: 'Shop' })
    expect(filled).toEqual(expect.objectContaining({ notice: null, place: { dir: own, name: 'Shop', state: 'filled', holds: { files: 1, bytes: 4, capped: false } } }))
    const repo = join(own, 'Shop')
    const answers = { [`${repo} rev-parse --show-toplevel`]: { code: 0, out: repo } }
    expect((await checkPlace(deps({}, answers), { ...draft, folder: 'Shop' })).notice).toEqual(expect.objectContaining({ code: 'wizard.alreadyRepo' }))
  })

  it('suggests a new repository a free name after the project, asking no remote', async () => {
    const made = deps()
    const check = await checkPlace(made, { ...base, source: 'new', name: '' })
    expect(check.place).toEqual({ dir: own, name: 'shop', state: 'free' })
    expect(made.asked).toEqual([])
  })

  it('lets a project without git take a filled folder, but not one another project has', async () => {
    mkdirSync(join(own, 'notes'))
    writeFileSync(join(own, 'notes', 'a.md'), '')
    const draft = { ...base, git: false, folder: 'notes' }
    expect((await checkPlace(deps(), draft)).notice).toBeNull()
    expect((await checkPlace(deps({ projectOf: () => 'OLD' }), draft)).notice).toEqual(expect.objectContaining({ code: 'wizard.folderTaken' }))
  })
})
