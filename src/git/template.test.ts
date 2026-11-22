import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyRepository, retarget } from './template.fixture.js'

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function folder(): string {
  const made = mkdtempSync(join(tmpdir(), 'ek-git-template-'))
  folders.push(made)
  return made
}

describe('copyRepository', { timeout: 30_000 }, () => {
  it('builds the template once and gives each call a copy of its own', async () => {
    const name = `once-${process.pid}-${Date.now()}`
    let builds = 0
    const build = (path: string) => {
      builds++
      git(path, 'init', '-q', '--template=', '-b', 'main')
      writeFileSync(join(path, 'a.txt'), 'a')
      git(path, 'add', 'a.txt')
      git(path, '-c', 'user.name=John Doe', '-c', 'user.email=john@example.com', 'commit', '-q', '-m', 'a')
    }
    const [first, second] = [folder(), folder()]
    await Promise.all([copyRepository(name, first, build), copyRepository(name, second, build)])
    expect(builds).toBe(1)
    writeFileSync(join(first, 'b.txt'), 'b')
    expect(git(first, 'status', '--porcelain')).toBe('?? b.txt')
    expect(git(second, 'status', '--porcelain')).toBe('')
    expect(git(second, 'log', '--format=%s')).toBe('a')
  })

  it('points the paths in the copy’s git configs at the copy', async () => {
    const name = `paths-${process.pid}-${Date.now()}`
    const destination = folder()
    await copyRepository(name, destination, (path) => {
      git(path, 'init', '-q', '--bare', '-b', 'main', join(path, 'remote.git'))
      execFileSync('git', ['clone', '-q', join(path, 'remote.git'), join(path, 'clone')], { stdio: 'ignore' })
      git(join(path, 'clone'), 'config', 'core.hooksPath', join(path, 'no-hooks'))
    })
    const clone = join(destination, 'clone')
    expect(git(clone, 'config', 'remote.origin.url')).toBe(join(destination, 'remote.git'))
    expect(git(clone, 'config', 'core.hooksPath')).toBe(join(destination, 'no-hooks'))
  })

  it('fails when the build fails and builds again on the next call', async () => {
    const name = `fails-${process.pid}-${Date.now()}`
    await expect(copyRepository(name, folder(), () => Promise.reject(new Error('broken')))).rejects.toThrow('broken')
    const destination = folder()
    await copyRepository(name, destination, (path) => writeFileSync(join(path, 'made.txt'), 'made'))
    expect(existsSync(join(destination, 'made.txt'))).toBe(true)
  })
})

describe('retarget', () => {
  it('replaces a folder written plain, with doubled backslashes and with forward slashes', () => {
    const text = ['url = C:\\\\t\\\\a\\\\remote.git', 'hooksPath = C:/t/a/hooks', 'path = C:\\t\\a\\x', 'other = C:\\t\\ab'].join('\n')
    expect(retarget(text, 'C:\\t\\a', 'D:\\n\\b').split('\n')).toEqual([
      'url = D:\\\\n\\\\b\\\\remote.git',
      'hooksPath = D:/n/b/hooks',
      'path = D:\\n\\b\\x',
      'other = C:\\t\\ab',
    ])
  })

  it('reads a config written by git itself', () => {
    const path = folder()
    git(path, 'init', '-q', '--template=')
    git(path, 'config', 'core.hooksPath', join(path, 'no-hooks'))
    const moved = join(tmpdir(), 'elsewhere')
    expect(retarget(readFileSync(join(path, '.git', 'config'), 'utf8'), path, moved)).toContain(JSON.stringify(join(moved, 'no-hooks')).slice(1, -1))
  })
})
