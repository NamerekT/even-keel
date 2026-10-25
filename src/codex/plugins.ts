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

/** A hook of the plugin that Codex would skip on a turn, with the `trustStatus` it gave or `missing`/`unknown`. */
export interface UntrustedHook {
  key: string
  status: string
}

/** Codex would skip these hooks of the package: a launch without them would lose `merge-check`, the reminders and the mail. */
export class UntrustedHooks extends Error {
  constructor(
    readonly plugin: SessionPlugin,
    readonly hooks: UntrustedHook[],
  ) {
    super(`codex does not trust the hooks of ${plugin.package}: ${hooks.map((hook) => `${hook.key} ${hook.status}`).join(', ')}`)
  }
}

function listedHooks(answer: unknown, id: string): Array<{ key: string; currentHash?: unknown; trustStatus?: unknown }> {
  const data = (answer as { data?: unknown } | undefined)?.data
  return (Array.isArray(data) ? data : []).flatMap((each) =>
    (Array.isArray(each?.hooks) ? each.hooks : []).filter((hook: { pluginId?: unknown; key?: unknown } | null) => hook?.pluginId === id && typeof hook.key === 'string'),
  )
}

/**
 * The hash to trust each hook of the plugin by, from a `hooks/list` answer, by the hook's key. From 0.164.0 the
 * `currentHash` is `<hook hash>/<plugin contents hash>` and `trusted_hash` takes only the hook's half.
 */
export function pluginHooks(answer: unknown, id: string): Record<string, string> {
  const hooks: Record<string, string> = {}
  for (const hook of listedHooks(answer, id)) if (typeof hook.currentHash === 'string') hooks[hook.key] = hook.currentHash.replace(/\/.*$/s, '')
  return hooks
}

/** The hooks of `keys` that a `hooks/list` answer asked with a turn's flags does not mark `trusted`. */
export function untrustedHooks(answer: unknown, id: string, keys: readonly string[]): UntrustedHook[] {
  const status = new Map(listedHooks(answer, id).map((hook) => [hook.key, typeof hook.trustStatus === 'string' ? hook.trustStatus : 'unknown']))
  return keys.flatMap((key) => {
    const each = status.get(key) ?? 'missing'
    return each === 'trusted' ? [] : [{ key, status: each }]
  })
}

/**
 * The project's plugins in the Codex folders: a plugin goes into a folder on the first turn there, the hashes of its
 * hooks are asked once per folder and kept while the service runs — an install never changes. Before they are kept,
 * `hooks/list` is asked again with the turn's flags: a hook Codex does not trust there fails the launch, so a change of
 * the hash format cannot turn the hooks off without a word.
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
    const hooks = pluginHooks(list, id)
    const keys = Object.keys(hooks)
    if (keys.length === 0) return hooks
    const configured = configPlugins(await readFile(join(home.dir, 'config.toml'), 'utf8').catch(() => ''))
    const [check] = await appServer(this.bin(), pluginArgs([plugin], hooks, configured), cwd, env, [['hooks/list', {}]])
    const untrusted = untrustedHooks(check, id, keys)
    if (untrusted.length > 0) throw new UntrustedHooks(plugin, untrusted)
    return hooks
  }
}
