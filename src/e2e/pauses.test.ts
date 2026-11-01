import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'
import { BOARD_SERVER } from './tracker.fixture.js'

describe('a chain that starts paused on what only the user can fix', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const launches = () => run.agent.calls.filter((call) => call.kind === 'launch')
  const chain = () => run.service.dispatcher.state.active.find((each) => each.project === PROJECT_ID)

  it('pauses for a tracker its sessions would not see and goes on by itself once the description is in the prompt', async () => {
    run.project.brief = false
    run.board.add('ABC-1')
    run.agent.script('ABC-1', commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.pass(60_000)
    expect(chain()).toMatchObject({ paused: true, error: { code: 'chain.noTrackerMcp', params: expect.objectContaining({ server: BOARD_SERVER }) } })
    expect(launches()).toEqual([])

    const form = run.service.configStore.view().projects[PROJECT_ID]!
    run.service.configStore.saveProject(PROJECT_ID, { ...form, brief: true }, form)

    await run.until(() => launches().length === 1, 'ABC-1 launched', { limitMs: 60_000 })
    expect(chain()).toMatchObject({ paused: false, error: null })
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
  })

  it('pauses for a package lacking its key and goes on by itself once the key is set', async () => {
    const server = await mcpServer()
    try {
      run.board.add('ABC-1')
      run.agent.script('ABC-1', commitAndMerge())
      await run.start()
      const url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}/mcp`
      await run.post('packages/server', { name: 'example', server: { type: 'http', url, headers: { Authorization: 'Bearer ${EXAMPLE_TOKEN}' } }, project: PROJECT_ID })
      await run.until(() => run.service.packages.unready(PROJECT_ID).includes('example'), 'the package installed without its key')
      await run.startChain(PROJECT_ID)

      await run.pass(60_000)
      expect(chain()).toMatchObject({ paused: true, error: { code: 'chain.packagesNotReady', params: expect.objectContaining({ packages: ['example'] }) } })
      expect(launches()).toEqual([])

      await run.post('packages/key', { name: 'EXAMPLE_TOKEN', value: 'token-1' })

      await run.until(() => launches().length === 1, 'ABC-1 launched', { limitMs: 60_000 })
      expect(chain()).toMatchObject({ paused: false, error: null })
      expect(server.seen.map((headers) => headers.authorization)).toContain('Bearer token-1')
      await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    } finally {
      await new Promise((resolve) => server.http.close(resolve))
    }
  })
})

/** A remote MCP server that answers `initialize`, as the gateway's probe asks it; `seen` — the headers of each request. */
async function mcpServer(): Promise<{ http: Server; seen: IncomingHttpHeaders[] }> {
  const seen: IncomingHttpHeaders[] = []
  const http = createServer((req, res) => {
    seen.push(req.headers)
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString()))
    req.on('end', () => {
      if (req.method !== 'POST') return void res.writeHead(405).end()
      const { id } = JSON.parse(body) as { id?: number }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'example', version: '1' } } }))
    })
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  return { http, seen }
}
