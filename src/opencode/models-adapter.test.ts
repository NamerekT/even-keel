import { afterEach, describe, expect, it, vi } from 'vitest'
import { opencode } from './adapter.js'
import { OpenCodeCli } from './cli.js'
import { readAuth } from './home.js'

vi.mock('./home.js', async original => ({ ...await original<typeof import('./home.js')>(), readAuth: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('OpenCode model list', () => {
  it('keeps a nonempty source catalogue complete even when the subscription intersection is empty', async () => {
    vi.spyOn(OpenCodeCli.prototype, 'models').mockResolvedValue(['openai/denied'])
    vi.mocked(readAuth).mockReturnValue(JSON.stringify({ openai: { type: 'oauth', access: 'fake-access' } }))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ models: [] })))
    const agent = opencode.setup({ env: () => ({}), timeoutMs: 1000, workDir: '/unused', checkedCli: () => false, log: () => {}, onCliChange: () => {} })
    expect(await agent.models!({ key: 'demo', agent: 'opencode', dir: '/unused', global: false })).toEqual({ models: [], complete: true })
  })
})
