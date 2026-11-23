import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TaskAttachment } from '../tracker/card.js'
import type { TaskFile } from '../tracker/source.js'
import { attachmentLines, folderSink, withBriefCopies, type FileSource } from './downloads.js'

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
    const lines = await attachmentLines('ABC-1', [attachment('f1', 'shot.png', 7)], source, folderSink(folder), 1024)
    expect(lines).toEqual([`- shot.png (7 B) — ${join(dir(), 'shot.png')}`])
    expect(readFileSync(join(dir(), 'shot.png'), 'utf8')).toBe('picture')
    expect(readdirSync(dir())).toEqual(['shot.png'])
  })

  it('does not download again a file already there with the same size', async () => {
    bodies.set('f1', Buffer.from('picture'))
    await attachmentLines('ABC-1', [attachment('f1', 'shot.png', 7)], source, folderSink(folder), 1024)
    const again = await attachmentLines('ABC-1', [attachment('f1', 'shot.png', 7)], source, folderSink(folder), 1024)
    expect(served).toEqual(['ABC-1/f1'])
    expect(again).toEqual([`- shot.png (7 B) — ${join(dir(), 'shot.png')}`])
    writeFileSync(join(dir(), 'shot.png'), 'old')
    await attachmentLines('ABC-1', [attachment('f1', 'shot.png', 7)], source, folderSink(folder), 1024)
    expect(served).toEqual(['ABC-1/f1', 'ABC-1/f1'])
    expect(readFileSync(join(dir(), 'shot.png'), 'utf8')).toBe('picture')
  })

  it('a file over the limit is named with its size and "too large", never downloaded', async () => {
    bodies.set('big', Buffer.alloc(4096))
    bodies.set('sized', Buffer.alloc(4096))
    bodies.set('unsized', Buffer.alloc(4096))
    const files = [attachment('big', 'video.mp4', 4096), attachment('sized', 'log.txt', 0), attachment('unsized', 'dump.bin', 0)]
    const lines = await attachmentLines('ABC-1', files, source, folderSink(folder), 1024)
    expect(lines).toEqual(['- video.mp4 (4 KB) — too large', '- log.txt — too large', '- dump.bin — too large'])
    // The tracker's size refuses before a byte is read; a stream with no size is cut at the limit and its part removed.
    expect(served).toEqual(['ABC-1/sized', 'ABC-1/unsized'])
    expect(existsSync(dir())).toBe(false)
  })

  it('a file only outsiders’ comments carry is neither listed nor downloaded (BTN-1122)', async () => {
    bodies.set('f1', Buffer.from('picture'))
    bodies.set('bad', Buffer.from('payload'))
    const lines = await attachmentLines('ABC-1', [attachment('f1', 'shot.png', 7), attachment('bad', 'run.sh', 7, { outsider: true })], source, folderSink(folder), 1024)
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
    const lines = await attachmentLines('ABC-1', [attachment('broken', 'a.png', 3), attachment('gone', 'b.png', 3), attachment('ok', 'notes.txt', 5)], source, folderSink(folder), 1024)
    expect(lines).toEqual(['- a.png (3 B) — file unavailable', '- b.png (3 B) — file unavailable', `- notes.txt (5 B) — ${join(dir(), 'notes.txt')}`])
    expect(readdirSync(dir())).toEqual(['notes.txt'])
  })

  it('an empty body is "file unavailable", never a copy, and the next read downloads the file (BTN-1201)', async () => {
    bodies.set('unsized-1', Buffer.alloc(0))
    bodies.set('f2', Buffer.alloc(0))
    const files = [attachment('unsized-1', 'note.txt', 0), attachment('f2', 'shot.png', 0)]
    const lines = await attachmentLines('ABC-1', files, source, folderSink(folder), 1024)
    expect(lines).toEqual(['- note.txt — file unavailable', '- shot.png — file unavailable'])
    expect(existsSync(dir())).toBe(false)
    bodies.set('unsized-1', Buffer.from('notes'))
    const again = await attachmentLines('ABC-1', files.slice(0, 1), source, folderSink(folder), 1024)
    expect(again).toEqual([`- note.txt — ${join(dir(), 'note.txt')}`])
    expect(readFileSync(join(dir(), 'note.txt'), 'utf8')).toBe('notes')
  })

  it('two files of one name differ by the prefix of their file id', async () => {
    bodies.set('aaaaaaaa1111', Buffer.from('first'))
    bodies.set('bbbbbbbb2222', Buffer.from('second'))
    const lines = await attachmentLines('ABC-1', [attachment('aaaaaaaa1111', 'image.png', 5), attachment('bbbbbbbb2222', 'image.png', 6)], source, folderSink(folder), 1024)
    expect(lines).toEqual([`- image.png (5 B) — ${join(dir(), 'aaaaaaaa-image.png')}`, `- image.png (6 B) — ${join(dir(), 'bbbbbbbb-image.png')}`])
    expect(readFileSync(join(dir(), 'bbbbbbbb-image.png'), 'utf8')).toBe('second')
  })

  it('a name never leaves the folder', async () => {
    bodies.set('f1', Buffer.from('x'))
    const lines = await attachmentLines('ABC-1', [attachment('f1', '../../evil.txt', 1)], source, folderSink(folder), 1024)
    expect(lines).toEqual([`- ../../evil.txt (1 B) — ${join(dir(), '.._.._evil.txt')}`])
  })

  it('downloads distinct URLs of one file name into distinct paths', async () => {
    const urls = ['https://uploads.linear.app/org/first', 'https://uploads.linear.app/org/second']
    bodies.set(urls[0]!, Buffer.from('first'))
    bodies.set(urls[1]!, Buffer.from('second'))
    const lines = await attachmentLines('ABC-1', urls.map((url) => attachment(url, 'image.png', 0)), source, folderSink(folder), 1024)
    const paths = lines.map((line) => line.split(' — ')[1]!)
    expect(new Set(paths).size).toBe(2)
    expect(paths.map((path) => readFileSync(path, 'utf8'))).toEqual(['first', 'second'])
  })

  it('a public file goes by its url; a tracker without file downloads nothing', async () => {
    const lines = await attachmentLines(
      'ABC-1',
      [attachment('u', 'logo.png', 10, { url: 'https://example.com/logo.png' }), attachment('m', 'old.log', 1, { path: '/files/def', missing: true }), attachment('s', 'served.png', 10)],
      {},
      folderSink(folder),
      1024,
    )
    expect(lines).toEqual(['- logo.png (10 B) — https://example.com/logo.png', '- old.log (1 B) — file missing', '- served.png (10 B) — not downloaded'])
  })
})

describe('task_read files of the built-in tracker (BTN-1538)', () => {
  const store = () => {
    const dir = join(folder, '..', 'store')
    mkdirSync(dir, { recursive: true })
    return dir
  }
  const sha = (letter: string) => letter.repeat(64)

  it('copies a file of the store into .temp/task-files/<KEY>/ and never names the store', async () => {
    const path = join(store(), sha('a'))
    writeFileSync(path, 'picture')
    const lines = await attachmentLines('ABC-1', [attachment(sha('a'), 'shot.png', 7, { path })], {}, folderSink(folder), 1024)
    expect(lines).toEqual([`- shot.png (7 B) — ${join(dir(), 'shot.png')}`])
    expect(readFileSync(join(dir(), 'shot.png'), 'utf8')).toBe('picture')
    // A change to the copy stays in the copy, and the next read puts the store's bytes back.
    writeFileSync(join(dir(), 'shot.png'), 'edit')
    await attachmentLines('ABC-1', [attachment(sha('a'), 'shot.png', 7, { path })], {}, folderSink(folder), 1024)
    expect(readFileSync(path, 'utf8')).toBe('picture')
    expect(readFileSync(join(dir(), 'shot.png'), 'utf8')).toBe('picture')
  })

  it('copies a file past the limit too: the store has it already', async () => {
    const path = join(store(), sha('b'))
    writeFileSync(path, Buffer.alloc(4096))
    const lines = await attachmentLines('ABC-1', [attachment(sha('b'), 'dump.bin', 4096, { path })], {}, folderSink(folder), 1024)
    expect(lines).toEqual([`- dump.bin (4 KB) — ${join(dir(), 'dump.bin')}`])
  })

  it('two files of one name differ by the prefix of their hash', async () => {
    writeFileSync(join(store(), sha('c')), 'first')
    writeFileSync(join(store(), sha('d')), 'second')
    const files = [attachment(sha('c'), 'image.png', 5, { path: join(store(), sha('c')) }), attachment(sha('d'), 'image.png', 6, { path: join(store(), sha('d')) })]
    const lines = await attachmentLines('ABC-1', files, {}, folderSink(folder), 1024)
    expect(lines).toEqual([`- image.png (5 B) — ${join(dir(), 'cccccccc-image.png')}`, `- image.png (6 B) — ${join(dir(), 'dddddddd-image.png')}`])
  })

  it('a file gone from the store since the card was read is "file unavailable"', async () => {
    const lines = await attachmentLines('ABC-1', [attachment(sha('e'), 'gone.png', 3, { path: join(store(), sha('e')) })], {}, folderSink(folder), 1024)
    expect(lines).toEqual(['- gone.png (3 B) — file unavailable'])
  })

  it('with no working folder a file goes by its path in the store', async () => {
    const lines = await attachmentLines('ABC-1', [attachment(sha('f'), 'shot.png', 7, { path: '/files/fff' })], {}, null, 1024)
    expect(lines).toEqual(['- shot.png (7 B) — /files/fff'])
  })
})

describe('the brief of a built-in task (BTN-1538)', () => {
  it('copies the task’s and its parents’ files into the folder and gives the copies’ paths in the prompt', async () => {
    const store = join(folder, '..', 'store')
    mkdirSync(store)
    const own = join(store, 'a'.repeat(64))
    const parents = join(store, 'b'.repeat(64))
    const twin = join(store, 'c'.repeat(64))
    writeFileSync(own, 'own')
    writeFileSync(parents, 'parent')
    writeFileSync(twin, 'twin')
    const gone = join(store, 'd'.repeat(64))
    const brief = {
      title: 'Child',
      description: '',
      files: [{ name: 'shot.png', path: own }, { name: 'gone.txt', path: gone }],
      ancestors: [{ id: 'ABC-0', title: 'Parent', description: '', files: [{ name: 'map.png', path: parents }, { name: 'map.png', path: twin }] }],
    }
    const prompt = `- shot.png — ${own}\n- gone.txt — ${gone}\n- map.png — ${parents}\n- map.png — ${twin}\n`
    const copied = await withBriefCopies(prompt, 'ABC-1', brief, folder)
    const parentDir = join(folder, '.temp', 'task-files', 'ABC-0')
    expect(copied).toBe(`- shot.png — ${join(dir(), 'shot.png')}\n- gone.txt — ${gone}\n- map.png — ${join(parentDir, 'bbbbbbbb-map.png')}\n- map.png — ${join(parentDir, 'cccccccc-map.png')}\n`)
    expect(readFileSync(join(dir(), 'shot.png'), 'utf8')).toBe('own')
    expect(readFileSync(join(parentDir, 'cccccccc-map.png'), 'utf8')).toBe('twin')
  })

  it('leaves a prompt with no brief or no files as it is', async () => {
    expect(await withBriefCopies('text', 'ABC-1', undefined, folder)).toBe('text')
    expect(await withBriefCopies('text', 'ABC-1', { title: 'T', description: '' }, folder)).toBe('text')
    expect(existsSync(join(folder, '.temp'))).toBe(false)
  })
})
