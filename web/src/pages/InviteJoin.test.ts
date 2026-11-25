// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JoinView } from '../../../src/access/view.js'
import { t } from '../i18n/index.js'
import { InviteJoin } from './InviteJoin.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const WAITING: JoinView = { state: 'waiting', digits: '47', expiresAt: '2026-11-25T10:10:00.000Z' }

let root: Root
let host: HTMLElement
beforeEach(() => vi.useFakeTimers())
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ''
  vi.useRealTimers()
})

/** The new device's screen over scripted answers: each ask takes the next one, an Error is thrown. */
async function join(answers: (JoinView | Error)[], entered = () => {}) {
  const asked: string[] = []
  const post = async <T,>(name: string) => {
    asked.push(name)
    const next = answers.shift()
    if (next === undefined) return new Promise<T>(() => {})
    if (next instanceof Error) throw next
    return next as T
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(InviteJoin, { signedIn: false, link: 'secret', post, entered })))
  return asked
}

const settle = (ms = 0) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

describe('InviteJoin', () => {
  it('keeps the digits through a lost link and shows the decline without a press', async () => {
    await join([WAITING, new TypeError('Failed to fetch'), { state: 'declined' }])
    expect(host.textContent).toContain('47')
    expect(host.textContent).toContain(t.signIn.joinReconnecting)
    expect(host.textContent).not.toContain('Failed to fetch')
    await settle(1000)
    expect(host.textContent).toContain(t.signIn.joinDeclined)
    expect(host.textContent).not.toContain(t.signIn.joinReconnecting)
  })

  it('comes to the admission after a lost link', async () => {
    const entered = vi.fn()
    await join([WAITING, new TypeError('Failed to fetch'), { state: 'admitted', device: 'Chrome on Android' }], entered)
    await settle(1000)
    // No passkeys in happy-dom: let in, the page is opened at once.
    expect(entered).toHaveBeenCalledOnce()
  })

  it('asks again at once when the tab comes back into view', async () => {
    const asked = await join([WAITING, new TypeError('Failed to fetch'), { state: 'declined' }])
    expect(asked).toHaveLength(2)
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
    await settle()
    expect(asked).toHaveLength(3)
    expect(host.textContent).toContain(t.signIn.joinDeclined)
  })

  it('opens the link again when even the first ask was lost', async () => {
    const asked = await join([new TypeError('Failed to fetch'), WAITING])
    expect(host.textContent).toContain(t.signIn.joinReconnecting)
    await settle(1000)
    expect(asked).toEqual(['auth/invite/open', 'auth/invite/open', 'auth/invite/wait'])
    expect(host.textContent).toContain('47')
  })
})
