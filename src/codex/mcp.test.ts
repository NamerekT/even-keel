import { describe, expect, it } from 'vitest'
import { mcpArgs } from './mcp.js'

describe('mcpArgs', () => {
  it('declares a stdio server and forwards the tracker variables to it by name', () => {
    const server = { command: 'npx', args: ['-y', '@firfi/huly-mcp@latest'], env: { TOOLSETS: 'issues,projects' } }
    expect(mcpArgs('huly', server, ['HULY_URL', 'HULY_TOKEN'])).toEqual([
      '-c',
      'mcp_servers.huly.command="npx"',
      '-c',
      'mcp_servers.huly.args=["-y","@firfi/huly-mcp@latest"]',
      '-c',
      'mcp_servers.huly.env={"TOOLSETS"="issues,projects"}',
      '-c',
      'mcp_servers.huly.env_vars=["HULY_URL","HULY_TOKEN"]',
    ])
  })

  it('turns a bearer header over a variable into the bearer token variable of an HTTP server', () => {
    const server = { type: 'http', url: 'https://example.com/mcp/', headers: { Authorization: 'Bearer ${EXAMPLE_TOKEN}', 'X-Toolsets': 'issues' } }
    expect(mcpArgs('github', server, ['EXAMPLE_TOKEN'])).toEqual([
      '-c',
      'mcp_servers.github.url="https://example.com/mcp/"',
      '-c',
      'mcp_servers.github.bearer_token_env_var="EXAMPLE_TOKEN"',
      '-c',
      'mcp_servers.github.http_headers={"X-Toolsets"="issues"}',
    ])
  })

  it('is nothing for a server it cannot read', () => {
    expect(mcpArgs('odd', { url: 42 }, [])).toEqual([])
    expect(mcpArgs('odd', undefined, [])).toEqual([])
  })
})
