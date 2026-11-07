import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { NoticeError } from '../notice/notice.js'
import { openDatabase } from '../storage/database.js'
import { BuiltinFiles, readLimited, sniffedType } from './files.js'
import { BuiltinStore, type TaskKey } from './store.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const DAY = 24 * 60 * 60 * 1000

let db: PGlite
let store: BuiltinStore
let dir: string
let files: BuiltinFiles
let task: TaskKey
let logged: string[]

const failure = async (work: Promise<unknown>) => {
  try {
    await work
  } catch (error) {
    return error instanceof NoticeError ? error.notice : error
  }
  throw new Error('no failure')
}

async function* chunks(...parts: Buffer[]) {
  for (const part of parts) yield new Uint8Array(part)
}

const text = async (body: AsyncIterable<Uint8Array>) => {
  const parts: Buffer[] = []
  for await (const part of body) parts.push(Buffer.from(part))
  return Buffer.concat(parts)
}

beforeAll(async () => {
  db = await openDatabase(undefined)
}, 120_000)
afterAll(() => db.close())
beforeEach(async () => {
  await db.exec('truncate builtin_tasks, builtin_counters, builtin_labels, builtin_milestones, builtin_task_labels, builtin_relations, builtin_comments, builtin_files')
  store = new BuiltinStore(db, ({ number }) => `ABC-${number}`)
  dir = join(mkdtempSync(join(tmpdir(), 'ek-files-')), 'files')
  logged = []
  files = new BuiltinFiles(store, dir, (line) => logged.push(line))
  task = { project: ABC, number: await store.create({ project: ABC, title: 'Parse the example input' }) }
})

describe('attachments', () => {
  it('keeps the same bytes once on disk, and twice into one task gives the record it has', async () => {
    const other = { project: ABC, number: await store.create({ project: ABC, title: 'Accept the second input format' }) }
    const first = await files.add(task, { name: 'screenshot.png', type: 'image/png', bytes: PNG })
    const again = await files.add(task, { name: 'copy.png', type: 'image/png', bytes: PNG })
    const elsewhere = await files.add(other, { name: 'shot.png', type: 'image/png', bytes: PNG })
    expect(again).toEqual(first)
    expect(elsewhere.id).not.toBe(first.id)
    expect(first).toMatchObject({ name: 'screenshot.png', size: PNG.length, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(readdirSync(dir)).toEqual([first.sha256])
    expect((await files.list(task)).map((each) => [each.name, each.path, each.missing])).toEqual([['screenshot.png', join(dir, first.sha256), false]])
  })

  it('moves the task\'s version for a new record only', async () => {
    const before = (await store.get(task))!.version
    await files.add(task, { name: 'screenshot.png', type: 'image/png', bytes: PNG })
    await files.add(task, { name: 'screenshot.png', type: 'image/png', bytes: PNG })
    expect((await store.get(task))!.version).toBe(before + 1)
  })

  it('serves a raster picture as itself and anything else as bytes, whatever the browser declared', async () => {
    const picture = await files.add(task, { name: 'screenshot.png', type: 'image/png', bytes: PNG })
    const script = await files.add(task, { name: 'drawing.svg', type: 'image/svg+xml', bytes: SVG })
    const served = await files.read(task, picture.sha256)
    expect(served).toMatchObject({ type: 'image/png', size: PNG.length, name: 'screenshot.png' })
    expect(await text(served!.body)).toEqual(PNG)
    expect(await files.read(task, script.sha256)).toMatchObject({ type: 'application/octet-stream', name: 'drawing.svg' })
    expect(await files.read(task, '../../even-keel.log')).toBeUndefined()
    expect(await files.read(task, 'b'.repeat(64))).toBeUndefined()
  })

  it('serves the bytes of a removed record until the sweep, so an undone edit shows the picture again', async () => {
    const picture = await files.add(task, { name: 'screenshot.png', type: 'image/png', bytes: PNG })
    expect(await files.remove(task, picture.id)).toBe(true)
    expect(await files.list(task)).toEqual([])
    expect(await files.read(task, picture.sha256)).toMatchObject({ type: 'image/png', name: undefined })
  })

  it('marks a record without its file missing and logs it', async () => {
    const picture = await files.add(task, { name: 'screenshot.png', type: 'image/png', bytes: PNG })
    rmSync(join(dir, picture.sha256))
    expect((await files.list(task, 'ABC-1')).map((each) => each.missing)).toEqual([true])
    expect(logged).toEqual([expect.stringContaining(`ABC-1: the attachment screenshot.png has no file ${picture.sha256}`)])
  })

  it('reads an upload up to the limit and refuses a bigger one', async () => {
    expect(await readLimited(chunks(PNG.subarray(0, 4), PNG.subarray(4)), PNG.length, 'screenshot.png')).toEqual(PNG)
    expect(await failure(readLimited(chunks(PNG, Buffer.from([1])), PNG.length, 'big.png'))).toEqual({
      code: 'builtin.fileTooLarge', params: { name: 'big.png', limit: PNG.length },
    })
  })

  it('names a raster picture by its first bytes only', () => {
    expect(sniffedType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffedType(Buffer.from('GIF89a'))).toBe('image/gif')
    expect(sniffedType(Buffer.from('RIFF\0\0\0\0WEBP'))).toBe('image/webp')
    expect(sniffedType(Buffer.from('BM\0\0'))).toBe('image/bmp')
    expect(sniffedType(SVG)).toBe('application/octet-stream')
  })
})

describe('sweep', () => {
  it('removes a file no record points at once it is a day old, and leaves the rest', async () => {
    const kept = await files.add(task, { name: 'screenshot.png', type: 'image/png', bytes: PNG })
    const dropped = await files.add(task, { name: 'drawing.svg', type: 'image/svg+xml', bytes: SVG })
    await files.remove(task, dropped.id)
    const fresh = 'c'.repeat(64)
    writeFileSync(join(dir, fresh), 'fresh')
    writeFileSync(join(dir, '.upload-1.tmp'), 'half')
    const old = new Date(Date.now() - DAY - 60_000)
    for (const name of [kept.sha256, dropped.sha256, '.upload-1.tmp']) utimesSync(join(dir, name), old, old)
    expect((await files.sweep(DAY)).sort()).toEqual([dropped.sha256, '.upload-1.tmp'].sort())
    expect(readdirSync(dir).sort()).toEqual([kept.sha256, fresh].sort())
  })

  it('keeps old bytes uploaded again, since the upload freshens them', async () => {
    const picture = await files.add(task, { name: 'screenshot.png', type: 'image/png', bytes: PNG })
    await files.remove(task, picture.id)
    const old = new Date(Date.now() - DAY - 60_000)
    utimesSync(join(dir, picture.sha256), old, old)
    await files.add(task, { name: 'screenshot.png', type: 'image/png', bytes: PNG })
    await store.removeFile(task, (await store.files(task))[0]!.id)
    expect(await files.sweep(DAY)).toEqual([])
    expect(existsSync(join(dir, picture.sha256))).toBe(true)
  })

  it('takes the attachments of a deleted task', async () => {
    const picture = await files.add(task, { name: 'screenshot.png', type: 'image/png', bytes: PNG })
    await store.remove(task)
    utimesSync(join(dir, picture.sha256), new Date(0), new Date(0))
    expect(await files.sweep(DAY)).toEqual([picture.sha256])
  })

  it('does nothing without the folder', async () => {
    expect(await files.sweep(DAY)).toEqual([])
  })
})
