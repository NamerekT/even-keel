import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TaskAttachment } from '../tracker/card.js'
import type { TaskFile } from '../tracker/source.js'
import { attachmentLines, type FileSource } from './downloads.js'

let folder: string
let served: string[]
let bodies: Map<string, Buffer | 'fail' | 'gone'>

const dir = () => join(folder, '.temp', 'task-files', 'ABC-1')
const attachment = (file: string, name: string, size: number, more: Partial<TaskAttachment> = {}): TaskAttachment => ({ file, name, type: '', size, url: null, ...more })
async function* chunks(bytes: Buffer): AsyncIterable<Uint8Array> {
  yield bytes.subarray(0, 3)
  yield bytes.subarray(3)
}
const source: FileSource = {
  async file(id, file): Promise<TaskFile | null> {
    served.push(`${id}/${file}`)
    const body = bodies.get(file)
    if (body === undefined || body === 'gone') return null
    if (body === 'fail') throw new Error('storage down')
    return { type: '', size: file.startsWith('unsized') ? null : body.length, body: chunks(body) }
  },
}

beforeEach(() => {
  folder = join(mkdtempSync(join(tmpdir(), 'ek-downloads-')), 'work')
  mkdirSync(folder)
  served = []
  bodies = new Map()
})

describe('task_read files of a tracker that serves them (BTN-923)', () => {
  it('downloads a file into .temp/task-files/<KEY>/ by its name and gives the path', async () => {
    bodies.set('f1', Buffer.from('picture'))
    const lines = await attachmentLines('ABC-1', [attachment('f1', 'shot.png', 7)], source, folder, 1024)
    expect(lines).toEqual([`- shot.png (7 B) — ${join(dir(), 'shot.png')}`])
    expect(readFileSync(join(dir(), 'shot.png'), 'utf8')).toBe('picture')
    expect(readdirSync(dir())).toEqual(['shot.png'])
  })

  it('does not download again a file already there with the same size', async () => {
    bodies.set('f1', Buffer.from('picture'))
    await attachmentLines('ABC-1', [attachment('f1', 'shot.png', 7)], source, folder, 1024)
    const again = await attachmentLines('ABC-1', [attachment('f1', 'shot.png', 7)], source, folder, 1024)
    expect(served).toEqual(['ABC-1/f1'])
    expect(again).toEqual([`- shot.png (7 B) — ${join(dir(), 'shot.png')}`])
    writeFileSync(join(dir(), 'shot.png'), 'old')
    await attachmentLines('ABC-1', [attachment('f1', 'shot.png', 7)], source, folder, 1024)
    expect(served).toEqual(['ABC-1/f1', 'ABC-1/f1'])
    expect(readFileSync(join(dir(), 'shot.png'), 'utf8')).toBe('picture')
  })

  it('a file over the limit is named with its size and "too large", never downloaded', async () => {
    bodies.set('big', Buffer.alloc(4096))
    bodies.set('sized', Buffer.alloc(4096))
    bodies.set('unsized', Buffer.alloc(4096))
    const files = [attachment('big', 'video.mp4', 4096), attachment('sized', 'log.txt', 0), attachment('unsized', 'dump.bin', 0)]
    const lines = await attachmentLines('ABC-1', files, source, folder, 1024)
    expect(lines).toEqual(['- video.mp4 (4 KB) — too large', '- log.txt — too large', '- dump.bin — too large'])
    // The tracker's size refuses before a byte is read; a stream with no size is cut at the limit and its part removed.
    expect(served).toEqual(['ABC-1/sized', 'ABC-1/unsized'])
    expect(readdirSync(dir())).toEqual([])
  })

  it('a file only outsiders’ comments carry is neither listed nor downloaded (BTN-1122)', async () => {
    bodies.set('f1', Buffer.from('picture'))
    bodies.set('bad', Buffer.from('payload'))
    const lines = await attachmentLines('ABC-1', [attachment('f1', 'shot.png', 7), attachment('bad', 'run.sh', 7, { outsider: true })], source, folder, 1024)
    expect(lines).toEqual([`- shot.png (7 B) — ${join(dir(), 'shot.png')}`])
    expect(served).toEqual(['ABC-1/f1'])
  })

  it('with no working folder each file is "not downloaded", with no error', async () => {
    bodies.set('f1', Buffer.from('picture'))
    expect(await attachmentLines('ABC-1', [attachment('f1', 'shot.png', 7)], source, null, 1024)).toEqual(['- shot.png (7 B) — not downloaded'])
    expect(served).toEqual([])
  })

  it('a file that fails is "file unavailable" and the others still download', async () => {
    bodies.set('ok', Buffer.from('notes'))
    bodies.set('broken', 'fail')
    bodies.set('gone', 'gone')
    const lines = await attachmentLines('ABC-1', [attachment('broken', 'a.png', 3), attachment('gone', 'b.png', 3), attachment('ok', 'notes.txt', 5)], source, folder, 1024)
    expect(lines).toEqual(['- a.png (3 B) — file unavailable', '- b.png (3 B) — file unavailable', `- notes.txt (5 B) — ${join(dir(), 'notes.txt')}`])
    expect(readdirSync(dir())).toEqual(['notes.txt'])
  })

  it('two files of one name differ by the prefix of their file id', async () => {
    bodies.set('aaaaaaaa1111', Buffer.from('first'))
    bodies.set('bbbbbbbb2222', Buffer.from('second'))
    const lines = await attachmentLines('ABC-1', [attachment('aaaaaaaa1111', 'image.png', 5), attachment('bbbbbbbb2222', 'image.png', 6)], source, folder, 1024)
    expect(lines).toEqual([`- image.png (5 B) — ${join(dir(), 'aaaaaaaa-image.png')}`, `- image.png (6 B) — ${join(dir(), 'bbbbbbbb-image.png')}`])
    expect(readFileSync(join(dir(), 'bbbbbbbb-image.png'), 'utf8')).toBe('second')
  })

  it('a name never leaves the folder', async () => {
    bodies.set('f1', Buffer.from('x'))
    const lines = await attachmentLines('ABC-1', [attachment('f1', '../../evil.txt', 1)], source, folder, 1024)
    expect(lines).toEqual([`- ../../evil.txt (1 B) — ${join(dir(), '.._.._evil.txt')}`])
  })

  it('downloads distinct URLs of one file name into distinct paths', async () => {
    const urls = ['https://uploads.linear.app/org/first', 'https://uploads.linear.app/org/second']
    bodies.set(urls[0]!, Buffer.from('first'))
    bodies.set(urls[1]!, Buffer.from('second'))
    const lines = await attachmentLines('ABC-1', urls.map((url) => attachment(url, 'image.png', 0)), source, folder, 1024)
    const paths = lines.map((line) => line.split(' — ')[1]!)
    expect(new Set(paths).size).toBe(2)
    expect(paths.map((path) => readFileSync(path, 'utf8'))).toEqual(['first', 'second'])
  })

  it('a public file goes by its url, a built-in one by its path; a tracker without file downloads nothing', async () => {
    const lines = await attachmentLines(
      'ABC-1',
      [
        attachment('u', 'logo.png', 10, { url: 'https://example.com/logo.png' }),
        attachment('p', 'screen.png', 10, { path: '/files/abc' }),
        attachment('m', 'old.log', 1, { path: '/files/def', missing: true }),
        attachment('s', 'served.png', 10),
      ],
      {},
      folder,
      1024,
    )
    expect(lines).toEqual(['- logo.png (10 B) — https://example.com/logo.png', '- screen.png (10 B) — /files/abc', '- old.log (1 B) — file missing', '- served.png (10 B) — not downloaded'])
  })
})
