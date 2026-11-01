import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliCopyView } from './cli-state.js'
import { cliCopy } from './copy.js'
import { PinnedCli } from './pinned.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'even-keel-copy-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const binary = (folder: string) => join(folder, 'bin', 'cli.exe')

/** `steps` are the `received, total` pairs the fetch reports; the last one comes after the files are in place. */
function pinned(name: string, changed: () => void, fail = false, steps: [number, number][] = [[5, 10], [10, 10]]) {
  return new PinnedCli({
    dir: join(dir, name), version: '1.0.0', binary, log: vi.fn(), onReady: vi.fn(), onChange: changed,
    fetch: async (into, progress) => {
      for (const [received, total] of steps.slice(0, -1)) progress?.(received, total)
      if (fail) throw new Error('offline')
      mkdirSync(join(into, 'bin'), { recursive: true })
      writeFileSync(binary(into), 'binary')
      progress?.(...steps[steps.length - 1]!)
    },
  })
}

/** What the page's progress line shows for a view, in the order a download must go through them. */
const STAGES = ['preparing', 'bytes', 'unpacking'] as const
const stage = (view: CliCopyView) => view.total === 0 ? 'preparing' : view.received === view.total ? 'unpacking' : 'bytes'

function stages(sdk: [number, number][], cliReady = false) {
  const seen: (typeof STAGES)[number][] = []
  const changed = () => { if (copy.view().status === 'downloading') seen.push(stage(copy.view())) }
  const cli = pinned('cli', changed, false, [[0, 300], [150, 300], [300, 300]])
  if (cliReady) {
    mkdirSync(join(dir, 'cli', '1.0.0', 'bin'), { recursive: true })
    writeFileSync(binary(join(dir, 'cli', '1.0.0')), 'binary')
  }
  const copy = cliCopy(cli, { checkedCli: () => true }, '1.0.0', () => true, () => false, 100, pinned('sdk', changed, false, sdk))
  return { copy, seen }
}

const forwardOnly = (seen: string[]) => seen.every((current, i) => i === 0 || STAGES.indexOf(current as never) >= STAGES.indexOf(seen[i - 1] as never))

function fixture(fail = false) {
  const seen: CliCopyView['status'][] = []
  const changed = () => { seen.push(copy.view().status) }
  const copy = cliCopy(pinned('cli', changed, fail), { checkedCli: () => true }, '1.0.0', () => true, () => false, 100, pinned('sdk', changed))
  return { copy, seen }
}

describe('cliCopy', () => {
  it('stays downloading between the CLI and its second package', async () => {
    const { copy, seen } = fixture()
    await copy.download()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((status) => status === 'downloading')).toBe(true)
    expect(copy.view().status).toBe('ready')
  })

  it('never goes back from unpacking to bytes when the second package starts', async () => {
    // npm's tarball comes chunked: no content-length, so its total is 0.
    const { copy, seen } = stages([[0, 0], [3, 0], [6, 0], [6, 0]])
    await copy.download()
    expect(seen).toContain('bytes')
    expect(seen.at(-1)).toBe('unpacking')
    expect(forwardOnly(seen), seen.join(' → ')).toBe(true)
  })

  it('never goes back to bytes when the second package knows its size', async () => {
    const { copy, seen } = stages([[0, 20], [10, 20], [20, 20]])
    await copy.download()
    expect(forwardOnly(seen), seen.join(' → ')).toBe(true)
    expect(copy.view()).toMatchObject({ status: 'ready' })
  })

  it('shows the bytes of the second package when the CLI is already in place', async () => {
    const { copy, seen } = stages([[0, 20], [10, 20], [20, 20]], true)
    await copy.download()
    expect(seen).toContain('bytes')
    expect(forwardOnly(seen), seen.join(' → ')).toBe(true)
  })

  it('reports a failed first package once the download ends', async () => {
    const { copy } = fixture(true)
    await copy.download()
    expect(copy.view().status).toBe('failed')
  })
})
