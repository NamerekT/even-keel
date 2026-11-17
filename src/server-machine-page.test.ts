import { rmSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { serverFixture } from '../test/server.fixture.js'
import type { MachinePage } from './link/view.js'

const PAGE = { id: 'srv', name: 'Home server', own: false, online: true, capacity: 2, color: '#6f8f7f' } as MachinePage

describe('the routes of a machine page (BTN-1272)', () => {
  it('reads the page and sets the capacity and the colour', async () => {
    const calls: unknown[][] = []
    const { publicDir, base, close } = await serverFixture({
      machinePage: {
        view: async (machine) => (calls.push(['view', machine]), PAGE),
        capacity: async (machine, capacity) => void calls.push(['capacity', machine, capacity]),
        color: async (machine, color) => void calls.push(['color', machine, color]),
      },
    })
    const post = (path: string, body: unknown) => fetch(`${base}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    try {
      expect(await (await post('machines/view', { machine: 'srv' })).json()).toEqual(PAGE)
      expect((await post('machines/capacity', { machine: 'srv', capacity: 3 })).status).toBe(200)
      expect((await post('machines/color', { machine: 'srv', color: '#a08060' })).status).toBe(200)
      expect((await post('machines/color', { machine: 'srv', color: null })).status).toBe(200)
      expect((await post('machines/color', { machine: 'srv' })).status).toBe(400)
      expect(calls).toEqual([
        ['view', 'srv'],
        ['capacity', 'srv', 3],
        ['color', 'srv', '#a08060'],
        ['color', 'srv', null],
      ])
    } finally {
      await close()
      rmSync(publicDir, { recursive: true, force: true })
    }
  })

  it('answers no such machine without the machines service', async () => {
    const { publicDir, base, close } = await serverFixture()
    try {
      const response = await fetch(`${base}/api/machines/view`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"machine":"srv"}' })
      expect(response.status).toBe(400)
    } finally {
      await close()
      rmSync(publicDir, { recursive: true, force: true })
    }
  })
})
