import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Git } from '../git/types.js'
import type { Forge } from './model.js'
import { openPull } from './open.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof fs>()
  return { ...original, open: vi.fn(original.open) }
})

const LIMIT = 65_536
let base: string
let folder: string
let outside: string
let git: ReturnType<typeof vi.fn<Git>>
let forge: Forge

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ek-pull-note-'))
  folder = join(base, 'task')
  outside = join(base, 'task-other')
  mkdirSync(join(folder, '.temp'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(folder, '.temp', 'pull.md'), 'Title\n\nBody')
  writeFileSync(join(outside, 'pull.md'), 'Outside\n\nPrivate text')
  git = vi.fn(async (_cwd, args) => ({ code: 0, out: args[0] === 'symbolic-ref' ? 'abc-7/task' : args[0] === 'rev-list' ? '1' : '' }))
  forge = {
    kind: 'github',
    find: vi.fn(async () => null),
    create: vi.fn(async () => ({ number: 3, url: 'https://github.com/example/app/pull/3' })),
    state: vi.fn(),
    changes: vi.fn(),
  }
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(base, { recursive: true, force: true })
})

const opening = (note: string, cwd = folder) => openPull(git, cwd, note, 'origin', forge, 'trunk', () => new Date('2026-11-14T00:00:00Z'))
const refused = async (note: string, reason: string) => {
  await expect(opening(note)).rejects.toMatchObject({ notice: { code: 'review.noNote', params: { reason } } })
  expect(git.mock.calls.some(([, args]) => args[0] === 'push')).toBe(false)
  expect(forge.find).not.toHaveBeenCalled()
  expect(forge.create).not.toHaveBeenCalled()
}

describe('PR description files', () => {
  it.each(['.temp/pull.md', 'absolute'])('reads an internal note by %s path', async (path) => {
    await opening(path === 'absolute' ? join(folder, '.temp', 'pull.md') : path)
    expect(forge.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Title', body: 'Body' }))
  })

  it('refuses absolute and parent paths into a sibling with the same folder prefix', async () => {
    await refused(join(outside, 'pull.md'), 'outside')
    await refused('../task-other/pull.md', 'outside')
  })

  it('refuses a junction out of the task folder', async () => {
    symlinkSync(outside, join(folder, 'link'), 'junction')
    await refused('link/pull.md', 'outside')
  })

  it('allows internal junctions and a task folder reached through a junction', async () => {
    symlinkSync(join(folder, '.temp'), join(folder, 'link'), 'junction')
    symlinkSync(folder, join(base, 'alias'), 'junction')
    await opening('link/pull.md')
    await opening('.temp/pull.md', join(base, 'alias'))
    expect(forge.create).toHaveBeenCalledTimes(2)
  })

  it.each(['.env', '.env.local', '.ENV.production', '.git/config'])('refuses secret path %s', async (path) => {
    mkdirSync(join(folder, '.git'), { recursive: true })
    writeFileSync(join(folder, path), 'Private title\nPrivate body')
    await refused(path, 'secret')
  })

  it('refuses a worktree .git file and allows .env.example', async () => {
    writeFileSync(join(folder, '.git'), 'gitdir: elsewhere')
    await refused('.git', 'secret')
    writeFileSync(join(folder, '.env.example'), 'Example\n\nFake values')
    await opening('.env.example')
    expect(forge.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Example' }))
  })

  it('checks both a junction target and the named path for .git', async () => {
    mkdirSync(join(folder, '.git'))
    writeFileSync(join(folder, '.git', 'pull.md'), 'Private')
    symlinkSync(join(folder, '.git'), join(folder, 'alias'), 'junction')
    await refused('alias/pull.md', 'secret')
    rmSync(join(folder, 'alias'))
    rmSync(join(folder, '.git'), { recursive: true })
    symlinkSync(join(folder, '.temp'), join(folder, '.git'), 'junction')
    await refused('.git/pull.md', 'secret')
  })

  it('refuses missing files, directories and blank descriptions', async () => {
    await refused('missing.md', 'missing')
    await refused('.temp', 'notFile')
    writeFileSync(join(folder, 'blank.md'), ' \r\n\t')
    await refused('blank.md', 'empty')
  })

  it('accepts exactly 64 KiB and refuses one more byte without publishing a prefix', async () => {
    writeFileSync(join(folder, 'limit.md'), `Title\n${'a'.repeat(LIMIT - 6)}`)
    await opening('limit.md')
    expect(forge.create).toHaveBeenCalledOnce()
    vi.clearAllMocks()
    writeFileSync(join(folder, 'limit.md'), `Title\n${'a'.repeat(LIMIT - 5)}`)
    await refused('limit.md', 'tooLarge')
  })

  it('limits UTF-8 bytes rather than characters', async () => {
    writeFileSync(join(folder, 'wide.md'), `Title\n${'é'.repeat(LIMIT / 2)}`)
    await refused('wide.md', 'tooLarge')
  })

  it('refuses a file growing after its size check without publishing its prefix', async () => {
    const realOpen = (await vi.importActual<typeof fs>('node:fs/promises')).open
    vi.spyOn(fs, 'open').mockImplementationOnce(async (path, flags, mode) => {
      const file = await realOpen(path, flags, mode)
      const read = file.read.bind(file)
      vi.spyOn(file, 'read').mockImplementationOnce(async (...args) => {
        appendFileSync(join(folder, '.temp', 'pull.md'), 'x'.repeat(LIMIT))
        return read(...args)
      })
      return file
    })
    await refused('.temp/pull.md', 'tooLarge')
  })

  it('reports an unreadable note without publishing the filesystem error', async () => {
    vi.spyOn(fs, 'open').mockRejectedValueOnce(Object.assign(new Error('private OS error'), { code: 'EACCES' }))
    await refused('.temp/pull.md', 'unreadable')
  })

  it('refuses a missing task folder', async () => {
    await expect(opening(join(folder, '.temp', 'pull.md'), join(base, 'missing'))).rejects.toMatchObject({
      notice: { code: 'review.noNote', params: { reason: 'missing' } },
    })
    expect(forge.create).not.toHaveBeenCalled()
  })

  it('reads a corrected note on the next attempt', async () => {
    await refused('new.md', 'missing')
    writeFileSync(join(folder, 'new.md'), 'Corrected\n\nSafe body')
    await opening('new.md')
    expect(forge.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Corrected', body: 'Safe body' }))
  })
})
