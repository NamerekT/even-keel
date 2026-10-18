import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import type { AgentAdapter } from '../agent/contract.js'
import { parseUsage } from '../limits/usage.js'
import { readSessionRecord, readTranscript, readTranscriptImage, transcriptFile } from '../sessions/history.js'
import { transcriptIds } from '../sessions/owners.js'
import { bridgeOfRecord, remoteAtStartup } from '../sessions/remote.js'
import { TranscriptTail } from '../sessions/tail.js'
import { ClaudeCli, liveRecords, resolveClaudeBinary, SESSION_MODE } from './cli.js'

/** Claude Code through the `claude` CLI: `--bg` sessions, one `CLAUDE_CONFIG_DIR` per account (`docs/sessions.md`). */
export const claude: AgentAdapter = {
  title: 'Claude Code',
  setup({ env, timeoutMs, workDir }) {
    const envOf = (home: AccountHome) => claudeEnv(env, home)
    const cli = new ClaudeCli(() => resolveClaudeBinary(env), timeoutMs, envOf)
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
      usage: async (home, at) => parseUsage(await cli.usage(home, workDir), at),
      stopDaemon: (home) => cli.stopDaemon(home),
      liveRecords,
      remote: {
        enabled: async (home) => remoteAtStartup(await readText(join(home.dir, 'settings.json'))),
        bridge: async (home, agent) =>
          agent.pid === undefined ? null : bridgeOfRecord(await readText(join(home.dir, 'sessions', `${agent.pid}.json`)), agent.sessionId),
      },
    }
  },
}

/** A session of a folder other than the global one finds it through `CLAUDE_CONFIG_DIR`. */
export function claudeEnv(base: NodeJS.ProcessEnv, home: AccountHome): NodeJS.ProcessEnv {
  return home.global ? { ...base } : { ...base, CLAUDE_CONFIG_DIR: home.dir }
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return undefined
  }
}
