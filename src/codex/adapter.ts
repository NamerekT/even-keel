import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import type { AgentAdapter } from '../agent/contract.js'
import { notice } from '../notice/notice.js'
import { CodexCli, resolveCodexBinary, SESSION_MODE } from './cli.js'
import { CodexPlugins } from './plugins.js'
import { foldRollout, limitsOfRollout, RolloutFold, rolloutFile, rolloutFiles } from './rollout.js'
import { RolloutTail } from './tail.js'
import { TurnRegistry } from './turns.js'

const HISTORY_FEED = 5_000
/** How many of the newest rollouts are searched for the account's limits. */
const LIMIT_ROLLOUTS = 20

/**
 * Codex CLI through `codex exec --json`: a turn is a detached process, a session lives between turns in Even Keel's
 * registry and its rollout (`docs/sessions.md`). The account is the folder `CODEX_HOME` points at.
 */
export const codex: AgentAdapter = {
  title: 'Codex',
  setup({ env, timeoutMs, workDir }) {
    const envOf = (home: AccountHome) => codexEnv(env(), home)
    const bin = () => resolveCodexBinary(env())
    const cli = new CodexCli(bin, timeoutMs, envOf, new TurnRegistry(join(workDir, 'codex')), new CodexPlugins(bin, envOf))
    return {
      mode: SESSION_MODE,
      env: envOf,
      launch: (home, start) => cli.launch(home, start),
      resume: (home, { sessionId }, start) => cli.resume(home, sessionId, start),
      stop: (_home, { sessionId }) => cli.stop(sessionId),
      sessions: (home) => cli.sessions(home),
      tail: (home, agent) => new RolloutTail(home.dir, agent),
      record: async (home, sessionId) => {
        const summary = await foldRollout(home.dir, sessionId, new RolloutFold(HISTORY_FEED))
        if (summary === undefined) return undefined
        return {
          sessionId,
          startedAt: summary.firstActivityAt,
          lastActivityAt: summary.lastActivityAt,
          contextTokens: summary.contextTokens,
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
        const summary = await foldRollout(home.dir, sessionId, new RolloutFold(Infinity, true))
        return summary === undefined ? undefined : { lines: summary.feed.slice(after), turn: summary.turn }
      },
      feedFile: (home, sessionId) => rolloutFile(home.dir, sessionId),
      transcripts: async (home) => (await rolloutFiles(home.dir)).map((rollout) => rollout.id),
      authStatus: (home) => cli.authStatus(home),
      login: (home) => cli.login(home),
      logout: (home) => cli.logout(home),
      usage: async (home, at) => {
        for (const { file } of (await rolloutFiles(home.dir)).slice(0, LIMIT_ROLLOUTS)) {
          const limits = limitsOfRollout(await readFile(file, 'utf8').catch(() => ''))
          if (limits !== undefined) return { kind: 'limits', limits }
        }
        return { kind: 'missing', reason: notice('usage.noRollout', {}) }
      },
    }
  },
}

/** The folder of a Codex account other than the default `~/.codex` is reached through `CODEX_HOME`. */
export function codexEnv(base: NodeJS.ProcessEnv, home: AccountHome): NodeJS.ProcessEnv {
  return home.dir === join(homedir(), '.codex') ? { ...base } : { ...base, CODEX_HOME: home.dir }
}
