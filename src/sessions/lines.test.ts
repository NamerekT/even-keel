import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as tick } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lineSlices, PACE_MS, paced } from './lines.js'

describe('lineSlices', () => {
  let dir: string
  let file: string
  const write = (content: string) => writeFileSync(file, content)
  const collect = async (from: number, to: number, chunk: number) => {
    const slices: { lines: string[]; next: number }[] = []
    for await (const slice of lineSlices(file, from, to, { chunk })) slices.push(slice)
    return slices
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-lines-'))
    file = join(dir, 'transcript.jsonl')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('gives every complete line once, split into slices by chunk, and the offset after each slice', async () => {
    const content = 'alpha\nbeta\ngamma\ndelta\n'
    write(content)

    const slices = await collect(0, content.length, 8)

    expect(slices.flatMap((slice) => slice.lines)).toEqual(['alpha', 'beta', 'gamma', 'delta'])
    expect(slices.length).toBeGreaterThan(1)
    expect(slices.at(-1)!.next).toBe(content.length)
    for (const slice of slices) expect(content[slice.next - 1]).toBe('\n')
  })

  it('leaves a trailing line without its newline for the next read', async () => {
    write('alpha\nbet')

    const slices = await collect(0, 9, 4)

    expect(slices.flatMap((slice) => slice.lines)).toEqual(['alpha'])
    expect(slices.at(-1)!.next).toBe(6)
  })

  it('keeps a line longer than a chunk whole', async () => {
    const long = 'x'.repeat(50)
    write(`${long}\nshort\n`)

    const slices = await collect(0, 57, 8)

    expect(slices.flatMap((slice) => slice.lines)).toEqual([long, 'short'])
  })

  it('decodes a character whose bytes fall on both sides of a chunk border', async () => {
    write('aé\nü€\n')
    const size = Buffer.byteLength('aé\nü€\n')

    const slices = await collect(0, size, 2)

    expect(slices.flatMap((slice) => slice.lines)).toEqual(['aé', 'ü€'])
  })

  it('starts at the given offset and gives nothing when there is nothing new', async () => {
    write('alpha\nbeta\n')

    expect((await collect(6, 11, 4)).flatMap((slice) => slice.lines)).toEqual(['beta'])
    expect(await collect(11, 11, 4)).toEqual([])
  })

  it('cuts a chunk into groups of about the given size, each ending on a line', async () => {
    const content = 'alpha\nbeta\ngamma\ndelta\n'
    write(content)

    const slices = []
    for await (const slice of lineSlices(file, 0, content.length, { chunk: 1024, group: 6 })) slices.push(slice)

    expect(slices.map((slice) => slice.lines)).toEqual([['alpha'], ['beta', 'gamma'], ['delta']])
    expect(slices.map((slice) => slice.next)).toEqual([6, 17, 23])
  })

  it('lets other work run between slices', async () => {
    write('alpha\nbeta\ngamma\ndelta\n')
    let ran = false
    void tick().then(() => (ran = true))
    const seen: boolean[] = []

    for await (const _ of lineSlices(file, 0, 23, { chunk: 6 })) seen.push(ran)

    expect(seen.at(-1)).toBe(true)
  })
})

describe('paced', () => {
  const spin = (ms: number) => {
    const until = performance.now() + ms
    while (performance.now() < until);
  }

  it('lets a reader go on within the budget and holds it to the next turn of the loop past it, with every other reader', async () => {
    await paced()
    expect(paced()).toBeUndefined()

    spin(PACE_MS + 5)
    const first = paced()
    const second = paced()
    expect(first).toBeInstanceOf(Promise)
    expect(second).toBe(first)

    await first
    expect(paced()).toBeUndefined()
  })
})
