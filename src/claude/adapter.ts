import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import type { Transport } from '../account/transport.js'
import type { AgentAdapter } from '../agent/contract.js'
import { cliCopy } from '../agent/copy.js'
import { PinnedCli } from '../agent/pinned.js'
import { parseUsage } from '../limits/usage.js'
import { findBinary } from '../paths.js'
import { DEFAULT_LANGUAGE } from '../settings/defaults.js'
import { WARM_CACHE_MS, warmCacheMs } from '../sessions/cache.js'
import { readSessionRecord, readTranscript, readTranscriptImage, transcriptFile } from '../sessions/history.js'
import { transcriptIds } from '../sessions/owners.js'
import { bridgeOfRecord, remoteAtStartup } from '../sessions/remote.js'
import { TranscriptTail } from '../sessions/tail.js'
import { addMarketplace, updateMarketplace, ClaudeCli, liveRecords, resolveClaudeBinary, SESSION_MODE } from './cli.js'
import { parseContextWindow } from './context.js'
import { sweepRefreshLeftovers } from './leftovers.js'
import { agentsFallback } from './instructions.js'
import { CLAUDE } from './name.js'
import { claudeBinaryIn, claudeLatest, fetchClaude } from './release.js'
import { SdkSessions } from './sdk/host.js'
import { SDK_KIND } from './sdk/registry.js'
import { fetchSdk, sdkModuleIn, sdkVersionOf } from './sdk/release.js'

/** The version the README's "Before you run it" names; raised after the live run of each release (`docs/releases.md`). */
const CHECKED = '2.1.310'
/** Even Keel's folder of SDK sessions in `state/` and of the SDK's copies in `state/cli/`. */
const CLAUDE_SDK = 'claude-sdk'
const SDK_TRANSPORT: Transport = 'sdk'
/** What the page offers in the model field: `--model` takes these aliases and any full model id, which is typed in. */
const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'opusplan', 'sonnet[1m]'] as const

/** Claude Code through the `claude` CLI: `--bg` sessions, one `CLAUDE_CONFIG_DIR` per account (`docs/sessions.md`). */
export const claude: AgentAdapter = {
  title: 'Claude Code',
  checked: CHECKED,
  latest: claudeLatest,
  setup({ env, timeoutMs, workDir, checkedCli, version = CHECKED, log, onCliChange, onCliFailure, onCliProgress, transport, unattended, language, onLimits }) {
    const copy = new PinnedCli({
      dir: join(workDir, 'cli', CLAUDE),
      version,
      binary: claudeBinaryIn,
      fetch: (into, progress) => fetchClaude(version, into, progress),
      log,
      onReady: onCliChange,
      onChange: onCliProgress ?? onCliChange,
      onFailure: onCliFailure,
    })
    const pinned = () => (env().EVEN_KEEL_CLAUDE_BIN || !checkedCli() ? undefined : copy.path())
    const envOf = (home: AccountHome) => claudeEnv(env(), home, pinned() !== undefined)
    const bin = () => resolveClaudeBinary(env(), pinned())
    const cli = new ClaudeCli(bin, timeoutMs, envOf)
    const projects = (home: AccountHome) => join(home.dir, 'projects')
    const remoteAt = async (home: AccountHome) => remoteAtStartup(await readText(join(home.dir, 'settings.json')))
    const sdkVersion = sdkVersionOf(version)
    const sdkCopy =
      sdkVersion === null
        ? undefined
        : new PinnedCli({
            dir: join(workDir, 'cli', CLAUDE_SDK),
            version: sdkVersion,
            binary: sdkModuleIn,
            fetch: (into, progress) => fetchSdk(sdkVersion, into, progress),
            log,
            onReady: onCliChange,
            onChange: onCliProgress ?? onCliChange,
            onFailure: onCliFailure,
          })
    const sdk = new SdkSessions({
      dir: join(workDir, CLAUDE_SDK),
      module: () => sdkCopy?.path(),
      bin,
      envOf,
      remote: remoteAt,
      unattended: () => unattended?.() ?? true,
      language: () => language?.() ?? DEFAULT_LANGUAGE,
      onLimits,
      log,
    })
    /** The SDK talks the protocol of its own CLI version, so a session goes through it only on Even Keel's copy of that version. */
    const viaSdk = (home: AccountHome) => {
      if ((transport?.(home) ?? null) !== SDK_TRANSPORT || pinned() === undefined) return false
      if (sdk.ready()) return true
      log(`sessions: the SDK ${sdkVersion ?? '(none for this CLI)'} is not downloaded yet, ${home.key} starts on --bg`)
      return false
    }
    return {
      updateMarketplace: (home, marketplace, timeout) => updateMarketplace(envOf(home), marketplace, timeout, bin()),
      addMarketplace: (home, dir, timeout) => addMarketplace(envOf(home), dir, timeout, bin()),
      cli: cliCopy(copy, { checkedCli }, version, () => findBinary(resolveClaudeBinary(env()), env()), () => !!env().EVEN_KEEL_CLAUDE_BIN, 280 * 1_000_000, sdkCopy),
      mode: SESSION_MODE,
      env: envOf,
      launch: async (home, start) => {
        if (viaSdk(home)) return sdk.launch(home, start)
        const { name, cwd, prompt, model, settings, mcp, plugins } = start
        return (await cli.launch(home, name, cwd, prompt, model, { settings, mcp, plugins, instructions: agentsFallback(cwd) })).sessionId
      },
      resume: async (home, { agentId, sessionId }, start) => {
        if (await sdk.knows(sessionId)) return sdk.resume(home, sessionId, start)
        const { name, cwd, prompt, model, settings, mcp, plugins } = start
        return (await cli.resume(home, agentId, sessionId, name, cwd, prompt, model, { settings, mcp, plugins, instructions: agentsFallback(cwd) })).sessionId
      },
      reply: async (home, { sessionId }, start) => ((await sdk.knows(sessionId)) ? sdk.reply(home, sessionId, start.prompt) : null),
      stop: async (home, { agentId, sessionId }) => ((await sdk.knows(sessionId)) ? sdk.stop(sessionId) : cli.stop(home, agentId, sessionId)),
      sessions: async (home) => {
        const [viaSdkNow, viaBg] = await Promise.all([sdk.sessions(home), cli.agents(home)])
        const known = new Set(viaSdkNow.map((agent) => agent.sessionId))
        return [...viaSdkNow, ...viaBg.filter((agent) => !known.has(agent.sessionId))]
      },
      tail: (home, agent) => new TranscriptTail(projects(home), agent),
      record: (home, sessionId) => readSessionRecord(projects(home), sessionId),
      feed: (home, sessionId, after) => readTranscript(projects(home), sessionId, after),
      feedFile: (home, sessionId) => transcriptFile(projects(home), sessionId),
      image: (home, sessionId, tool, index) => readTranscriptImage(projects(home), sessionId, tool, index),
      transcripts: (home) => transcriptIds(projects(home)),
      authStatus: async (home) => {
        const swept = await sweepRefreshLeftovers(home.dir, Date.now())
        if (swept > 0) log(`account: removed ${swept} abandoned .oauth_refresh.lock.owner.tmp.* files in ${home.key}`)
        return cli.authStatus(home)
      },
      login: (home) => cli.authLogin(home),
      logout: (home) => cli.authLogout(home),
      installed: () => findBinary(bin(), env()),
      version: () => cli.version(env()),
      usage: async (home, at) => parseUsage(await cli.usage(home, workDir), at),
      models: async () => ({ models: [...MODEL_ALIASES], complete: false }),
      contextWindow: async (home, model, settings) => parseContextWindow(await cli.context(home, workDir, model, settings)),
      windowStamp: async (home) => {
        const binary = bin()
        const changed = (file: string) => stat(file).then((info) => info.mtimeMs, () => null)
        return JSON.stringify([binary, await changed(binary), await changed(join(home.dir, 'settings.json'))])
      },
      stopDaemon: (home) => cli.stopDaemon(home),
      pinned: () => (pinned() === undefined ? null : version),
      daemonVersion: (home) => cli.daemonVersion(home),
      write: (home, turn) => cli.write(home, turn),
      warm: async (home, { sessionId }, start) => {
        if (await sdk.knows(sessionId)) return sdk.warm(home, sessionId, start)
        const { cwd, prompt, model, settings, mcp, plugins } = start
        return cli.warm(home, sessionId, cwd, prompt, model, { settings, mcp, plugins, instructions: agentsFallback(cwd) })
      },
      // A subscription's cache lives an hour, a key's as `cacheTtl` wrote it.
      warmMs: (cache, apiKey) => (apiKey ? warmCacheMs(cache?.ttl ?? null) : WARM_CACHE_MS),
      liveRecords,
      remote: {
        enabled: remoteAt,
        bridge: async (home, agent) => {
          if (agent.kind === SDK_KIND) return sdk.bridge(agent.sessionId)
          return agent.pid === undefined ? null : bridgeOfRecord(await readText(join(home.dir, 'sessions', `${agent.pid}.json`)), agent.sessionId)
        },
      },
    }
  },
}

/**
 * A session of a folder other than the global one finds it through `CLAUDE_CONFIG_DIR`. One on the checked copy
 * (`pinned`) must not update the user's own install: the daemon it starts keeps the variable for its sessions.
 */
export function claudeEnv(base: NodeJS.ProcessEnv, home: AccountHome, pinned = false): NodeJS.ProcessEnv {
  return { ...base, ...(home.global ? {} : { CLAUDE_CONFIG_DIR: home.dir }), ...(pinned ? { DISABLE_AUTOUPDATER: '1' } : {}) }
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return undefined
  }
}
