import { describe, expect, it } from 'vitest'
import { mcpArgs } from './mcp.js'

describe('mcpArgs', () => {
  it('declares each gateway server by its url', () => {
    const servers = [
      { name: 'huly', plugin: 'huly', url: 'http://127.0.0.1:4748/mcp/p/huly%40even-keel@a/huly' },
      { name: 'strata', plugin: null, url: 'http://127.0.0.1:4748/mcp/p/strata@b/strata' },
    ]
    expect(mcpArgs(servers)).toEqual([
      '-c',
      'mcp_servers.huly.url="http://127.0.0.1:4748/mcp/p/huly%40even-keel@a/huly"',
      '-c',
      'mcp_servers.strata.url="http://127.0.0.1:4748/mcp/p/strata@b/strata"',
    ])
    expect(mcpArgs([])).toEqual([])
  })
})
