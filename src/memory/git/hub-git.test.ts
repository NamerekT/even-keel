import { describe, expect, it, vi } from 'vitest'
import type { GitRequest } from '../../link/protocol.js'
import { hubMemoryGit, type HubMemoryGitDeps } from './hub-git.js'

const UPLOAD: GitRequest = { method: 'GET', path: '/info/refs', query: 'service=git-upload-pack' }
const PUSH: GitRequest = { method: 'POST', path: '/git-receive-pack', query: '' }

function deps(patch: Partial<HubMemoryGitDeps> = {}) {
  return {
    placed: vi.fn(async (project: string, machine: string) => project === 'p1' && machine === 'm1'),
    bound: vi.fn((machine: string, project: string) => machine === 'm2' && project === 'p1'),
    repository: (project: string) => (project === 'p1' ? '/state/memory/p1.git' : null),
    pushed: vi.fn(),
    log: vi.fn(),
    backend: vi.fn(async () => ({ status: 200, contentType: 'application/x-git', body: '' })),
    ...patch,
  }
}

describe("the hub's answer to a machine's git (BTN-1648)", { timeout: 120_000 }, () => {
  it('serves a machine with the project in its pool and one with a folder bound to it', async () => {
    const d = deps()
    const git = hubMemoryGit(d)
    expect((await git('m1', 'p1', UPLOAD)).status).toBe(200)
    expect((await git('m2', 'p1', UPLOAD)).status).toBe(200)
    expect(d.backend).toHaveBeenCalledWith('/state/memory/p1.git', UPLOAD, 'm2')
  })

  it('refuses any other machine with 403, the log told once', async () => {
    const d = deps()
    const git = hubMemoryGit(d)
    expect((await git('m3', 'p1', UPLOAD)).status).toBe(403)
    expect((await git('m3', 'p1', UPLOAD)).status).toBe(403)
    expect(d.log).toHaveBeenCalledTimes(1)
    expect(d.backend).not.toHaveBeenCalled()
  })

  it('serves the global configuration to every machine of the network (BTN-1690)', async () => {
    const d = deps({ repository: (project) => (project === 'config' ? '/state/memory/config.git' : null) })
    const git = hubMemoryGit(d)
    expect((await git('m3', 'config', PUSH)).status).toBe(200)
    expect(d.backend).toHaveBeenCalledWith('/state/memory/config.git', PUSH, 'm3')
    expect(d.pushed).toHaveBeenCalledWith('config')
    expect(d.placed).not.toHaveBeenCalled()
  })

  it('answers 404 for a project without a repository yet', async () => {
    const d = deps({ placed: async () => true })
    expect((await hubMemoryGit(d)('m1', 'p2', UPLOAD)).status).toBe(404)
    expect(d.backend).not.toHaveBeenCalled()
  })

  it("lets the hub's copies take a push that went in, not a fetch nor a refused push", async () => {
    const d = deps()
    const git = hubMemoryGit(d)
    await git('m1', 'p1', UPLOAD)
    expect(d.pushed).not.toHaveBeenCalled()
    await git('m1', 'p1', PUSH)
    expect(d.pushed).toHaveBeenCalledWith('p1')
    d.backend.mockResolvedValueOnce({ status: 500, contentType: 'text/plain', body: '' })
    await git('m1', 'p1', PUSH)
    expect(d.pushed).toHaveBeenCalledTimes(1)
  })
})
