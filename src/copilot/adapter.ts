import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import type { AgentAdapter } from '../agent/contract.js'
import { TurnRegistry } from '../codex/turns.js'
import { askCopilotToken } from '../limits/copilot.js'
import { notice } from '../notice/notice.js'
import { findBinary } from '../paths.js'
import { CopilotCli, resolveCopilotBinary, SESSION_MODE } from './cli.js'
import { copilotEnv, eventsFile, tokenOf } from './home.js'
import { COPILOT } from './name.js'
import { CopilotTail } from './tail.js'
import { foldEvents } from './transcript.js'

const HISTORY_FEED = 5_000
/** The version the README's "Before you run it" names; raised after the live run of each release (`docs/releases.md`). */
const CHECKED = '1.0.98'

/**
 * GitHub Copilot CLI through `copilot -p … --output-format json`: a turn is a detached process, as Codex's is; a session
 * lives between turns in Even Keel's registry and the account folder's `session-state/<id>/events.jsonl`
 * (`docs/sessions.md`). The account is a `COPILOT_HOME` with a GitHub token, or none for the CLI's own sign-in. Only a
 * token's monthly allowance can be read (`askCopilotToken`); there is no copy of its own: sessions run on the installed CLI.
 */
export const copilot: AgentAdapter = {
  title: 'GitHub Copilot',
  checked: CHECKED,
  setup({ env, timeoutMs, workDir }) {
    const envOf = (home: AccountHome) => copilotEnv(env(), home.dir)
    const bin = () => resolveCopilotBinary(env())
    const cli = new CopilotCli(bin, timeoutMs, envOf, new TurnRegistry(join(workDir, COPILOT)))
    const read = (home: AccountHome, sessionId: string) => readFile(eventsFile(home.dir, sessionId), 'utf8').catch(() => undefined)
    return {
      mode: SESSION_MODE,
      env: envOf,
      launch: (home, start) => cli.launch(home, start),
      resume: (home, { sessionId }, start) => cli.resume(home, sessionId, start),
      stop: (_home, { sessionId }) => cli.stop(sessionId),
      sessions: (home) => cli.sessions(home),
      tail: (home, agent) => new CopilotTail(home.dir, agent),
      record: async (home, sessionId) => {
        const text = await read(home, sessionId)
        if (text === undefined) return undefined
        const summary = foldEvents(text, HISTORY_FEED)
        return {
          sessionId,
          startedAt: summary.firstActivityAt,
          lastActivityAt: summary.lastActivityAt,
          contextTokens: summary.contextTokens,
          contextWindow: summary.contextWindow,
          tokens: summary.tokens,
          stage: summary.stage,
          feed: summary.feed,
          workdir: summary.workdir,
          branch: summary.gitBranch,
          apiError: summary.apiError?.text ?? null,
          account: null,
        }
      },
      feed: async (home, sessionId, after) => {
        const text = await read(home, sessionId)
        if (text === undefined) return undefined
        const summary = foldEvents(text, Infinity, true)
        return { lines: summary.feed.slice(after), turn: summary.turn }
      },
      feedFile: async (home, sessionId) => eventsFile(home.dir, sessionId),
      transcripts: (home) => sessionIds(home.dir),
      authStatus: (home) => cli.authStatus(home),
      login: (home) => cli.login(home),
      logout: (home) => cli.logout(home),
      installed: () => findBinary(bin(), env()),
      version: () => cli.version(env()),
      keyUsage: true,
      usage: async (home, at) => {
        const token = tokenOf(home.dir)
        if (token === null) return { kind: 'missing', reason: notice('usage.copilotMachine', {}) }
        return askCopilotToken(token, at, timeoutMs)
      },
    }
  },
}

/** The sessions whose transcript the folder holds: `session-state/<id>/` with an `events.jsonl` in it. */
async function sessionIds(dir: string): Promise<string[]> {
  const root = join(dir, 'session-state')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const ids = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name)
  const held = await Promise.all(ids.map((id) => readdir(join(root, id)).then((names) => names.includes('events.jsonl'), () => false)))
  return ids.filter((_, index) => held[index])
}
