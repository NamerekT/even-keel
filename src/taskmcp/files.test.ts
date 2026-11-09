import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readUploads } from './files.js'

let base: string
let folder: string
let outside: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ek-uploads-'))
  folder = join(base, 'worktree')
  outside = join(base, 'elsewhere')
  mkdirSync(join(folder, '.temp'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(folder, '.temp', 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  writeFileSync(join(folder, 'notes.md'), '# Notes')
  writeFileSync(join(outside, 'secret.txt'), 'key')
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

const refusal = async (paths: string[], limit = 1024): Promise<string> => {
  try {
    await readUploads(paths, folder, limit)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('no refusal')
}

describe('readUploads', () => {
  it('reads files of the working folder by a relative or an absolute path, with their type', async () => {
    const files = await readUploads(['.temp/shot.png', join(folder, 'notes.md')], folder, 1024)
    expect(files.map(({ name, type, bytes }) => ({ name, type, size: bytes.length }))).toEqual([
      { name: 'shot.png', type: 'image/png', size: 8 },
      { name: 'notes.md', type: 'text/markdown', size: 7 },
    ])
  })

  it('refuses a file outside the working folder, through .. too', async () => {
    expect(await refusal([join(outside, 'secret.txt')])).toMatch(/is outside the working folder/)
    expect(await refusal(['../elsewhere/secret.txt'])).toMatch(/is outside the working folder/)
  })

  it('refuses a file reached through a link out of the working folder', async () => {
    symlinkSync(outside, join(folder, 'link'), 'junction')
    expect(await refusal(['link/secret.txt'])).toMatch(/is outside the working folder/)
  })

  it('refuses .env files and anything under .git, but not .env.example', async () => {
    writeFileSync(join(folder, '.env'), 'TOKEN=1')
    writeFileSync(join(folder, '.env.local'), 'TOKEN=1')
    writeFileSync(join(folder, '.env.example'), 'TOKEN=')
    mkdirSync(join(folder, '.git'))
    writeFileSync(join(folder, '.git', 'config'), '[core]')
    expect(await refusal(['.env'])).toMatch(/never leave the machine/)
    expect(await refusal(['.env.local'])).toMatch(/never leave the machine/)
    expect(await refusal(['.git/config'])).toMatch(/never leave the machine/)
    expect((await readUploads(['.env.example'], folder, 1024))[0]!.name).toBe('.env.example')
  })

  it('refuses a missing file, a folder, a file past the limit and an empty list item', async () => {
    expect(await refusal(['nothing.txt'])).toMatch(/"nothing.txt": no such file/)
    expect(await refusal(['.temp'])).toMatch(/is not a file/)
    expect(await refusal(['notes.md'], 3)).toMatch(/"notes.md" is 7 B, more than the attachment limit/)
    expect(await refusal([' '])).toMatch(/empty path/)
  })
})
