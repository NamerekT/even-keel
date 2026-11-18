import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { englishOf } from '../notice/notice.js'
import { finishSlot } from './slot.js'
import { cleanSlot, DEFAULT_SLOT_CLEANUP, type CleanIo } from './slot-clean.js'
import type { GitResult } from './types.js'

let root: string
let repo: string
let slot: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'slot-clean-'))
  repo = join(root, 'repo')
  slot = join(repo, '.claude', 'worktrees', 'even-keel')
  await mkdir(slot, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function put(path: string, text = 'x'): Promise<void> {
  await mkdir(dirname(join(slot, path)), { recursive: true })
  await writeFile(join(slot, path), text)
}

const here = (path: string) => existsSync(join(slot, path))

function fakeGit(ignored: string[], tracked: string[] = []) {
  const calls: string[] = []
  const git = async (cwd: string, args: string[]): Promise<GitResult> => {
    calls.push(`${cwd === slot ? '@slot ' : ''}${args.join(' ')}`)
    if (args.join(' ') === 'status --porcelain -z --ignored') return { code: 0, out: ignored.map((path) => `!! ${path}\0`).join('') }
    if (args.join(' ') === 'ls-files -z') return { code: 0, out: tracked.map((path) => `${path}\0`).join('') }
    return { code: 0, out: '' }
  }
  return { git, calls }
}

describe('finishSlot cleans the slot’s temporary files (BTN-1315)', () => {
  const listing = (branch: string) => ({
    code: 0,
    out: [`worktree ${repo.replaceAll('\\', '/')}\nHEAD 1\nbranch refs/heads/main`, `worktree ${slot.replaceAll('\\', '/')}\nHEAD 1\nbranch refs/heads/${branch}`].join('\n\n'),
  })

  function finishGit(dirty = '') {
    const calls: string[] = []
    const git = async (cwd: string, args: string[]): Promise<GitResult> => {
      const command = `${cwd === slot ? '@slot ' : ''}${args.join(' ')}`
      calls.push(command)
      if (command === 'worktree list --porcelain') return listing('abc-7/task')
      if (command === '@slot status --porcelain') return { code: 0, out: dirty }
      if (command === '@slot status --porcelain -z --ignored') return { code: 0, out: '!! .temp/\0' }
      return { code: 0, out: '' }
    }
    return { git, calls }
  }

  it('after the switch to main and the branch’s deletion, empties .temp and says what it freed', async () => {
    await put('.temp/record/frame.png', '1234')
    const { git, calls } = finishGit()
    const outcome = await finishSlot(git, repo, 'ABC-7')
    expect(outcome.freed).toEqual({ slot, bytes: 4, files: 1 })
    expect(await readdir(join(slot, '.temp'))).toEqual([])
    expect(calls.indexOf('branch -d abc-7/task')).toBeLessThan(calls.indexOf('@slot status --porcelain -z --ignored'))
  })

  it('leaves .temp of a slot kept on the branch', async () => {
    await put('.temp/a.log')
    const { git } = finishGit('?? notes.md')
    const outcome = await finishSlot(git, repo, 'ABC-7')
    expect(outcome.freed).toBeUndefined()
    expect(here('.temp/a.log')).toBe(true)
  })

  it('takes the project’s patterns', async () => {
    await put('.temp/a.log')
    const { git } = finishGit()
    expect((await finishSlot(git, repo, 'ABC-7', 1, 'main', {}, { clean: [], keep: [] })).freed).toBeUndefined()
    expect(here('.temp/a.log')).toBe(true)
  })
})

describe('cleanSlot (BTN-1315)', () => {
  it('empties .temp but leaves the folder, counting what it freed', async () => {
    await put('.temp/record/run-1/frame.png', '12345')
    await put('.temp/a.log', '123')
    await put('Library/cache.bin', 'keep me')
    const { git } = fakeGit(['.temp/', 'Library/'])
    const cleaned = await cleanSlot(git, repo, slot, 'ABC-7', DEFAULT_SLOT_CLEANUP)
    expect(cleaned).toEqual({ warnings: [], bytes: 8, files: 2 })
    expect(await readdir(join(slot, '.temp'))).toEqual([])
    expect(here('Library/cache.bin')).toBe(true)
  })

  it('does nothing when the folder is not there', async () => {
    const { git } = fakeGit([])
    expect(await cleanSlot(git, repo, slot, 'ABC-7', DEFAULT_SLOT_CLEANUP)).toEqual({ warnings: [], bytes: 0, files: 0 })
    expect(here('.temp')).toBe(false)
  })

  it('does nothing for a slot folder that is gone', async () => {
    const { git, calls } = fakeGit([])
    await rm(slot, { recursive: true })
    expect(await cleanSlot(git, repo, slot, 'ABC-7', DEFAULT_SLOT_CLEANUP)).toEqual({ warnings: [], bytes: 0, files: 0 })
    expect(calls).toEqual([])
  })

  it('never touches a tracked folder, and warns', async () => {
    await put('.temp/notes.txt')
    const { git } = fakeGit([], ['.temp/notes.txt'])
    const cleaned = await cleanSlot(git, repo, slot, 'ABC-7', DEFAULT_SLOT_CLEANUP)
    expect(cleaned.files).toBe(0)
    expect(cleaned.warnings.map(englishOf)).toEqual([expect.stringMatching(/1 tracked file[\s\S]*\.temp\/notes\.txt/)])
    expect(here('.temp/notes.txt')).toBe(true)
  })

  it('keeps what matches keep, and the folders that hold it', async () => {
    await put('.temp/notes/plan.txt')
    await put('.temp/probe/readme.md')
    await put('.temp/probe/dump.bin')
    const { git } = fakeGit(['.temp/'])
    const cleaned = await cleanSlot(git, repo, slot, 'ABC-7', { clean: ['.temp/**'], keep: ['.temp/notes/', '.temp/**/*.md'] })
    expect(cleaned.files).toBe(1)
    expect(here('.temp/notes/plan.txt')).toBe(true)
    expect(here('.temp/probe/readme.md')).toBe(true)
    expect(here('.temp/probe/dump.bin')).toBe(false)
  })

  it('removes a link inside as a link, never going into its target', async () => {
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'precious.txt'), 'x')
    await mkdir(join(slot, '.temp'), { recursive: true })
    await symlink(outside, join(slot, '.temp', 'link'), 'junction')
    const { git } = fakeGit(['.temp/'])
    await cleanSlot(git, repo, slot, 'ABC-7', DEFAULT_SLOT_CLEANUP)
    expect(here('.temp/link')).toBe(false)
    expect(existsSync(join(outside, 'precious.txt'))).toBe(true)
  })

  it('goes on past a busy file, warning with the count left', async () => {
    await put('.temp/held.bin')
    await put('.temp/free.bin')
    const io: CleanIo = {
      unlink: async (path) => {
        if (path.endsWith('held.bin')) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
        return unlink(path)
      },
    }
    const { git } = fakeGit(['.temp/'])
    const cleaned = await cleanSlot(git, repo, slot, 'ABC-7', DEFAULT_SLOT_CLEANUP, io)
    expect(cleaned.files).toBe(1)
    expect(cleaned.warnings.map(englishOf)).toEqual([expect.stringMatching(/1 file[\s\S]*held/)])
    expect(here('.temp/held.bin')).toBe(true)
    expect(here('.temp/free.bin')).toBe(false)
  })

  it('cleans nothing by patterns with an empty list', async () => {
    await put('.temp/a.log')
    const { git, calls } = fakeGit(['.temp/'])
    expect(await cleanSlot(git, repo, slot, 'ABC-7', { clean: [], keep: [] })).toEqual({ warnings: [], bytes: 0, files: 0 })
    expect(here('.temp/a.log')).toBe(true)
    expect(calls).not.toContain('@slot ls-files -z')
  })

  it('removes the closed task’s attachments whatever the patterns say, and leaves the other tasks’', async () => {
    await put('.temp/task-files/abc-7/shot.png', '12')
    await put('.temp/task-files/ABC-8/shot.png')
    const { git } = fakeGit(['.temp/'])
    const cleaned = await cleanSlot(git, repo, slot, 'ABC-7', { clean: [], keep: [] })
    expect(cleaned).toEqual({ warnings: [], bytes: 2, files: 1 })
    expect(here('.temp/task-files/abc-7')).toBe(false)
    expect(here('.temp/task-files/ABC-8/shot.png')).toBe(true)
  })

  it('leaves the other tasks’ attachments under the default patterns too', async () => {
    await put('.temp/task-files/ABC-8/shot.png')
    await put('.temp/x.log')
    const { git } = fakeGit(['.temp/'])
    await cleanSlot(git, repo, slot, 'ABC-7', DEFAULT_SLOT_CLEANUP)
    expect(here('.temp/task-files/ABC-8/shot.png')).toBe(true)
    expect(here('.temp/x.log')).toBe(false)
  })
})
