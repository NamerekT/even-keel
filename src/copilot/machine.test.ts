import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runWithInput } from '../agent/oneturn.js'
import { machineSignedIn, machineToken } from './machine.js'

vi.mock('../agent/oneturn.js', () => ({ runWithInput: vi.fn() }))
const run = vi.mocked(runWithInput)
const env = { COPILOT_HOME: '/accounts/copilot', PATH: '/bin' }

function reply(result: unknown, id = 1): string {
  const body = JSON.stringify({ jsonrpc: '2.0', id, result })
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

const GH = { isAuthenticated: true, authType: 'gh-cli', host: 'https://github.com', login: 'octocat' }

describe('Copilot machine token', () => {
  beforeEach(() => run.mockReset())

  it('asks the same CLI and folder for its source, then reads only that gh account', async () => {
    run.mockResolvedValueOnce(reply(GH)).mockResolvedValueOnce('gho_example\n')
    expect(await machineToken('/cli/copilot', env, '/accounts/copilot', 1000)).toBe('gho_example')
    expect(run.mock.calls[0]).toEqual([
      '/cli/copilot', ['--headless', '--stdio', '--no-auto-update'],
      expect.stringContaining('"method":"auth.getStatus"'),
      { cwd: '/accounts/copilot', env, timeoutMs: 1000 },
    ])
    expect(run.mock.calls[1]).toEqual([
      'gh', ['auth', 'token', '--hostname', 'github.com', '--user', 'octocat'], '',
      { cwd: '/accounts/copilot', env, timeoutMs: 1000 },
    ])
  })

  it.each([
    { ...GH, authType: 'user' },
    { ...GH, authType: 'env' },
    { ...GH, isAuthenticated: false },
    { ...GH, host: 'https://example.com' },
    { ...GH, login: undefined },
    null,
  ])('does not substitute gh for another or unknown source: %j', async (status) => {
    run.mockResolvedValueOnce(reply(status))
    expect(await machineToken('copilot', env, '/accounts/copilot', 1000)).toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('skips another RPC reply and respects UTF-8 frame lengths', async () => {
    run.mockResolvedValueOnce(reply({ message: '✓' }, 2) + reply(GH)).mockResolvedValueOnce('gho_example')
    expect(await machineToken('copilot', env, '/accounts/copilot', 1000)).toBe('gho_example')
  })

  it.each(['', 'not RPC', 'Content-Length: 999\r\n\r\n{}', reply(GH).slice(0, -1)])('rejects an unreadable CLI answer', async (text) => {
    run.mockResolvedValueOnce(text)
    expect(await machineToken('copilot', env, '/accounts/copilot', 1000)).toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed CLI probe private and does not run gh', async () => {
    run.mockRejectedValueOnce(new Error('CLI unavailable'))
    expect(await machineToken('copilot', env, '/accounts/copilot', 1000)).toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it.each(['', 'ghp_classic', 'gho_example\nextra output'])('rejects an absent or unsupported gh token', async (token) => {
    run.mockResolvedValueOnce(reply(GH)).mockResolvedValueOnce(token)
    expect(await machineToken('copilot', env, '/accounts/copilot', 1000)).toBeNull()
  })

  it('keeps a failed gh call private', async () => {
    run.mockResolvedValueOnce(reply(GH)).mockRejectedValueOnce(new Error('gh unavailable'))
    expect(await machineToken('copilot', env, '/accounts/copilot', 1000)).toBeNull()
  })
})

describe('Copilot machine sign-in', () => {
  beforeEach(() => run.mockReset())

  it('asks the same CLI and folder whether it is signed in, by any source', async () => {
    run.mockResolvedValueOnce(reply({ isAuthenticated: true, authType: 'user' }))
    expect(await machineSignedIn('/cli/copilot', env, '/accounts/copilot', 1000)).toBe(true)
    expect(run.mock.calls[0]).toEqual([
      '/cli/copilot', ['--headless', '--stdio', '--no-auto-update'],
      expect.stringContaining('"method":"auth.getStatus"'),
      { cwd: '/accounts/copilot', env, timeoutMs: 1000 },
    ])
  })

  it('says signed out only when the CLI says so', async () => {
    run.mockResolvedValueOnce(reply({ isAuthenticated: false }))
    expect(await machineSignedIn('copilot', env, '/accounts/copilot', 1000)).toBe(false)
  })

  it.each([reply(null), reply({ authType: 'user' }), 'not RPC'])('does not know from an unreadable answer: %j', async (text) => {
    run.mockResolvedValueOnce(text)
    expect(await machineSignedIn('copilot', env, '/accounts/copilot', 1000)).toBeNull()
  })

  it('does not know when the CLI cannot be asked', async () => {
    run.mockRejectedValueOnce(new Error('CLI unavailable'))
    expect(await machineSignedIn('copilot', env, '/accounts/copilot', 1000)).toBeNull()
  })
})
