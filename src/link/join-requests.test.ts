import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JoinRequests, MAX_WAITING } from './join-requests.js'
import { API_VERSION, REQUEST_MS, type MachineAbout, type RequestPost } from './protocol.js'

const ABOUT: MachineAbout = {
  host: 'example-box', os: 'linux 6.8.0', evenKeel: '0.4.0', node: '24.11.0', git: '2.47.0', agents: {}, gitUser: true, root: '/home/user/projects',
}
const nonceOf = (index: number) => index.toString(16).padStart(32, '0')
const post = (index = 1, rest: Partial<RequestPost> = {}): RequestPost => ({ api: API_VERSION, about: ABOUT, nonce: nonceOf(index), public: false, ...rest })

describe('requests to join by the address (BTN-1620)', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-11-24T09:00:00Z') }))
  afterEach(() => vi.useRealTimers())

  const made = () => {
    let changes = 0
    const admitted: string[] = []
    const requests = new JoinRequests({
      fingerprint: async () => 'f'.repeat(64),
      admit: async () => {
        const machine = `machine-${admitted.length + 1}`
        admitted.push(machine)
        return { machine, secret: `secret-of-${machine}` }
      },
      versionRefusal: (api) => (api === API_VERSION ? undefined : { refused: 'version', api: API_VERSION }),
      changed: () => void changes++,
      log: () => {},
      code: async (fingerprint, nonce) => `${fingerprint === '' ? 'PUB' : 'PIN'}-${nonce.slice(-3)}`,
    })
    return { requests, changes: () => changes, admitted }
  }

  it('shows a request on the page with the code of the hub’s certificate, or of the number for a public one', async () => {
    const { requests, changes } = made()
    const asked = await requests.ask('192.0.2.10', post(1))
    expect(asked).toEqual({ request: expect.any(String), expiresAt: Date.now() + REQUEST_MS })
    await requests.ask('192.0.2.11', post(2, { public: true }))
    expect(requests.waiting().map(({ code, from, about }) => ({ code, from, host: about.host }))).toEqual([
      { code: 'PIN-001', from: '192.0.2.10', host: 'example-box' },
      { code: 'PUB-002', from: '192.0.2.11', host: 'example-box' },
    ])
    expect(changes()).toBe(2)
  })

  it('expires in ten minutes: the page loses it and the machine is told', async () => {
    const { requests, changes } = made()
    const asked = await requests.ask('192.0.2.10', post())
    if (!('request' in asked)) throw new Error('refused')
    await vi.advanceTimersByTimeAsync(REQUEST_MS - 1_000)
    expect(requests.answer({ request: asked.request, nonce: nonceOf(1) })).toEqual({ state: 'waiting' })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(requests.waiting()).toEqual([])
    expect(changes()).toBe(2)
    expect(requests.answer({ request: asked.request, nonce: nonceOf(1) })).toEqual({ refused: 'expired' })
    await expect(requests.admit(asked.request)).rejects.toMatchObject({ notice: { code: 'machines.requestGone' } })
  })

  it('refuses a second request from the same address and one past the fifth waiting, and the page never shows them', async () => {
    const { requests } = made()
    await requests.ask('192.0.2.10', post(1))
    expect(await requests.ask('192.0.2.10', post(2))).toEqual({ refused: 'busy' })
    for (let index = 2; index <= MAX_WAITING; index++) await requests.ask(`192.0.2.${10 + index}`, post(index))
    expect(await requests.ask('192.0.2.99', post(9))).toEqual({ refused: 'full' })
    expect(requests.waiting()).toHaveLength(MAX_WAITING)
    expect(requests.waiting().some((request) => request.from === '192.0.2.99')).toBe(false)
  })

  it('shows an IPv4 address mapped into IPv6 as plain IPv4 and takes both forms as one address (BTN-1628)', async () => {
    const { requests } = made()
    await requests.ask('::ffff:192.0.2.10', post(1))
    expect(await requests.ask('192.0.2.10', post(2))).toEqual({ refused: 'busy' })
    await requests.ask('2001:db8::10', post(3))
    expect(requests.waiting().map(({ from }) => from)).toEqual(['192.0.2.10', '2001:db8::10'])
  })

  it('takes two requests of the same address at once as one', async () => {
    const { requests } = made()
    const both = await Promise.all([requests.ask('192.0.2.10', post(1)), requests.ask('192.0.2.10', post(2))])
    expect(both.filter((answer) => 'refused' in answer)).toEqual([{ refused: 'busy' }])
  })

  it('refuses another API version, a request that is not whole, and an answer asked with another number', async () => {
    const { requests } = made()
    expect(await requests.ask('192.0.2.10', post(1, { api: API_VERSION - 1 }))).toEqual({ refused: 'version', api: API_VERSION })
    const asked = await requests.ask('192.0.2.10', post(1))
    if (!('request' in asked)) throw new Error('refused')
    expect(requests.answer({ request: asked.request, nonce: nonceOf(2) })).toEqual({ refused: 'token' })
  })

  it('lets an admitted machine take its secret, again if the answer was lost, and frees the address', async () => {
    const { requests, admitted } = made()
    const asked = await requests.ask('192.0.2.10', post())
    if (!('request' in asked)) throw new Error('refused')
    expect(await requests.admit(asked.request)).toBe('machine-1')
    await expect(requests.admit(asked.request)).rejects.toMatchObject({ notice: { code: 'machines.requestGone' } })
    expect(admitted).toEqual(['machine-1'])
    expect(requests.waiting()).toEqual([])
    const answer = { state: 'admitted', machine: 'machine-1', secret: 'secret-of-machine-1' }
    expect(requests.answer({ request: asked.request, nonce: nonceOf(1) })).toEqual(answer)
    expect(requests.answer({ request: asked.request, nonce: nonceOf(1) })).toEqual(answer)
    expect(await requests.ask('192.0.2.10', post(2))).toMatchObject({ request: expect.any(String) })
  })

  it('tells a declined machine so, and the address may ask again', async () => {
    const { requests } = made()
    const asked = await requests.ask('192.0.2.10', post())
    if (!('request' in asked)) throw new Error('refused')
    requests.decline(asked.request)
    expect(requests.waiting()).toEqual([])
    expect(requests.answer({ request: asked.request, nonce: nonceOf(1) })).toEqual({ refused: 'declined' })
    expect(() => requests.decline(asked.request)).toThrow()
    expect(await requests.ask('192.0.2.10', post(2))).toMatchObject({ request: expect.any(String) })
  })

  it('answers an unknown request as expired: the hub restarted since', () => {
    const { requests } = made()
    expect(requests.answer({ request: 'nope', nonce: nonceOf(1) })).toEqual({ refused: 'expired' })
  })
})
