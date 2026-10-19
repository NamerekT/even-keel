import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PinnedCli, type PinnedCliOptions } from './pinned.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'even-keel-pinned-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const binary = (folder: string) => join(folder, 'bin', 'cli.exe')
const put = (into: string) => {
  mkdirSync(join(into, 'bin'), { recursive: true })
  writeFileSync(join(into, 'bin', 'cli.exe'), 'binary')
}
const version = (name: string, at: number) => {
  put(join(dir, name))
  utimesSync(join(dir, name), at, at)
}

function pinned(options: Partial<PinnedCliOptions> = {}) {
  const log = vi.fn()
  const onReady = vi.fn()
  const fetch = vi.fn(async (into: string) => put(into))
  const cli = new PinnedCli({ dir, version: '2.0.0', binary, fetch, log, onReady, retryMs: 60_000, now: () => 0, ...options })
  return { cli, log, onReady, fetch: (options.fetch ?? fetch) as typeof fetch }
}

describe('PinnedCli', () => {
  it('gives the binary of a version already downloaded without fetching it', () => {
    version('2.0.0', 1_000)
    const { cli, fetch } = pinned()
    expect(cli.path()).toBe(binary(join(dir, '2.0.0')))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('gives nothing while the version downloads, then its binary', async () => {
    const { cli, fetch, onReady, log } = pinned()
    expect(cli.path()).toBeUndefined()
    await cli.ensure()
    expect(fetch).toHaveBeenCalledOnce()
    expect(cli.path()).toBe(binary(join(dir, '2.0.0')))
    expect(onReady).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('2.0.0'))
    expect(readdirSync(dir)).toEqual(['2.0.0'])
  })

  it('downloads into a folder of its own and moves it in whole', async () => {
    let into = ''
    const { cli } = pinned({
      fetch: async (folder) => {
        into = folder
        put(folder)
      },
    })
    await cli.ensure()
    expect(into).not.toBe(join(dir, '2.0.0'))
    expect(existsSync(into)).toBe(false)
  })

  it('fetches once for calls that come while a download runs', async () => {
    let finish = () => {}
    const fetch = vi.fn((into: string) => new Promise<void>((resolve) => (finish = () => (put(into), resolve()))))
    const { cli } = pinned({ fetch })
    cli.path()
    cli.path()
    const ensured = cli.ensure()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    finish()
    await ensured
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('leaves no folder after a failed download and retries only after the pause', async () => {
    let now = 0
    const fetch = vi.fn(async (into: string) => {
      mkdirSync(into, { recursive: true })
      throw new Error('checksum mismatch')
    })
    const { cli, log, onReady } = pinned({ fetch, now: () => now })
    await cli.ensure()
    expect(readdirSync(dir)).toEqual([])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('checksum mismatch'))
    expect(onReady).not.toHaveBeenCalled()
    await cli.ensure()
    expect(fetch).toHaveBeenCalledOnce()
    now = 60_000
    await cli.ensure()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps the newest other version and removes the older ones and unfinished downloads', async () => {
    version('1.0.0', 1_000)
    version('1.5.0', 3_000)
    version('1.2.0', 2_000)
    mkdirSync(join(dir, '1.9.0.partial'))
    const { cli } = pinned()
    await cli.ensure()
    expect(readdirSync(dir).sort()).toEqual(['1.5.0', '2.0.0'])
  })
})
