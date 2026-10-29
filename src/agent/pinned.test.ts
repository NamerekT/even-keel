import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as fs from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PinnedCli, type PinnedCliOptions } from './pinned.js'

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, rm: vi.fn(actual.rm) }
})

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
  const cli = new PinnedCli({ dir, version: '2.0.0', binary, fetch, log, onReady, ...options })
  return { cli, log, onReady, fetch: (options.fetch ?? fetch) as typeof fetch }
}

describe('PinnedCli', () => {
  it('keeps a locked old folder and removes it on a later sweep without downloading', async () => {
    version('1.0.0', 1000)
    version('2.0.0', 2000)
    const { cli, fetch } = pinned()
    const remove = vi.mocked(fs.rm).mockRejectedValueOnce(new Error('EPERM: executable is in use'))
    try {
      await cli.prune()
      expect(readdirSync(dir).sort()).toEqual(['1.0.0', '2.0.0'])
      await cli.prune()
      expect(readdirSync(dir)).toEqual(['2.0.0'])
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      remove.mockClear()
    }
  })
  it('publishes real byte progress and completion without a second request', async () => {
    const onChange = vi.fn()
    let finish = () => {}
    const { cli } = pinned({
      onChange,
      fetch: async (into, progress) => {
        progress?.(25, 100)
        await new Promise<void>((resolve) => { finish = resolve })
        progress?.(100, 100)
        put(into)
      },
    })
    const download = cli.ensure()
    await vi.waitFor(() => expect(cli.progress).toEqual({ received: 25, total: 100 }))
    expect(cli.downloading).toBe(true)
    expect(cli.path()).toBeUndefined()
    finish()
    await download
    expect(cli.downloading).toBe(false)
    expect(cli.progress).toEqual({ received: 100, total: 100 })
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('reports a failed copy and retries cleanup independently of a download', async () => {
    const onFailure = vi.fn()
    const { cli } = pinned({ fetch: async () => { throw new Error('offline') }, onFailure })
    await cli.ensure()
    expect(cli.error).toBe(true)
    expect(onFailure).toHaveBeenCalledOnce()
    version('1.0.0', 1000)
    version('2.0.0', 2000)
    await cli.prune()
    expect(readdirSync(dir)).toEqual(['2.0.0'])
  })
  it('never downloads while resolving a missing binary', async () => {
    const { cli, fetch } = pinned()
    cli.path()
    cli.path()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetch).not.toHaveBeenCalled()
  })
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

  it('leaves no folder after a failed download and retries on explicit request', async () => {
    const fetch = vi.fn(async (into: string) => {
      mkdirSync(into, { recursive: true })
      throw new Error('checksum mismatch')
    })
    const { cli, log, onReady } = pinned({ fetch })
    await cli.ensure()
    expect(readdirSync(dir)).toEqual([])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('checksum mismatch'))
    expect(onReady).not.toHaveBeenCalled()
    await cli.ensure()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps only the checked version and removes unfinished downloads', async () => {
    version('1.0.0', 1_000)
    version('1.5.0', 3_000)
    version('1.2.0', 2_000)
    mkdirSync(join(dir, '1.9.0.partial'))
    const { cli } = pinned()
    await cli.ensure()
    expect(readdirSync(dir).sort()).toEqual(['2.0.0'])
  })
})
