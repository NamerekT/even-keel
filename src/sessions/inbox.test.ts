import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { freeName, inboxImage, inboxName, saveInbox } from './inbox.js'

const dirs: string[] = []
const workdir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('inboxName', () => {
  it('drops folders and reserved characters', () => {
    expect(inboxName('../../etc/passwd')).toBe('passwd')
    expect(inboxName('C:\\a\\b:c?.png')).toBe('b_c_.png')
    expect(inboxName(' .. ')).toBe('file')
  })

  it('keeps the extension of a long name', () => {
    const name = inboxName(`${'x'.repeat(300)}.png`)
    expect(name.length).toBeLessThanOrEqual(120)
    expect(name.endsWith('.png')).toBe(true)
  })
})

describe('freeName', () => {
  it('numbers a taken name before its extension', () => {
    const taken = new Set(['a.png', 'a (2).png'])
    expect(freeName('a.png', (name) => taken.has(name))).toBe('a (3).png')
    expect(freeName('b.png', (name) => taken.has(name))).toBe('b.png')
  })
})

describe('saveInbox', () => {
  it('writes the files into an inbox that ignores itself', async () => {
    const dir = workdir()
    const paths = await saveInbox(dir, [
      { name: 'a.txt', data: Buffer.from('one') },
      { name: 'a.txt', data: Buffer.from('two') },
    ])
    expect(paths).toEqual([join(dir, '.temp', 'inbox', 'a.txt'), join(dir, '.temp', 'inbox', 'a (2).txt')])
    expect(readFileSync(paths[1]!, 'utf8')).toBe('two')
    expect(readFileSync(join(dir, '.temp', 'inbox', '.gitignore'), 'utf8')).toBe('*\n')
  })

  it('unpacks an archive into its own folder and keeps one that fails', async () => {
    const dir = workdir()
    const unpacked = await saveInbox(dir, [{ name: 'logs.zip', data: Buffer.from('zip') }], async () => {})
    expect(unpacked).toEqual([join(dir, '.temp', 'inbox', 'logs')])
    expect(existsSync(join(dir, '.temp', 'inbox', 'logs.zip'))).toBe(false)

    const kept = await saveInbox(dir, [{ name: 'logs.zip', data: Buffer.from('zip') }], async () => {
      throw new Error('bad archive')
    })
    expect(kept).toEqual([join(dir, '.temp', 'inbox', 'logs.zip')])
    expect(existsSync(join(dir, '.temp', 'inbox', 'logs (2)'))).toBe(false)
  })
})

describe('inboxImage', () => {
  const sent = [
    'C:\\repos\\example\\.temp\\inbox\\order.png',
    '/home/john/example/.temp/inbox/shot.JPG',
    'C:\\repos\\example\\notes.png',
    'C:\\repos\\example\\.temp\\inbox\\log.txt',
  ]

  it('finds a picture the session was sent in an inbox folder, by its name', () => {
    expect(inboxImage(sent, 'order.png')).toEqual({ path: sent[0], type: 'image/png' })
    expect(inboxImage(sent, 'shot.JPG')).toEqual({ path: sent[1], type: 'image/jpeg' })
  })

  it('refuses a file outside an inbox folder, one not sent and one that is not a picture', () => {
    expect(inboxImage(sent, 'notes.png')).toBeUndefined()
    expect(inboxImage(sent, 'other.png')).toBeUndefined()
    expect(inboxImage(sent, 'log.txt')).toBeUndefined()
  })
})
