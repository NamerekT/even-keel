import { describe, expect, it } from 'vitest'
import { contactMessageOf, installCommandOf, prerequisiteRefusal, waitForContact } from './cli-install.js'
import type { LinkFile } from './machine/join.js'

describe('prerequisiteRefusal', () => {
  it('directs a container install to Compose before installing anything', () => {
    expect(prerequisiteRefusal({ node: '24.0.0', machine: true, git: null, container: true })).toMatch(/docker compose up -d/)
  })

  it('lets Node 24 and newer install a hub, with or without git', () => {
    expect(prerequisiteRefusal({ node: '24.0.0', git: null, machine: false })).toBeNull()
    expect(prerequisiteRefusal({ node: '26.13.1', git: 'git version 2.51.0', machine: false })).toBeNull()
  })

  it('refuses a Node older than 24, saying which one runs', () => {
    expect(prerequisiteRefusal({ node: '22.11.0', git: 'git version 2.51.0', machine: true })).toMatch(/needs Node\.js 24 or newer; this is 22\.11\.0.*nodejs\.org/)
  })

  it('refuses a machine without git: it runs the tasks in worktrees', () => {
    expect(prerequisiteRefusal({ node: '24.3.0', git: null, machine: true })).toMatch(/a machine needs git.*git-scm\.com/)
    expect(prerequisiteRefusal({ node: '24.3.0', git: 'git version 2.51.0.windows.1', machine: true })).toBeNull()
  })
})

describe('installCommandOf', () => {
  it('pins the machine to the hub own version', () => {
    expect(installCommandOf('0.4.0', 'ekm1.abc')).toBe('npx even-keel@0.4.0 install --machine ekm1.abc')
  })
})

const LINK: LinkFile = { hub: 'https://hub.example.com:4749', machine: 'm1', root: '/srv/projects', joinedAt: 1_000 }

describe('waitForContact', () => {
  it('is done once the machine wrote a contact after the start', async () => {
    let now = 10_000
    const files: (LinkFile | undefined)[] = [{ ...LINK, contactAt: 5_000 }, { ...LINK, contactAt: 5_000 }, { ...LINK, contactAt: 11_000 }]
    const reached = await waitForContact(() => files.shift(), 10_000, { now: () => now, sleep: async (ms) => void (now += ms), timeoutMs: 30_000 })
    expect(reached).toBe(true)
    expect(now).toBe(12_000)
  })

  it('gives up when no contact came in time', async () => {
    let now = 10_000
    const reached = await waitForContact(() => LINK, 10_000, { now: () => now, sleep: async (ms) => void (now += ms), timeoutMs: 30_000 })
    expect(reached).toBe(false)
    expect(now).toBeGreaterThanOrEqual(40_000)
  })
})

describe('contactMessageOf', () => {
  it('names the hub, and where to look when it was not reached', () => {
    expect(contactMessageOf(true, LINK.hub, '/data/logs/even-keel.log')).toBe('even-keel: the machine is connected to the hub https://hub.example.com:4749; give it projects on the hub page')
    expect(contactMessageOf(false, LINK.hub, '/data/logs/even-keel.log')).toMatch(/has not reached the hub https:\/\/hub\.example\.com:4749 in 30 s.*\/data\/logs\/even-keel\.log.*even-keel status/)
  })
})
