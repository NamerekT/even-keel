import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import type { AgentAdapter } from '../agent/contract.js'
import { PIN_RETRY_MS, PinnedCli } from '../agent/pinned.js'
import { parseUsage } from '../limits/usage.js'
import { findBinary } from '../paths.js'
import { readSessionRecord, readTranscript, readTranscriptImage, transcriptFile } from '../sessions/history.js'
import { transcriptIds } from '../sessions/owners.js'
import { bridgeOfRecord, remoteAtStartup } from '../sessions/remote.js'
import { TranscriptTail } from '../sessions/tail.js'
import { ClaudeCli, liveRecords, resolveClaudeBinary, SESSION_MODE } from './cli.js'
import { CLAUDE } from './name.js'
import { claudeBinaryIn, fetchClaude } from './release.js'

/** The version the README's "Before you run it" names; raised after the live run of each release (`docs/releases.md`). */
const CHECKED = '2.1.303'

/** Claude Code through the `claude` CLI: `--bg` sessions, one `CLAUDE_CONFIG_DIR` per account (`docs/sessions.md`). */
export const claude: AgentAdapter = {
  title: 'Claude Code',
  checked: CHECKED,
  setup({ env, timeoutMs, workDir, checkedCli, version = CHECKED, log, onCliChange }) {
    const copy = new PinnedCli({
      dir: join(workDir, 'cli', CLAUDE),
      version,
      binary: claudeBinaryIn,
      fetch: (into) => fetchClaude(version, into),
      log,
      onReady: onCliChange,
      retryMs: PIN_RETRY_MS,
    })
    const pinned = () => (env().EVEN_KEEL_CLAUDE_BIN || !checkedCli() ? undefined : copy.path())
    const envOf = (home: AccountHome) => claudeEnv(env(), home, pinned() !== undefined)
    const bin = () => resolveClaudeBinary(env(), pinned())
    const cli = new ClaudeCli(bin, timeoutMs, envOf)
    const projects = (home: AccountHome) => join(home.dir, 'projects')
    return {
      mode: SESSION_MODE,
      env: envOf,
      launch: async (home, { name, cwd, prompt, model, settings, mcp, plugins }) =>
        (await cli.launch(home, name, cwd, prompt, model, { settings, mcp, plugins })).sessionId,
      resume: async (home, { agentId, sessionId }, { name, cwd, prompt, model, settings, mcp, plugins }) =>
        (await cli.resume(home, agentId, sessionId, name, cwd, prompt, model, { settings, mcp, plugins })).sessionId,
      stop: (home, { agentId, sessionId }) => cli.stop(home, agentId, sessionId),
      sessions: (home) => cli.agents(home),
      tail: (home, agent) => new TranscriptTail(projects(home), agent),
      record: (home, sessionId) => readSessionRecord(projects(home), sessionId),
      feed: (home, sessionId, after) => readTranscript(projects(home), sessionId, after),
      feedFile: (home, sessionId) => transcriptFile(projects(home), sessionId),
      image: (home, sessionId, tool, index) => readTranscriptImage(projects(home), sessionId, tool, index),
      transcripts: (home) => transcriptIds(projects(home)),
      authStatus: (home) => cli.authStatus(home),
      login: (home) => cli.authLogin(home),
      logout: (home) => cli.authLogout(home),
      installed: () => findBinary(bin(), env()),
      version: () => cli.version(env()),
      usage: async (home, at) => parseUsage(await cli.usage(home, workDir), at),
      stopDaemon: (home) => cli.stopDaemon(home),
      pinned: () => (pinned() === undefined ? null : version),
      daemonVersion: (home) => cli.daemonVersion(home),
      write: (home, turn) => cli.write(home, turn),
      liveRecords,
      remote: {
        enabled: async (home) => remoteAtStartup(await readText(join(home.dir, 'settings.json'))),
        bridge: async (home, agent) =>
          agent.pid === undefined ? null : bridgeOfRecord(await readText(join(home.dir, 'sessions', `${agent.pid}.json`)), agent.sessionId),
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
