import { describe, expect, it, vi } from 'vitest'
import type { Agent } from './contract.js'
import { copies } from './copies.js'

function fixture(system = true, { downloaded = [] as string[], hadCopy = false, fails = false, source: initial = 'checked' as 'checked' | 'system' } = {}) {
  let source = initial
  let status: 'ready' | 'missing' | 'downloading' | 'failed' = 'missing'
  let finish = () => {}
  const download = vi.fn(async () => {
    status = 'downloading'
    await new Promise<void>((resolve) => { finish = resolve })
    status = fails ? 'failed' : 'ready'
  })
  const changed = vi.fn()
  const save = vi.fn((_name: string, next: 'checked' | 'system') => { source = next })
  const remember = vi.fn()
  const cli = {
    view: () => ({ version: '1.0.0', source, status, system, received: 0, total: 0, approximate: 100 }),
    download, prune: async () => {}, hadCopy: () => hadCopy,
  }
  const manager = copies(new Map([['codex', { cli } as unknown as Agent]]), save, (name) => save(name, 'system'), changed, async () => {}, { downloaded, remember })
  const done = async () => { await vi.waitFor(() => expect(download).toHaveBeenCalled()); finish() }
  return { manager, download, save, changed, remember, done }
}

describe('CLI copy control', () => {
  it('waits for consent even with an installed binary and only downloads on request', async () => {
    const { manager, download, done } = fixture()
    expect(manager.blocked('codex')?.code).toBe('agent.copyMissing')
    manager.view()
    expect(download).not.toHaveBeenCalled()
    manager.download('codex')
    await done()
    await vi.waitFor(() => expect(manager.blocked('codex')).toBeUndefined())
    expect(download).toHaveBeenCalledOnce()
  })

  it('remembers a consented download that finished, and only then', async () => {
    const { manager, remember, done } = fixture()
    manager.download('codex')
    expect(remember).not.toHaveBeenCalled()
    await done()
    await vi.waitFor(() => expect(remember).toHaveBeenCalledWith(['codex']))
  })

  it('remembers nothing of a download that failed', async () => {
    const { manager, remember, done, changed } = fixture(true, { fails: true })
    manager.download('codex')
    await done()
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2))
    expect(remember).not.toHaveBeenCalled()
  })

  it('downloads a new checked version by itself once a copy was downloaded with consent (BTN-1175)', async () => {
    const { manager, download, done } = fixture(true, { downloaded: ['codex'] })
    expect(manager.blocked('codex')?.code).toBe('agent.copyMissing')
    expect(manager.blocked('codex')?.code).toBe('agent.copyMissing')
    await done()
    await vi.waitFor(() => expect(manager.blocked('codex')).toBeUndefined())
    expect(download).toHaveBeenCalledOnce()
  })

  it('counts a copy already on disk as consent given', async () => {
    const { manager, download, remember, done } = fixture(true, { hadCopy: true })
    expect(remember).toHaveBeenCalledWith(['codex'])
    manager.resume()
    await done()
    expect(download).toHaveBeenCalledOnce()
  })

  it('starts the consented downloads at the start, only of providers on Checked', async () => {
    expect(fixture(true, { downloaded: ['codex'], source: 'system' }).manager.resume()).toEqual([])
    const { manager, download } = fixture(true, { downloaded: ['claude'] })
    expect(manager.resume()).toEqual([])
    expect(download).not.toHaveBeenCalled()
    expect(fixture(true, { downloaded: ['codex'] }).manager.resume()).toEqual(['codex'])
  })

  it('does not retry by itself a download that failed', async () => {
    const { manager, download, done } = fixture(true, { downloaded: ['codex'], fails: true })
    manager.resume()
    await done()
    await vi.waitFor(() => expect(manager.view().codex?.status).toBe('failed'))
    expect(manager.blocked('codex')?.code).toBe('agent.copyMissing')
    expect(download).toHaveBeenCalledOnce()
  })

  it('switches the live setting to Installed on failure and allows a consented retry', async () => {
    const { manager, download, save } = fixture()
    download.mockRejectedValueOnce(new Error('offline'))
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    manager.download('codex')
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('codex', 'system'))
    expect(manager.blocked('codex')).toBeUndefined()
    manager.download('codex')
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2))
    expect(manager.view().codex?.source).toBe('checked')
    log.mockRestore()
  })

  it('offers Installed only when the binary exists', () => {
    expect(() => fixture(false).manager.system('codex')).toThrow('not found')
    const { manager, download } = fixture()
    manager.system('codex')
    expect(manager.blocked('codex')).toBeUndefined()
    expect(download).not.toHaveBeenCalled()
    manager.checked('codex')
    expect(manager.blocked('codex')?.code).toBe('agent.copyMissing')
  })
})
