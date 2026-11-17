import { describe, expect, it } from 'vitest'
import { trackerKeyRules } from '../tracker/adapters.js'
import { packageTarget } from './hub.js'
import type { PackagesFile } from './model.js'
import { missingCommands, stdioOf, withOverride } from './stdio.js'

const FILE = {
  packages: {
    files: { kind: 'mcp', default: true, settings: {}, installs: [{ id: 'i1', version: null, at: 0, servers: { files: { entry: { command: 'files-mcp', args: ['/home/example'] }, npm: null } }, extras: [] }] },
  },
  projects: {},
  pins: {},
} as unknown as PackagesFile

const ROUTE = { project: 'p1', name: 'files', install: 'i1', server: 'files' }

describe("a stdio server's command on a machine (BTN-994)", () => {
  it('reads the command of a stdio entry only', () => {
    expect(stdioOf('files', 'files', { command: 'files-mcp', args: ['/a', 3] })).toEqual({ package: 'files', server: 'files', command: 'files-mcp', args: ['/a'] })
    expect(stdioOf('web', 'web', { type: 'http', url: 'https://mcp.example.com' })).toBeUndefined()
  })

  it("puts the machine's command and arguments in place of the catalog's, each on its own", () => {
    expect(withOverride({ command: 'a', args: ['x'], env: { K: '1' } }, { command: 'b' })).toEqual({ command: 'b', args: ['x'], env: { K: '1' } })
    expect(withOverride({ command: 'a', args: ['x'] }, { args: ['y'] })).toEqual({ command: 'a', args: ['y'] })
    expect(withOverride({ url: 'https://mcp.example.com' }, { command: 'b' })).toEqual({ url: 'https://mcp.example.com' })
  })

  it("resolves the gateway's target with the machine's command", () => {
    const deps = { rules: trackerKeyRules(), poolOf: () => ({}) }
    expect(packageTarget(FILE, deps, ROUTE)?.entry).toMatchObject({ command: 'files-mcp', args: ['/home/example'] })
    const own = { ...deps, serverOverride: () => ({ command: '/opt/example/files-mcp', args: ['/srv/example'] }) }
    expect(packageTarget(FILE, own, ROUTE)?.entry).toMatchObject({ command: '/opt/example/files-mcp', args: ['/srv/example'] })
  })

  it('names each server whose command is not found', () => {
    const servers = [stdioOf('files', 'files', { command: 'files-mcp' })!, stdioOf('git', 'git', { command: 'git-mcp' })!]
    expect(missingCommands(servers, (command) => command === 'git-mcp')).toEqual(['files/files (files-mcp)'])
  })
})
