import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGit } from '../git/run.js'
import { readProjectSettings } from './projectSettings.js'

// Each test spawns several git processes; under a full `npm test` that is past vitest's default 5 s (BTN-1172).
describe('readProjectSettings', { timeout: 30_000 }, () => {
  let repo: string
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'project-settings-'))
    mkdirSync(join(repo, '.claude'))
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  const git = async (...args: string[]) => {
    const result = await runGit(repo, args)
    if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed (${result.code}): ${result.out}`)
  }
  const commit = async () => {
    await git('add', '-A')
    await git('-c', 'user.name=John Doe', '-c', 'user.email=john@example.com', 'commit', '-qm', 'files')
  }
  const write = (file: string, value: unknown) => writeFileSync(join(repo, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2))
  const read = (plain = false) => readProjectSettings(runGit, repo, 'trunk', plain)

  it("reads the branch's version, not the main checkout's edits", async () => {
    await git('init', '-q', '-b', 'trunk')
    write('.claude/settings.json', { permissions: { deny: ['WebFetch'] } })
    await commit()
    write('.claude/settings.json', { permissions: { deny: ['WebFetch', 'Bash(rm:*)'] } })
    write('.claude/settings.local.json', { permissions: { allow: ['Read'] } })
    expect(await read()).toEqual({
      project: { permissions: { deny: ['WebFetch'] } },
      local: { permissions: { allow: ['Read'] } },
      drift: 'edited',
    })
  })

  it('has no drift when the disk holds the same settings, whatever the line endings', async () => {
    await git('init', '-q', '-b', 'trunk')
    write('.claude/settings.json', '{\n  "model": "opus"\n}\n')
    await commit()
    write('.claude/settings.json', '{\r\n  "model": "opus"\r\n}\r\n')
    expect(await read()).toEqual({ project: { model: 'opus' }, local: undefined })
  })

  it('says the file is ignored when .gitignore keeps it off the branch', async () => {
    await git('init', '-q', '-b', 'trunk')
    write('.gitignore', '.claude/settings.json\n')
    await commit()
    write('.claude/settings.json', { model: 'opus' })
    expect(await read()).toEqual({ project: undefined, local: undefined, drift: 'ignored' })
  })

  it('says the file is not committed when nothing ignores it', async () => {
    await git('init', '-q', '-b', 'trunk')
    write('README.md', 'readme')
    await commit()
    write('.claude/settings.json', { model: 'opus' })
    expect(await read()).toEqual({ project: undefined, local: undefined, drift: 'uncommitted' })
  })

  it('has no drift when neither the branch nor the disk has the file', async () => {
    await git('init', '-q', '-b', 'trunk')
    write('README.md', 'readme')
    await commit()
    expect(await read()).toEqual({ project: undefined, local: undefined })
  })

  it('reports nothing it cannot know when git cannot read the branch', async () => {
    write('.claude/settings.json', { model: 'opus' })
    const broken = async () => ({ code: 128, out: 'not a git repository' })
    expect(await readProjectSettings(broken, repo, 'trunk', false)).toEqual({ project: undefined, local: undefined })
  })

  it('reads the folder of a project without git, where its sessions run', async () => {
    write('.claude/settings.json', { model: 'opus' })
    write('.claude/settings.local.json', { model: 'haiku' })
    const untouched = async () => {
      throw new Error('a project without git is not asked')
    }
    expect(await readProjectSettings(untouched, repo, 'trunk', true)).toEqual({ project: { model: 'opus' }, local: { model: 'haiku' } })
  })
})
