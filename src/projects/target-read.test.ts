import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGit } from '../git/run.js'
import type { Git } from '../git/types.js'
import type { ProjectDraft } from '../state.js'
import { readTarget, type TargetDeps } from './target-read.js'

const base: ProjectDraft = { repo: '', branch: '', key: 'APP', name: '', tracker: 'fake', trackerProject: '', profile: null, slot: 0, milestones: [], provider: null }
const typed = (target: string, fields: Partial<ProjectDraft> = {}): ProjectDraft => ({ ...base, target, ...fields })

let dir: string
let own: string

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'target-')))
  own = join(dir, 'projects')
  mkdirSync(own)
})

afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))

/** Real git for the folders, with a name and an e-mail unless `anonymous`; the asked commands are kept. */
function deps(fields: Partial<TargetDeps> = {}, options: { anonymous?: boolean } = {}): TargetDeps & { asked: string[] } {
  const asked: string[] = []
  const git: Git = async (cwd, args) => {
    asked.push(args.join(' '))
    if (args[0] === 'config' && args[1] === '--get' && args[2]?.startsWith('user.')) return options.anonymous ? { code: 1, out: '' } : { code: 0, out: 'John Doe' }
    return runGit(cwd, args)
  }
  return {
    git,
    platform: process.platform,
    folders: { home: join(dir, 'home'), isFolder: (path) => existsSync(path) && !existsSync(join(path, '.is-file')) },
    ownDir: own,
    projectOf: () => undefined,
    asked,
    ...fields,
  }
}

async function repoAt(path: string, remote?: string): Promise<void> {
  mkdirSync(path, { recursive: true })
  await runGit(path, ['init', '-q', '-b', 'main'])
  if (remote !== undefined) await runGit(path, ['remote', 'add', 'origin', remote])
}

describe('readTarget', () => {
  it('leaves a blank field unread and unrefused', async () => {
    expect(await readTarget(deps(), typed(''))).toEqual({ draft: null, read: null, notice: null })
  })

  it('refuses a text that is neither, without asking git', async () => {
    const asked = deps()
    const read = await readTarget(asked, typed('please clone my app'))
    expect(read.notice).toMatchObject({ code: 'wizard.notTarget' })
    expect(asked.asked).toEqual([])
  })

  it('reads an address as a clone that keeps its own folder fields', async () => {
    const read = await readTarget(deps(), typed(' git@github.com:me/app.git ', { folder: 'shop', repo: '' }))
    expect(read.read).toEqual({ as: 'clone', host: 'github.com' })
    expect(read.draft).toMatchObject({ source: 'clone', remote: 'git@github.com:me/app.git', folder: 'shop', repo: '' })
    expect(read.draft).not.toHaveProperty('target')
  })

  it('reads the top of a repository as the checkout already there, with its remote', async () => {
    const app = join(dir, 'app')
    await repoAt(app, 'https://jane:secret@example.com/me/app.git')
    const read = await readTarget(deps(), typed(app))
    expect(read.read).toEqual({ as: 'existing', remote: { name: 'origin', url: 'https://example.com/me/app.git' } })
    expect(read.draft).toMatchObject({ source: 'existing', repo: app })
  })

  it('takes a repository without a remote, and says so', async () => {
    const app = join(dir, 'app')
    await repoAt(app)
    expect((await readTarget(deps(), typed(`${app}/`))).read).toEqual({ as: 'existing', remote: null })
  })

  it("offers the top of the repository a subfolder lies in", async () => {
    const app = join(dir, 'app')
    await repoAt(app)
    mkdirSync(join(app, 'src'))
    const read = await readTarget(deps(), typed(join(app, 'src')))
    expect(read.notice).toMatchObject({ code: 'wizard.insideRepo', params: { path: join(app, 'src'), root: app } })
  })

  it('makes a folder without git a new repository in place', async () => {
    const notes = join(dir, 'notes')
    mkdirSync(notes)
    writeFileSync(join(notes, 'a.txt'), 'a')
    const read = await readTarget(deps(), typed(notes, { folder: 'left-over' }))
    expect(read.read).toEqual({ as: 'here' })
    expect(read.draft).toMatchObject({ source: 'new', repo: notes })
    expect(read.draft).not.toHaveProperty('folder')
  })

  it('makes a path that is not there with a new repository', async () => {
    const path = join(dir, 'later', 'app')
    const read = await readTarget(deps(), typed(path))
    expect(read.read).toEqual({ as: 'make' })
    expect(read.draft).toMatchObject({ source: 'new', repo: path })
  })

  it("puts a bare name into the projects folder, numbered past a folder or a project that has it", async () => {
    expect((await readTarget(deps(), typed('my-app'))).draft).toMatchObject({ source: 'new', repo: '', folder: 'my-app' })
    mkdirSync(join(own, 'my-app'))
    writeFileSync(join(own, 'my-app', 'a.txt'), 'a')
    const taken = deps({ projectOf: (folder) => (folder === join(own, 'my-app-2') ? 'OTHER' : undefined) })
    const read = await readTarget(taken, typed('my-app'))
    expect(read.read).toEqual({ as: 'name' })
    expect(read.draft).toMatchObject({ folder: 'my-app-3' })
  })

  it('asks the disk whether a name is free, so a case-insensitive disk takes My-App for my-app', async () => {
    mkdirSync(join(own, 'My-App'))
    writeFileSync(join(own, 'My-App', 'a.txt'), 'a')
    const insensitive = existsSync(join(own, 'my-app'))
    expect((await readTarget(deps(), typed('my-app'))).draft).toMatchObject({ folder: insensitive ? 'my-app-2' : 'my-app' })
  })

  it('refuses a relative path with an example of a full one for the platform', async () => {
    const read = await readTarget(deps({ platform: 'linux' }), typed('./my-app'))
    expect(read.notice).toMatchObject({ code: 'wizard.fullPath', params: { path: './my-app', example: '/home/me/projects/my-app' } })
    const windows = await readTarget(deps({ platform: 'win32' }), typed('src\\app'))
    expect(windows.notice).toMatchObject({ code: 'wizard.fullPath', params: { example: 'C:\\Projects\\my-app' } })
  })

  it('refuses a whole disk and the home folder', async () => {
    expect((await readTarget(deps({ platform: 'linux' }), typed('/'))).notice).toMatchObject({ code: 'wizard.rootFolder' })
    expect((await readTarget(deps({ platform: 'win32' }), typed('C:\\'))).notice).toMatchObject({ code: 'wizard.rootFolder' })
    expect((await readTarget(deps(), typed('~'))).notice).toMatchObject({ code: 'wizard.rootFolder' })
  })

  it("refuses a name or a path Windows cannot make, and only a slash on the others", async () => {
    expect((await readTarget(deps({ platform: 'win32' }), typed('CON'))).notice).toMatchObject({ code: 'wizard.reservedName' })
    expect((await readTarget(deps({ platform: 'win32' }), typed('C:\\Projects\\a?b'))).notice).toMatchObject({ code: 'wizard.folderName' })
    expect((await readTarget(deps({ platform: 'linux' }), typed('a?b'))).read).toEqual({ as: 'name' })
  })

  it('refuses a clone or a new repository while git has no name and e-mail, the way being read', async () => {
    const read = await readTarget(deps({}, { anonymous: true }), typed('https://example.com/me/app.git'))
    expect(read).toMatchObject({ draft: null, read: { as: 'clone' }, notice: { code: 'git.noIdentity' } })
    expect((await readTarget(deps({}, { anonymous: true }), typed('my-app'))).notice).toMatchObject({ code: 'git.noIdentity' })
  })
})
