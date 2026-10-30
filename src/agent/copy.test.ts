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

function pinned(name: string, changed: () => void, fail = false) {
  return new PinnedCli({
    dir: join(dir, name), version: '1.0.0', binary, log: vi.fn(), onReady: vi.fn(), onChange: changed,
    fetch: async (into, progress) => {
      progress?.(5, 10)
      if (fail) throw new Error('offline')
      mkdirSync(join(into, 'bin'), { recursive: true })
      writeFileSync(binary(into), 'binary')
      progress?.(10, 10)
    },
  })
}

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

  it('reports a failed first package once the download ends', async () => {
    const { copy } = fixture(true)
    await copy.download()
    expect(copy.view().status).toBe('failed')
  })
})
