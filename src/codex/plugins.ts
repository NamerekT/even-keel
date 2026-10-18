import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import type { SessionPlugin } from '../agent/contract.js'
import { appServer } from './appserver.js'

const TABLE = /^\s*\[plugins\.(?:"([^"]+)"|'([^']+)'|([^\s"'\]]+))\]\s*$/

/** The plugin's key in Codex: the key paths of `-c` take it unquoted, a quoted one is ignored without a word. */
export function pluginId(plugin: Pick<SessionPlugin, 'name' | 'marketplace'>): string {
  return `${plugin.name}@${plugin.marketplace}`
}

/**
 * The `-c` flags that give a turn the project's plugins: each from its install's marketplace, its own MCP servers off
 * (the gateway serves them), every other plugin of the folder's `config.toml` off, and the plugins' hooks trusted —
 * an untrusted hook is skipped without a word. `hooks.state` goes as one inline table: a key path cannot carry the
 * `/`, `:` and `.` of a hook's key.
 */
export function pluginArgs(plugins: readonly SessionPlugin[], hooks: Record<string, string>, configured: readonly string[]): string[] {
  const set = (key: string, value: string) => ['-c', `${key}=${value}`]
  const own = new Set(plugins.map(pluginId))
  const args = plugins.flatMap((plugin) => {
    const id = pluginId(plugin)
    return [
      ...set(`marketplaces.${plugin.marketplace}.source_type`, '"local"'),
      ...set(`marketplaces.${plugin.marketplace}.source`, JSON.stringify(dirname(dirname(plugin.marketplaceFile)))),
      ...set(`plugins.${id}.enabled`, 'true'),
      ...plugin.servers.flatMap((server) => set(`plugins.${id}.mcp_servers.${server}.enabled`, 'false')),
    ]
  })
  for (const other of configured) if (!own.has(other)) args.push(...set(`plugins.${other}.enabled`, 'false'))
  const trusted = Object.entries(hooks).map(([key, hash]) => `${JSON.stringify(key)}={trusted_hash=${JSON.stringify(hash)}}`)
  if (trusted.length > 0) args.push(...set('hooks.state', `{${trusted.join(',')}}`))
  return args
}

/** The plugins a folder's `config.toml` names; one with a `.` in its key cannot be turned off through `-c`. */
export function configPlugins(toml: string): string[] {
  return toml.split(/\r?\n/).flatMap((line) => {
    const match = TABLE.exec(line)
    const name = match?.[1] ?? match?.[2] ?? match?.[3]
    return name === undefined || name.includes('.') ? [] : [name]
  })
}

/** The `currentHash` of each hook of the plugin in a `hooks/list` answer, by the hook's key. */
export function pluginHooks(answer: unknown, id: string): Record<string, string> {
  const hooks: Record<string, string> = {}
  const data = (answer as { data?: unknown } | undefined)?.data
  for (const each of Array.isArray(data) ? data : []) {
    for (const hook of Array.isArray(each?.hooks) ? each.hooks : []) {
      if (hook?.pluginId === id && typeof hook.key === 'string' && typeof hook.currentHash === 'string') hooks[hook.key] = hook.currentHash
    }
  }
  return hooks
}

/**
 * The project's plugins in the Codex folders: a plugin goes into a folder on the first turn there, the hashes of its
 * hooks are asked once per folder and kept while the service runs — an install never changes.
 */
export class CodexPlugins {
  private readonly hooks = new Map<string, Record<string, string>>()
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly bin: () => string,
    private readonly envOf: (home: AccountHome) => NodeJS.ProcessEnv,
  ) {}

  /** The `-c` flags of a turn; one folder is prepared by one call at a time, since installs write its `config.toml`. */
  async args(home: AccountHome, cwd: string, plugins: readonly SessionPlugin[]): Promise<string[]> {
    const before = this.queues.get(home.dir) ?? Promise.resolve()
    const run = before.catch(() => undefined).then(() => this.prepare(home, cwd, plugins))
    this.queues.set(home.dir, run)
    const hooks = await run
    const configured = configPlugins(await readFile(join(home.dir, 'config.toml'), 'utf8').catch(() => ''))
    return pluginArgs(plugins, hooks, configured)
  }

  private async prepare(home: AccountHome, cwd: string, plugins: readonly SessionPlugin[]): Promise<Record<string, string>> {
    const all: Record<string, string> = {}
    for (const plugin of plugins) {
      const id = pluginId(plugin)
      const key = `${home.dir}\n${id}`
      let hooks = this.hooks.get(key)
      if (hooks === undefined) {
        hooks = await this.install(home, cwd, plugin)
        this.hooks.set(key, hooks)
      }
      Object.assign(all, hooks)
    }
    return all
  }

  /** `plugin/install` turns the plugin on in the folder's `config.toml`: it is turned off again, out of the user's own sessions. */
  private async install(home: AccountHome, cwd: string, plugin: SessionPlugin): Promise<Record<string, string>> {
    const id = pluginId(plugin)
    const env = this.envOf(home)
    if (!existsSync(join(home.dir, 'plugins', 'cache', plugin.marketplace, plugin.name))) {
      await appServer(this.bin(), [], cwd, env, [
        ['plugin/install', { pluginName: plugin.name, marketplacePath: plugin.marketplaceFile }],
        ['config/value/write', { keyPath: `plugins.${id}.enabled`, value: false, mergeStrategy: 'replace' }],
      ])
    }
    const [list] = await appServer(this.bin(), ['-c', `plugins.${id}.enabled=true`], cwd, env, [['hooks/list', {}]])
    return pluginHooks(list, id)
  }
}
