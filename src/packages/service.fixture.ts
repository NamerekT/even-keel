import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ServerEntry } from './model.js'
import { Packages } from './service.js'
import { savePackages } from './store.js'

let dir: string | undefined

/** The folder of the last `fixture()`. */
export function fixtureDir(): string {
  return dir!
}

export function cleanFixture(): void {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
}

/** A catalog of one plugin package `tools@example` from Even Keel's own marketplace, not installed yet. */
export function fixture() {
  dir = mkdtempSync(join(tmpdir(), 'even-keel-package-settings-'))
  const home = dir
  const put = (path: string, value: unknown) => {
    const file = join(home, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(value))
  }
  const plugin = (version: string, toolsets: string, server: ServerEntry = { command: 'example-server' }) => {
    put('own/.claude-plugin/marketplace.json', { name: 'example', plugins: [{ name: 'tools', source: './plugin' }] })
    put('own/plugin/.claude-plugin/plugin.json', { name: 'tools', version })
    put('own/plugin/.mcp.json', { mcpServers: { tools: { ...server, env: { TOOLSETS: toolsets, MODE: 'fast' } } } })
  }
  plugin('1.0.0', 'workitems,milestones')
  const file = join(home, 'state/packages.json')
  savePackages(file, {
    packages: { 'tools@example': { kind: 'plugin', plugin: { name: 'tools', marketplace: 'example' }, default: true, settings: {}, installs: [] } },
    projects: {}, pins: {},
  })
  const deps = {
    file, cache: join(home, 'state/packages'), envFile: join(home, '.env'), repos: { project: home },
    globalDir: join(home, 'global'), ownDir: join(home, 'own'), skillsDir: join(home, 'skills'),
    claudeConfigs: () => [], rules: { aliases: {}, trackers: [] }, tracker: () => undefined,
    agentOf: () => 'claude', updateMarketplace: async () => {}, addMarketplace: async () => {},
    baseEnv: () => ({}), poolOf: () => ({}), port: 0, log: (line: string) => void lines.push(line), onChange: () => {},
  }
  const lines: string[] = []
  return { packages: new Packages(deps), deps, file, cache: deps.cache, plugin, lines, reload: () => new Packages(deps) }
}
