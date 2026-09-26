import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventHub } from './events.js'
import { createBatonServer } from './server.js'

describe('Baton HTTP server', () => {
  let hub: EventHub
  let base: string
  let close: () => Promise<void>

  beforeEach(async () => {
    const publicDir = mkdtempSync(join(tmpdir(), 'baton-public-'))
    writeFileSync(join(publicDir, 'index.html'), '<title>Baton</title>')
    hub = new EventHub()
    const server = createBatonServer({ hub, publicDir, getState: () => ({ chain: [] }) })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => new Promise((resolve) => server.close(() => resolve()))
  })

  afterEach(async () => {
    await close()
  })

  it('serves the page at the root', async () => {
    const response = await fetch(base + '/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/text\/html/)
    expect(await response.text()).toContain('Baton')
  })

  it('serves the state as JSON', async () => {
    const response = await fetch(base + '/api/state')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ chain: [] })
  })

  it('answers 404 for an unknown path and refuses to leave the public folder', async () => {
    expect((await fetch(base + '/nope.txt')).status).toBe(404)
    for (const escape of ['/..%2fpackage.json', '/..%5c..%5cpackage.json', '/%2e%2e/%2e%2e/package.json']) {
      expect((await fetch(base + escape)).status, escape).toBe(404)
    }
  })

  it('streams the current state first and then broadcasts', async () => {
    const controller = new AbortController()
    const response = await fetch(base + '/api/events', { signal: controller.signal })
    expect(response.headers.get('content-type')).toMatch(/text\/event-stream/)

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    while (!text.includes('event: state')) text += decoder.decode((await reader.read()).value)

    hub.broadcast('ping', { n: 1 })
    while (!text.includes('event: ping')) text += decoder.decode((await reader.read()).value)

    expect(text).toContain('event: state\ndata: {"chain":[]}\n\n')
    expect(text).toContain('event: ping\ndata: {"n":1}\n\n')
    controller.abort()
  })
})
