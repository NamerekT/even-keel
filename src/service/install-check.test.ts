import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { checkInstallation, inspectService, waitForService, type ServiceStatus } from './install-check.js'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
vi.mock('../locations.js', () => ({ loadEnv: vi.fn() }))

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks() })

const running: ServiceStatus = { present: true, running: true, details: 'state = running\npid = 42\nlast exit code = unavailable' }
const gone: ServiceStatus = { present: false, running: false, details: 'Could not find service' }

describe('installation readiness', () => {
  const request = vi.fn<typeof fetch>()
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', request)
    request.mockRejectedValue(new Error('connection refused'))
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks() })

  it('fails immediately when launchd has unloaded the agent, without probing an unrelated listener', async () => {
    const result = await waitForService('http://127.0.0.1:4747/', () => gone)
    expect(result.ready).toBe(false)
    expect(result.status).toBe(gone)
    expect(request).not.toHaveBeenCalled()
  })

  it('allows a pending PID and a slow database to start, and checks the agent after the HTTP answer', async () => {
    let polls = 0
    const status = vi.fn(() => ++polls < 21 ? { ...running, running: false } : running)
    request.mockResolvedValue(new Response('', { status: 200 }))
    const result = waitForService('http://127.0.0.1:4999/', status)
    await vi.advanceTimersByTimeAsync(20_000)
    expect((await result).ready).toBe(true)
    expect(request.mock.calls[0]?.[0]).toBe('http://127.0.0.1:4999/')
    expect(status).toHaveBeenCalledTimes(22)
  })

  it.each([401, 403])('accepts a protected page (%i) without needing the token', async (code) => {
    request.mockResolvedValue(new Response('', { status: code }))
    expect((await waitForService('http://127.0.0.1:4747/', () => running)).ready).toBe(true)
  })

  it('does not report success for a page answering 503, and allows a retry after a restart', async () => {
    request.mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('', { status: 200 }))
    const result = waitForService('http://127.0.0.1:4747/', () => running)
    await vi.advanceTimersByTimeAsync(1_000)
    expect((await result).ready).toBe(true)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('fails if the agent disappears during an HTTP request', async () => {
    request.mockResolvedValue(new Response('', { status: 200 }))
    const status = vi.fn().mockReturnValueOnce(running).mockReturnValue(gone)
    expect((await waitForService('http://127.0.0.1:4747/', status)).ready).toBe(false)
  })

  it.each([true, false])('stops waiting after 60 seconds with running=%s and no page', async (hasPid) => {
    const started = Date.now()
    const result = waitForService('http://127.0.0.1:4747/', () => ({ ...running, running: hasPid }))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await result).toMatchObject({ ready: false, reason: expect.stringContaining('60 s') })
    expect(Date.now() - started).toBe(60_000)
  })
})

describe('service manager diagnostics', () => {
  it('extracts only the state, PID and exit code from launchctl, without exposing its environment', () => {
    const run = vi.fn(() => ({ ok: true, text: 'gui/501/local.even-keel = {\n state = waiting\n last exit code = 9\n environment = { PRIVATE_TOKEN = secret }\n}' }))
    const status = inspectService('darwin', 'gui/501/local.even-keel', run)
    expect(status).toEqual({ present: true, running: false, details: 'state = waiting\npid = unavailable\nlast exit code = 9' })
    expect(run).toHaveBeenCalledWith('launchctl', ['print', 'gui/501/local.even-keel'])
  })

  it('does not invent a state or exit code when launchctl cannot find the agent', () => {
    expect(inspectService('darwin', 'gui/501/local.even-keel', () => ({ ok: false, text: 'Could not find service' })))
      .toMatchObject({ present: false, running: false, details: expect.stringContaining('state = unavailable') })
  })

  it('uses systemctl --user is-active and allows activating while rejecting failed', () => {
    const run = vi.fn().mockReturnValueOnce({ ok: false, text: 'activating' }).mockReturnValueOnce({ ok: false, text: 'failed' })
    expect(inspectService('linux', 'even-keel.service', run)).toMatchObject({ present: true, running: false })
    expect(inspectService('linux', 'even-keel.service', run)).toMatchObject({ present: false, running: false })
    expect(run).toHaveBeenCalledWith('systemctl', ['--user', 'is-active', 'even-keel.service'])
  })
})

describe('installer result', () => {
  it('returns nonzero with the background-items hint and missing diagnostics after bootstrap fails', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: '', stderr: 'unavailable' } as ReturnType<typeof spawnSync>)
    const output = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await checkInstallation('darwin', 'gui/501/local.even-keel', '/example/missing.log', true)).toBe(1)
    const text = output.mock.calls.flat().join('\n')
    expect(text).toContain('service manager refused')
    expect(text).toContain('last exit code = unavailable')
    expect(text).toContain('Recent service log:\nunavailable')
    expect(text).toContain('Allow in the Background')
    expect(text).toContain('agent is left installed')
    expect(spawnSync).toHaveBeenCalledWith('tail', ['-n', '40', '/example/missing.log'], expect.anything())
  })

  it('shows the journal and an unsuccessful result for an inactive Linux unit', async () => {
    vi.mocked(spawnSync).mockImplementation(((file: string) => ({ status: file === 'systemctl' ? 3 : 0, stdout: file === 'systemctl' ? 'inactive' : 'example startup error', stderr: '' })) as typeof spawnSync)
    const output = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await checkInstallation('linux', 'even-keel.service', '')).toBe(1)
    expect(output.mock.calls.flat().join('\n')).toContain('example startup error')
    expect(spawnSync).toHaveBeenCalledWith('journalctl', ['--user', '-u', 'even-keel.service', '-n', '40', '--no-pager'], expect.anything())
  })

  it('uses a custom address and port through loopback for a wildcard, with no failure diagnostics on success', async () => {
    vi.stubEnv('EVEN_KEEL_HOST', '0.0.0.0')
    vi.stubEnv('EVEN_KEEL_PORT', '4999')
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: 'state = running\npid = 42', stderr: '' } as ReturnType<typeof spawnSync>)
    const request = vi.fn().mockResolvedValue(new Response('', { status: 401 }))
    vi.stubGlobal('fetch', request)
    const output = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await checkInstallation('darwin', 'gui/501/local.even-keel', '/example/log')).toBe(0)
    expect(request.mock.calls[0]?.[0]).toBe('http://127.0.0.1:4999/')
    expect(output).not.toHaveBeenCalled()
  })
})
