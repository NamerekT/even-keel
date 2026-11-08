import { describe, expect, it } from 'vitest'
import { TRACKER_SERVERS } from '../../web/src/tools/trackerServers.js'
import { ADAPTERS } from './adapters.js'

describe('TRACKER_SERVERS of the page', () => {
  it('names every tracker adapter’s MCP server', () => {
    const servers = Object.values(ADAPTERS).flatMap((adapter) => (adapter.mcpServer === undefined ? [] : [adapter.mcpServer]))
    expect([...TRACKER_SERVERS].sort()).toEqual([...new Set(servers)].sort())
  })
})
