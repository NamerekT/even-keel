import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compareVersions, LatestCli, type LatestCliOptions } from './latest.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'even-keel-latest-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const binary = (folder: string) => join(folder, 'bin', 'cli.exe')
const put = (into: string) => {
  mkdirSync(join(into, 'bin'), { recursive: true })
  writeFileSync(binary(into), 'binary')
}

function latest(newest: () => Promise<string>, options: Partial<LatestCliOptions> = {}) {
  const fetch = vi.fn(async (_version: string, into: string) => put(into))
  const onReady = vi.fn()
  const onFailure = vi.fn()
  const cli = new LatestCli({ dir, latest: newest, binary, fetch, log: vi.fn(), onReady, onFailure, ...options })
  return { cli, fetch, onReady, onFailure }
}

describe('LatestCli', () => {
  it('downloads the newest released version and runs on it', async () => {
    const { cli, fetch, onReady } = latest(async () => '1.2.0')
    expect(cli.path()).toBeUndefined()
    await cli.ensure()
    expect(fetch).toHaveBeenCalledWith('1.2.0', expect.stringContaining('1.2.0'), expect.any(Function))
    expect(cli.version()).toBe('1.2.0')
    expect(cli.path()).toBe(binary(join(dir, '1.2.0')))
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('finds the newest whole folder on disk at the start, without asking the registry', () => {
    put(join(dir, '1.9.0'))
    put(join(dir, '1.10.0'))
    mkdirSync(join(dir, '1.11.0.partial'))
    const newest = vi.fn(async () => '9.9.9')
    const { cli } = latest(newest)
    expect(cli.version()).toBe('1.10.0')
    expect(cli.path()).toBe(binary(join(dir, '1.10.0')))
    expect(cli.hadCopy()).toBe(true)
    expect(newest).not.toHaveBeenCalled()
  })

  it('downloads nothing while the newest version is already there', async () => {
    put(join(dir, '1.2.0'))
    const { cli, fetch, onReady } = latest(async () => '1.2.0')
    await cli.ensure()
    expect(fetch).not.toHaveBeenCalled()
    expect(onReady).not.toHaveBeenCalled()
  })

  it('stays ready on the old version while a newer one downloads, then moves to it and removes the old one', async () => {
    put(join(dir, '1.0.0'))
    let finish = () => {}
    const { cli, onReady } = latest(async () => '1.1.0', {
      fetch: (_version, into) => new Promise<void>((resolve) => { finish = () => { put(into); resolve() } }),
    })
    const update = cli.ensure()
    await vi.waitFor(() => expect(existsSync(join(dir, '1.1.0.partial'))).toBe(true))
    expect(cli.downloading).toBe(false)
    expect(cli.path()).toBe(binary(join(dir, '1.0.0')))
    await cli.prune()
    expect(existsSync(join(dir, '1.1.0.partial'))).toBe(true)
    finish()
    await update
    expect(cli.version()).toBe('1.1.0')
    expect(onReady).toHaveBeenCalledOnce()
    expect(readdirSync(dir)).toEqual(['1.1.0'])
  })

  it('reads as downloading only while it has no copy yet', async () => {
    let finish = () => {}
    const { cli } = latest(async () => '1.0.0', {
      fetch: (_version, into) => new Promise<void>((resolve) => { finish = () => { put(into); resolve() } }),
    })
    const download = cli.ensure()
    await vi.waitFor(() => expect(existsSync(join(dir, '1.0.0.partial'))).toBe(true))
    expect(cli.downloading).toBe(true)
    finish()
    await download
    expect(cli.downloading).toBe(false)
  })

  it('keeps the old copy quietly when the registry or the download fails', async () => {
    put(join(dir, '1.0.0'))
    const offline = latest(async () => { throw new Error('offline') })
    await offline.cli.ensure()
    expect(offline.cli.error).toBe(false)
    expect(offline.onFailure).not.toHaveBeenCalled()
    const broken = latest(async () => '1.1.0', { fetch: async () => { throw new Error('checksum') } })
    await broken.cli.ensure()
    expect(broken.cli.error).toBe(false)
    expect(broken.cli.version()).toBe('1.0.0')
    expect(broken.onFailure).not.toHaveBeenCalled()
  })

  it('fails when there is no copy to keep', async () => {
    const { cli, onFailure } = latest(async () => { throw new Error('offline') })
    await cli.ensure()
    expect(cli.error).toBe(true)
    expect(cli.path()).toBeUndefined()
    expect(onFailure).toHaveBeenCalledOnce()
  })
})

describe('compareVersions', () => {
  it('compares the parts as numbers', () => {
    expect(['1.10.0', '1.9.0', '2.0.0', '1.9.10'].sort(compareVersions)).toEqual(['1.9.0', '1.9.10', '1.10.0', '2.0.0'])
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
  })
})
