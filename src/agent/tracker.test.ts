import { describe, expect, it } from 'vitest'
import { trackerServerOf } from './tracker.js'

describe('trackerServerOf', () => {
  const stdio = { mcpServers: { huly: { command: 'npx', args: ['-y', 'huly-mcp'], env: { TOOLSETS: 'issues' } } } }
  const http = { mcpServers: { github: { type: 'http', url: 'https://example.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_PAT}' } } } }

  it("takes the plugin's server and the adapter's variables, the user's settings over the service's environment", () => {
    const server = trackerServerOf('huly', stdio, ['HULY_URL', 'HULY_EMAIL', 'HULY_PASSWORD'], [{ HULY_URL: 'https://huly.example.com', HULY_EMAIL: 'john.doe@example.com' }, { HULY_URL: 'https://old.example.com', HULY_PASSWORD: 'secret' }])
    expect(server).toEqual({
      name: 'huly',
      server: stdio.mcpServers.huly,
      env: { HULY_URL: 'https://huly.example.com', HULY_EMAIL: 'john.doe@example.com', HULY_PASSWORD: 'secret' },
    })
  })

  it('adds the variables the server names in its placeholders', () => {
    expect(trackerServerOf('github', http, ['GITHUB_TOKEN'], [{}, { GITHUB_TOKEN: 'a', GITHUB_PAT: 'b' }])?.env).toEqual({ GITHUB_TOKEN: 'a', GITHUB_PAT: 'b' })
  })

  it('gives nothing for a plugin without the server', () => {
    expect(trackerServerOf('huly', undefined, [], [])).toBeUndefined()
    expect(trackerServerOf('linear', stdio, [], [])).toBeUndefined()
  })
})
