import { describe, expect, it, vi } from 'vitest'
import type { Agent } from './contract.js'
import { copies } from './copies.js'

function fixture(system = true) {
  let source: 'checked' | 'system' = 'checked'
  let ready = false
  const download = vi.fn(async () => { ready = true })
  const changed = vi.fn()
  const save = vi.fn((_name: string, next: 'checked' | 'system') => { source = next })
  const cli = {
    view: () => ({ version: '1.0.0', source, status: ready ? 'ready' as const : 'missing' as const, system, received: 0, total: 0, approximate: 100 }),
    download, prune: async () => {},
  }
  const manager = copies(new Map([['codex', { cli } as Agent]]), save, changed, async () => {})
  return { manager, download, save, changed }
}

describe('CLI copy control', () => {
  it('waits for consent even with an installed binary and only downloads on request', async () => {
    const { manager, download } = fixture()
    expect(manager.blocked('codex')?.code).toBe('agent.copyMissing')
    manager.view()
    expect(download).not.toHaveBeenCalled()
    manager.download('codex')
    await vi.waitFor(() => expect(manager.blocked('codex')).toBeUndefined())
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
