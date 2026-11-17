import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HubHooks } from './hub-hooks.js'

let page: Server
let origin: string | undefined
let seen: { method: string; url: string; type: string | undefined; body: string }[]
let holders: Record<string, string>
let lines: string[]

const hooks = () => new HubHooks({ origin: () => origin, holder: (session) => holders[session], log: (line) => void lines.push(line) })

beforeEach(async () => {
  seen = []
  holders = {}
  lines = []
  page = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', type: req.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') })
      if (req.url?.includes('unknown') === true) res.writeHead(404).end()
      else res.writeHead(200, { 'content-type': 'application/json' }).end('{"message":"hello"}')
    })
  })
  await new Promise<void>((resolve) => page.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(page.address() as { port: number }).port}`
})

afterEach(async () => {
  await new Promise((resolve) => page.close(resolve))
})

describe('the hub’s side of a machine’s session hooks (BTN-1260)', () => {
  it('asks the hub’s page a route of the hooks and gives its status and body back', async () => {
    holders['s-1'] = 'm-a'
    const answer = await hooks().relay('m-a', { method: 'POST', path: '/api/sessions/s-1/mail', body: '{"event":"PreToolUse"}' })
    expect(answer).toEqual({ status: 200, body: '{"message":"hello"}' })
    expect(seen).toEqual([{ method: 'POST', url: '/api/sessions/s-1/mail', type: 'application/json', body: '{"event":"PreToolUse"}' }])
    expect(await hooks().relay('m-a', { method: 'GET', path: '/api/sessions/unknown/checkpoint' })).toEqual({ status: 404, body: '' })
  })

  it('asks for a session no machine is known to hold yet: a launch is seen by the hooks before the mirror', async () => {
    expect((await hooks().relay('m-a', { method: 'GET', path: '/api/sessions/s-2/check' })).status).toBe(200)
    expect((await hooks().relay('m-a', { method: 'GET', path: '/api/projects/ABC/calibration?task=ABC-1' })).status).toBe(200)
    expect(seen.map((each) => each.url)).toEqual(['/api/sessions/s-2/check', '/api/projects/ABC/calibration?task=ABC-1'])
  })

  it('refuses a session another machine holds and any other route of the page, asking nothing', async () => {
    holders['s-1'] = 'm-b'
    expect(await hooks().relay('m-a', { method: 'POST', path: '/api/sessions/s-1/permission', body: '{}' })).toEqual({ status: 403, body: '' })
    expect(await hooks().relay('m-a', { method: 'GET', path: '/api/state' })).toEqual({ status: 404, body: '' })
    expect(await hooks().relay('m-a', { method: 'POST', path: '/api/session/answer', body: '{}' })).toEqual({ status: 404, body: '' })
    expect(seen).toEqual([])
    expect(lines).toHaveLength(3)
  })

  it('answers 503 while the page does not listen and 502 when it does not answer', async () => {
    const request = { method: 'GET', path: '/api/sessions/s-1/checkpoint' }
    const unset = origin
    origin = undefined
    expect(await hooks().relay('m-a', request)).toEqual({ status: 503, body: '' })
    await new Promise((resolve) => page.close(resolve))
    origin = unset
    expect(await hooks().relay('m-a', request)).toEqual({ status: 502, body: '' })
    page = createServer()
    await new Promise<void>((resolve) => page.listen(0, '127.0.0.1', resolve))
  })
})
