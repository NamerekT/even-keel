import { rmSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { serverFixture } from '../test/server.fixture.js'
import type { ProjectPool } from './link/view.js'

const POOL: ProjectPool = {
  machines: [{ id: 'pc', name: 'Workstation', own: true, online: true, folder: 'D:/example', enabled: true, settings: {}, afterGreen: [] }],
  others: [{ id: 'srv', name: 'Home server', own: false, online: true, folder: '/srv/example', root: '/srv' }],
  servers: [],
}

describe('the routes of a project pool', () => {
  it('reads the pool, connects a machine and turns one on or off', async () => {
    const calls: unknown[][] = []
    const { publicDir, base, close } = await serverFixture({
      pool: {
        view: async (project) => (calls.push(['view', project]), POOL),
        connect: async (project, request) => void calls.push(['connect', project, request]),
        enable: async (project, machine, enabled) => void calls.push(['enable', project, machine, enabled]),
        settings: async (project, machine, values) => void calls.push(['settings', project, machine, values]),
        join: async (machine, requests) => void calls.push(['join', machine, requests]),
        probe: async (machine, folder, of) => (calls.push(['probe', machine, folder, of]), { state: 'free' }),
      },
    })
    const post = (path: string, body: unknown) => fetch(`${base}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    try {
      expect(await (await post('machines/pool', { project: 'ABC' })).json()).toEqual(POOL)
      expect((await post('machines/connect', { project: 'ABC', machine: 'srv', clone: true, folder: ' /srv/abc ' })).status).toBe(200)
      expect((await post('machines/connect', { project: 'ABC', machine: 'srv', folder: '' })).status).toBe(200)
      expect((await post('machines/connect', { project: 'ABC', machine: 'srv', copyFrom: 'lap' })).status).toBe(200)
      expect((await post('machines/settings', { project: 'ABC', machine: 'srv', settings: { check: ['make check', ' '] } })).status).toBe(200)
      expect((await post('machines/settings', { project: 'ABC', machine: 'srv', settings: { check: 'make check' } })).status).toBe(400)
      expect((await post('machines/enable', { project: 'ABC', machine: 'srv', enabled: false })).status).toBe(200)
      expect((await post('machines/enable', { project: 'ABC', machine: 'srv' })).status).toBe(400)
      expect((await post('machines/connect', { project: 'ABC' })).status).toBe(400)
      const projects = [{ project: 'ABC', clone: true }, { project: 'DEF', clone: false, folder: ' /srv/def ' }, { project: 'GHI', folder: '' }]
      expect((await post('machines/join', { machine: 'srv', projects })).status).toBe(200)
      expect((await post('machines/join', { machine: 'srv', projects: [] })).status).toBe(400)
      expect((await post('machines/join', { machine: 'srv', projects: [{ clone: true }] })).status).toBe(400)
      expect((await post('machines/join', { projects })).status).toBe(400)
      expect(await (await post('machines/folder', { machine: 'srv', folder: '/srv/abc', remote: 'https://forge.example.com/abc.git' })).json()).toEqual({ state: 'free' })
      expect((await post('machines/folder', { machine: 'srv', folder: '/srv/abc', project: 'ABC' })).status).toBe(200)
      expect((await post('machines/folder', { machine: 'srv', folder: '/srv/abc' })).status).toBe(400)
      expect(calls).toEqual([
        ['view', 'ABC'],
        ['connect', 'ABC', { machine: 'srv', clone: true, folder: '/srv/abc' }],
        ['connect', 'ABC', { machine: 'srv', clone: 'auto' }],
        ['connect', 'ABC', { machine: 'srv', clone: 'auto', copyFrom: 'lap' }],
        ['settings', 'ABC', 'srv', { check: ['make check'] }],
        ['enable', 'ABC', 'srv', false],
        ['join', 'srv', [{ project: 'ABC', clone: true }, { project: 'DEF', clone: false, folder: '/srv/def' }, { project: 'GHI', clone: 'auto' }]],
        ['probe', 'srv', '/srv/abc', { remote: 'https://forge.example.com/abc.git' }],
        ['probe', 'srv', '/srv/abc', { project: 'ABC' }],
      ])
    } finally {
      await close()
      rmSync(publicDir, { recursive: true, force: true })
    }
  })

  it('answers an empty pool without the machines service', async () => {
    const { publicDir, base, close } = await serverFixture()
    try {
      const response = await fetch(`${base}/api/machines/pool`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"project":"ABC"}' })
      expect(await response.json()).toEqual({ machines: [], others: [], servers: [] })
    } finally {
      await close()
      rmSync(publicDir, { recursive: true, force: true })
    }
  })
})
