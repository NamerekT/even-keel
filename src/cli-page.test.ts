import { describe, expect, it } from 'vitest'
import { browserCommandOf, opensBrowser, pageAddressOf, pageLogOf, pageMessageOf, waitForPage } from './cli-page.js'

describe('pageAddressOf', () => {
  it('builds the address from the environment as the service does', () => {
    expect(pageAddressOf({})).toEqual({ url: 'http://127.0.0.1:4747' })
    expect(pageAddressOf({ EVEN_KEEL_HOST: '0.0.0.0', EVEN_KEEL_PORT: '5000' })).toEqual({ url: 'http://127.0.0.1:5000' })
    expect(pageAddressOf({ EVEN_KEEL_HOST: '::1' })).toEqual({ url: 'http://[::1]:4747' })
  })

  it('gives the error of a wrong port instead of throwing', () => {
    const address = pageAddressOf({ EVEN_KEEL_PORT: 'http' })
    expect('error' in address && address.error).toMatch(/EVEN_KEEL_PORT/)
  })
})

describe('pageLogOf', () => {
  it('names the journal on Linux and the log file elsewhere', () => {
    expect(pageLogOf('linux', '/home/john/.local/share/even-keel')).toBe('journalctl --user -u even-keel')
    expect(pageLogOf('darwin', '/Users/john/Library/Application Support/even-keel')).toBe('/Users/john/Library/Application Support/even-keel/logs/even-keel.log')
    expect(pageLogOf('win32', 'C:\\Users\\john\\AppData\\Local\\even-keel')).toBe('C:\\Users\\john\\AppData\\Local\\even-keel\\logs\\even-keel.log')
  })
})

describe('pageMessageOf', () => {
  it('says where to go once the page answers', () => {
    expect(pageMessageOf({ kind: 'ready', url: 'http://127.0.0.1:4747' })).toBe('Open http://127.0.0.1:4747')
  })

  it('gives the address and the log when the page is silent', () => {
    expect(pageMessageOf({ kind: 'silent', url: 'http://127.0.0.1:4747', log: 'journalctl --user -u even-keel' })).toBe(
      'The page at http://127.0.0.1:4747 does not answer yet. Log: journalctl --user -u even-keel',
    )
  })

  it('says where the page will be without a service', () => {
    expect(pageMessageOf({ kind: 'noService', url: 'http://127.0.0.1:4747' })).toBe('Once Even Keel runs, its page is at http://127.0.0.1:4747')
  })

  it('passes on the error of the address', () => {
    expect(pageMessageOf({ kind: 'unknown', error: 'EVEN_KEEL_PORT is wrong' })).toBe('The address of the page is unknown: EVEN_KEEL_PORT is wrong')
  })
})

describe('opensBrowser', () => {
  const local = { firstInstall: true, responded: true }

  it('opens only at the first install and only once the page answered', () => {
    expect(opensBrowser({ ...local, platform: 'win32', env: {} })).toBe(true)
    expect(opensBrowser({ ...local, firstInstall: false, platform: 'win32', env: {} })).toBe(false)
    expect(opensBrowser({ ...local, responded: false, platform: 'win32', env: {} })).toBe(false)
  })

  it('on Linux needs a display and no SSH', () => {
    expect(opensBrowser({ ...local, platform: 'linux', env: { DISPLAY: ':0' } })).toBe(true)
    expect(opensBrowser({ ...local, platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } })).toBe(true)
    expect(opensBrowser({ ...local, platform: 'linux', env: {} })).toBe(false)
    expect(opensBrowser({ ...local, platform: 'linux', env: { DISPLAY: '' } })).toBe(false)
    expect(opensBrowser({ ...local, platform: 'linux', env: { DISPLAY: ':0', SSH_CONNECTION: '10.0.0.2 5022 10.0.0.1 22' } })).toBe(false)
    expect(opensBrowser({ ...local, platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0', SSH_TTY: '/dev/pts/1' } })).toBe(false)
  })

  it('on macOS opens unless by SSH', () => {
    expect(opensBrowser({ ...local, platform: 'darwin', env: {} })).toBe(true)
    expect(opensBrowser({ ...local, platform: 'darwin', env: { SSH_CONNECTION: '10.0.0.2 5022 10.0.0.1 22' } })).toBe(false)
    expect(opensBrowser({ ...local, platform: 'darwin', env: { SSH_TTY: '/dev/ttys001' } })).toBe(false)
  })

  it('does not open on other platforms', () => {
    expect(opensBrowser({ ...local, platform: 'freebsd', env: { DISPLAY: ':0' } })).toBe(false)
  })
})

describe('browserCommandOf', () => {
  it('opens through the platform', () => {
    expect(browserCommandOf('win32', 'http://127.0.0.1:4747')).toEqual(['cmd', ['/c', 'start', '', 'http://127.0.0.1:4747']])
    expect(browserCommandOf('darwin', 'http://127.0.0.1:4747')).toEqual(['open', ['http://127.0.0.1:4747']])
    expect(browserCommandOf('linux', 'http://127.0.0.1:4747')).toEqual(['xdg-open', ['http://127.0.0.1:4747']])
    expect(browserCommandOf('freebsd', 'http://127.0.0.1:4747')).toBeNull()
  })
})

describe('waitForPage', () => {
  /** A clock that moves only when the wait sleeps. */
  function clock() {
    let now = 0
    return { now: () => now, sleep: async (ms: number) => void (now += ms) }
  }

  it('is done at the first answer of any status', async () => {
    const asked: string[] = []
    const time = clock()
    let calls = 0
    const answered = await waitForPage('http://127.0.0.1:4747', {
      ...time,
      request: async (url) => {
        asked.push(url)
        if (++calls < 3) throw new Error('ECONNREFUSED')
      },
    })
    expect(answered).toBe(true)
    expect(asked).toHaveLength(3)
    expect(time.now()).toBe(2_000)
  })

  it('gives up after the timeout', async () => {
    const time = clock()
    let calls = 0
    const answered = await waitForPage('http://127.0.0.1:4747', {
      ...time,
      request: async () => {
        calls++
        throw new Error('ECONNREFUSED')
      },
    })
    expect(answered).toBe(false)
    expect(time.now()).toBe(30_000)
    expect(calls).toBe(31)
  })

  it('asks once with no timeout', async () => {
    const time = clock()
    let calls = 0
    const answered = await waitForPage('http://127.0.0.1:4747', {
      ...time,
      timeoutMs: 0,
      request: async () => {
        calls++
        throw new Error('ECONNREFUSED')
      },
    })
    expect(answered).toBe(false)
    expect(calls).toBe(1)
  })
})
