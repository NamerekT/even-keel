import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitFolderMarks, MARK_FILE, markFileOf, NO_MARKS } from './marks.js'

describe('the folder mark', () => {
  const folders: string[] = []
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  })

  const repo = (): string => {
    const folder = mkdtempSync(join(tmpdir(), 'ek-mark-'))
    folders.push(folder)
    mkdirSync(join(folder, '.git'))
    return folder
  }
  const marks = (machine: string, name = `${machine} name`) => new GitFolderMarks(() => ({ machine, name }))
  const markOf = (folder: string) => JSON.parse(readFileSync(join(folder, '.git', MARK_FILE), 'utf8'))

  it('marks a free folder as the machine\'s and takes it again when the mark is its own', async () => {
    const folder = repo()
    expect(await marks('m-1').claim(folder)).toBeUndefined()
    expect(markOf(folder)).toEqual({ machine: 'm-1', name: 'm-1 name' })
    expect(await marks('m-1', 'renamed').claim(folder)).toBeUndefined()
    expect(markOf(folder).name).toBe('renamed')
  })

  it('names the machine that holds the folder and leaves its mark', async () => {
    const folder = repo()
    await marks('m-1').claim(folder)
    expect(await marks('m-2').claim(folder)).toEqual({ machine: 'm-1', name: 'm-1 name' })
    expect(markOf(folder).machine).toBe('m-1')
  })

  it('takes over only the mark of the machine it was told to', async () => {
    const folder = repo()
    await marks('m-1').claim(folder)
    expect(await marks('m-2').claim(folder, 'm-3')).toEqual({ machine: 'm-1', name: 'm-1 name' })
    expect(await marks('m-2').claim(folder, 'm-1')).toBeUndefined()
    expect(markOf(folder).machine).toBe('m-2')
  })

  it('releases only its own marks', async () => {
    const mine = repo()
    const theirs = repo()
    await marks('m-1').claim(mine)
    await marks('m-2').claim(theirs)
    await marks('m-1').release([mine, theirs])
    expect(await marks('m-3').claim(mine)).toBeUndefined()
    expect(markOf(theirs).machine).toBe('m-2')
  })

  it('leaves a folder without git unmarked and free', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'ek-mark-'))
    folders.push(folder)
    expect(markFileOf(folder)).toBeUndefined()
    expect(await marks('m-1').claim(folder)).toBeUndefined()
    expect(await marks('m-2').claim(join(folder, 'missing'))).toBeUndefined()
  })

  it('puts the mark of a linked worktree into the repository\'s common folder', async () => {
    const main = repo()
    const linked = mkdtempSync(join(tmpdir(), 'ek-mark-'))
    folders.push(linked)
    const gitDir = join(main, '.git', 'worktrees', 'side')
    mkdirSync(gitDir, { recursive: true })
    writeFileSync(join(gitDir, 'commondir'), '../..\n')
    writeFileSync(join(linked, '.git'), `gitdir: ${gitDir}\n`)
    expect(markFileOf(linked)).toBe(join(main, '.git', MARK_FILE))
  })

  it('takes a mark it cannot read for nobody\'s', async () => {
    const folder = repo()
    writeFileSync(join(folder, '.git', MARK_FILE), 'not json')
    expect(await marks('m-1').claim(folder)).toBeUndefined()
    expect(markOf(folder).machine).toBe('m-1')
  })

  it('writes nothing in a test instance', async () => {
    const folder = repo()
    expect(await NO_MARKS.claim(folder)).toBeUndefined()
    expect(markFileOf(folder)).toBe(join(folder, '.git', MARK_FILE))
    expect(() => readFileSync(join(folder, '.git', MARK_FILE))).toThrow()
  })
})
