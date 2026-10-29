import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENTS } from './adapters.js'
import { VersionWatcher } from './versions.js'

vi.mock('../paths.js', async (original) => ({ ...await original<typeof import('../paths.js')>(), findBinary: () => false }))

afterEach(() => vi.unstubAllGlobals())

describe('passive adapter probes', () => {
  it.each(Object.entries(AGENTS))('%s never downloads from setup, availability, version sweeps or SDK readiness', async (name, adapter) => {
    const dir = await mkdtemp(join(tmpdir(), 'cli-passive-'))
    const fetch = vi.fn(() => { throw new Error('Unconsented download') })
    vi.stubGlobal('fetch', fetch)
    try {
      const agent = adapter.setup({ env: () => ({ PATH: '' }), workDir: dir, timeoutMs: 100, checkedCli: () => true, log: () => {}, onCliChange: () => {} })
      expect(agent.installed?.()).toBe(false)
      expect(agent.cli?.view().status).toBe('missing')
      agent.pinned?.()
      const watch = new VersionWatcher({
        agents: () => [{ name, title: adapter.title, checked: adapter.checked, installed: () => agent.installed?.() ?? false, version: () => agent.version!(), prune: () => agent.cli!.prune() }],
        intervalMs: 1000, log: () => {}, onChange: () => {},
      })
      await watch.check()
      await agent.version?.().catch(() => {})
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
