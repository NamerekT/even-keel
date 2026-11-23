import { describe, expect, it, vi } from 'vitest'
import type { CliSourceName } from './cli-state.js'
import type { Agent } from './contract.js'
import { copies } from './copies.js'

function fixture(system = true, { downloaded = [] as string[], hadCopy = false, fails = false, source: initial = 'checked' as CliSourceName, hub = undefined as string[] | undefined, latest = undefined as string | null | undefined, installable = true } = {}) {
  let source = initial
  let status: 'ready' | 'missing' | 'downloading' | 'failed' = 'missing'
  let finish = () => {}
  const download = vi.fn(async () => {
    status = 'downloading'
    await new Promise<void>((resolve) => { finish = resolve })
    status = fails ? 'failed' : 'ready'
  })
  const changed = vi.fn()
  const save = vi.fn((_name: string, next: CliSourceName) => { source = next })
  const remember = vi.fn()
  const view = vi.fn(() => ({ version: '1.0.0', source, status, checkedStatus: status, ...(latest === undefined ? {} : { latest }), system, received: 0, total: 0, approximate: 100 }))
  const cli = {
    view,
    state: () => ({ source, status }),
    download, prune: async () => {}, hadCopy: () => hadCopy,
  }
  const manager = copies(new Map([['codex', { cli } as unknown as Agent]]), save, (name) => save(name, 'system'), changed, async () => {}, { downloaded, remember, ...(hub === undefined ? {} : { hub: () => hub }) }, () => installable)
  const done = async () => { await vi.waitFor(() => expect(download).toHaveBeenCalled()); finish() }
  return { manager, download, save, changed, remember, done, view }
}

describe('CLI copy control', () => {
  it('answers whether a launch is blocked without the whole view, which searches the disk for the system binary', () => {
    const { manager, view } = fixture(true, { source: 'system' })
    expect(manager.blocked('codex')).toBeUndefined()
    expect(view).not.toHaveBeenCalled()
  })

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

  it('switches to the copy of the newest release on its download, and its wait says so (BTN-1539)', async () => {
    const { manager, save, done } = fixture(false, { source: 'system', latest: null, installable: false })
    expect(manager.view().codex?.installable).toBe(false)
    manager.download('codex', 'latest')
    expect(save).toHaveBeenCalledWith('codex', 'latest')
    expect(manager.blocked('codex')?.params).toMatchObject({ latest: true, downloading: true })
    await done()
    await vi.waitFor(() => expect(manager.blocked('codex')).toBeUndefined())
  })

  it('refuses the newest release where the agent has no copy of it on this platform', () => {
    const { manager, save } = fixture(false, { source: 'system' })
    expect(() => manager.download('codex', 'latest')).toThrow()
    expect(save).not.toHaveBeenCalled()
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

  it("downloads by itself on a machine with the hub's consent, and remembers it as its own (BTN-1516)", async () => {
    const hub: string[] = []
    const { manager, download, remember, done } = fixture(true, { hub })
    expect(manager.resume()).toEqual([])
    expect(manager.blocked('codex')?.params).toMatchObject({ downloading: false })
    hub.push('codex')
    expect(manager.resume()).toEqual(['codex'])
    expect(manager.blocked('codex')?.params).toMatchObject({ downloading: true })
    await done()
    await vi.waitFor(() => expect(manager.blocked('codex')).toBeUndefined())
    expect(download).toHaveBeenCalledOnce()
    expect(remember).toHaveBeenCalledWith(['codex'])
  })

  it("gives the hub only its own consents, never the hub's it was told (BTN-1516)", async () => {
    expect(fixture(true, { hub: ['codex'] }).manager.consented()).toEqual([])
    expect(fixture(true, { downloaded: ['codex'] }).manager.consented()).toEqual(['codex'])
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
