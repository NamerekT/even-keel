import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import { CodexPlugins, configPlugins, pluginArgs, pluginId, pluginHooks, untrustedHooks } from './plugins.js'

const cache = join('C:', 'state', 'packages', 'huly@even-keel', 'b')
const huly = { package: 'huly@even-keel', dir: join(cache, 'plugin'), name: 'huly', marketplace: 'ek-b', marketplaceFile: join(cache, '.claude-plugin', 'marketplace.json'), servers: ['huly'] }

describe('pluginArgs', () => {
  it('declares the install marketplace, turns the plugin on and its own servers off', () => {
    expect(pluginArgs([huly], {}, [])).toEqual([
      '-c',
      'marketplaces.ek-b.source_type="local"',
      '-c',
      `marketplaces.ek-b.source=${JSON.stringify(cache)}`,
      '-c',
      'plugins.huly@ek-b.enabled=true',
      '-c',
      'plugins.huly@ek-b.mcp_servers.huly.enabled=false',
    ])
  })

  it('trusts the hooks by their hashes in one inline table and turns the other plugins off', () => {
    const hooks = { 'huly@ek-b:hooks/hooks.json:pre_tool_use:0:0': 'sha256:aa', 'huly@ek-b:hooks/hooks.json:stop:0:0': 'sha256:bb' }
    const args = pluginArgs([{ ...huly, servers: [] }], hooks, ['browser@openai-bundled', 'huly@ek-b'])
    expect(args.slice(6)).toEqual([
      '-c',
      'plugins.browser@openai-bundled.enabled=false',
      '-c',
      'hooks.state={"huly@ek-b:hooks/hooks.json:pre_tool_use:0:0"={trusted_hash="sha256:aa"},"huly@ek-b:hooks/hooks.json:stop:0:0"={trusted_hash="sha256:bb"}}',
    ])
  })

  it('turns the folder plugins off when the set has none', () => {
    expect(pluginArgs([], {}, ['browser@openai-bundled'])).toEqual(['-c', 'plugins.browser@openai-bundled.enabled=false'])
  })

  it('disables the old bridge and trusts hooks under the new plugin name', () => {
    const bridge = { ...huly, package: 'agent-bridge@even-keel', name: 'agent-bridge', servers: [] }
    const id = pluginId(bridge)
    const key = `${id}:hooks/hooks.json:stop:0:0`
    const hooks = pluginHooks({ data: [{ hooks: [
      { pluginId: id, key, currentHash: 'sha256:new/sha256:contents' },
      { pluginId: 'checkpoint@ek-a', key: 'old-key', currentHash: 'sha256:old' },
    ] }] }, id)
    expect(id).toBe('agent-bridge@ek-b')
    expect(hooks).toEqual({ [key]: 'sha256:new' })
    const old = 'checkpoint@ek-a'
    const args = pluginArgs([bridge], hooks, [old, id])
    expect(args).toContain(`plugins.${old}.enabled=false`)
    expect(args).toContain(`plugins.${id}.enabled=true`)
    expect(args).toContain(`hooks.state={"${key}"={trusted_hash="sha256:new"}}`)
  })
})

describe('configPlugins', () => {
  it('names every plugin table of config.toml, quoted or not', () => {
    const toml = [
      'model = "x"',
      '[plugins."browser@openai-bundled"]',
      'enabled = true',
      '',
      '[plugins.\'pdf@runtime\']',
      'enabled = false',
      '[plugins.bare@market]',
      '[plugins."a@m".mcp_servers.s]',
      '[marketplaces.even-keel]',
    ].join('\r\n')
    expect(configPlugins(toml)).toEqual(['browser@openai-bundled', 'pdf@runtime', 'bare@market'])
  })

  it('skips a name a -c key path cannot carry', () => {
    expect(configPlugins('[plugins."a.b@m"]\n')).toEqual([])
  })
})

describe('pluginHooks', () => {
  it('keeps the hashes of the plugin hooks by key', () => {
    const answer = {
      data: [
        {
          cwd: 'D:\\repo',
          hooks: [
            { key: 'huly@ek-b:hooks/hooks.json:pre_tool_use:0:0', pluginId: 'huly@ek-b', currentHash: 'sha256:aa' },
            { key: 'other@m:hooks/hooks.json:stop:0:0', pluginId: 'other@m', currentHash: 'sha256:cc' },
            { key: 'broken', pluginId: 'huly@ek-b' },
          ],
        },
      ],
    }
    expect(pluginHooks(answer, pluginId(huly))).toEqual({ 'huly@ek-b:hooks/hooks.json:pre_tool_use:0:0': 'sha256:aa' })
    expect(pluginHooks(undefined, 'huly@ek-b')).toEqual({})
  })

  it('keeps only the hook half of a 0.164.0 hash: the plugin half is never trusted', () => {
    const answer = {
      data: [
        {
          cwd: 'D:\\repo',
          hooks: [{ key: 'huly@ek-b:hooks/hooks.json:stop:0:0', pluginId: 'huly@ek-b', currentHash: 'sha256:aa/sha256:pp', trustStatus: 'untrusted' }],
        },
      ],
    }
    expect(pluginHooks(answer, 'huly@ek-b')).toEqual({ 'huly@ek-b:hooks/hooks.json:stop:0:0': 'sha256:aa' })
  })
})

describe('untrustedHooks', () => {
  const keys = ['huly@ek-b:hooks/hooks.json:pre_tool_use:0:0', 'huly@ek-b:hooks/hooks.json:stop:0:0']
  const listed = (...statuses: string[]) => ({
    data: [{ cwd: 'D:\\repo', hooks: statuses.map((trustStatus, i) => ({ key: keys[i], pluginId: 'huly@ek-b', currentHash: 'sha256:aa', trustStatus })) }],
  })

  it('passes when every hook of the plugin is trusted', () => {
    expect(untrustedHooks(listed('trusted', 'trusted'), 'huly@ek-b', keys)).toEqual([])
  })

  it('names each hook Codex does not trust, with its status', () => {
    expect(untrustedHooks(listed('modified', 'untrusted'), 'huly@ek-b', keys)).toEqual([
      { key: keys[0], status: 'modified' },
      { key: keys[1], status: 'untrusted' },
    ])
  })

  it('counts a hook gone from the answer or without a status as not trusted', () => {
    const answer = { data: [{ hooks: [{ key: keys[0], pluginId: 'huly@ek-b', currentHash: 'sha256:aa' }] }] }
    expect(untrustedHooks(answer, 'huly@ek-b', keys)).toEqual([
      { key: keys[0], status: 'unknown' },
      { key: keys[1], status: 'missing' },
    ])
  })
})

describe('CodexPlugins', () => {
  let dir: string
  let home: AccountHome
  let methods: string[]
  let lines: string[]
  const call = async (_bin: string, _config: string[], _cwd: string, _env: NodeJS.ProcessEnv, calls: Array<[string, unknown]>) => {
    methods.push(...calls.map(([method]) => method))
    return calls.map(() => ({ data: [] }))
  }
  const plugins = () => new CodexPlugins(() => 'codex', () => ({}), (line) => lines.push(line), call)

  beforeEach(async () => {
    await mkdir('.temp', { recursive: true })
    dir = await mkdtemp(join('.temp', 'codex-plugins-'))
    home = { key: 'john-doe', dir, global: false, agent: 'codex' }
    methods = []
    lines = []
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('logs one install per folder and service run, without the folder path or its account', async () => {
    const codex = plugins()
    await codex.args(home, dir, [huly])
    await codex.args(home, dir, [huly])
    expect(methods.filter((method) => method === 'plugin/install')).toHaveLength(1)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^codex plugins: huly@ek-b installed into folder [0-9a-f]{8} in \d+(\.\d)? s$/)
    expect(lines[0]).not.toContain(dir)
    expect(lines[0]).not.toContain('john-doe')
  })

  it('logs a folder whose cache already holds the plugin, and installs nothing there', async () => {
    await mkdir(join(dir, 'plugins', 'cache', 'ek-b', 'huly'), { recursive: true })
    const codex = plugins()
    await codex.args(home, dir, [huly])
    await codex.args(home, dir, [huly])
    expect(methods).not.toContain('plugin/install')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^codex plugins: huly@ek-b found in the cache of folder [0-9a-f]{8}$/)
  })

  it('names two folders apart', async () => {
    const other = { ...home, key: 'jane-doe', dir: join(dir, 'other') }
    const codex = plugins()
    await codex.args(home, dir, [huly])
    await codex.args(other, dir, [huly])
    const folders = lines.map((line) => /folder ([0-9a-f]{8})/.exec(line)?.[1])
    expect(new Set(folders).size).toBe(2)
  })
})
