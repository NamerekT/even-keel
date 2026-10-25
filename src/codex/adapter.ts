import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import type { AgentAdapter } from '../agent/contract.js'
import { runWithInput } from '../agent/oneturn.js'
import { PIN_RETRY_MS, PinnedCli } from '../agent/pinned.js'
import { findBinary } from '../paths.js'
import { appServer } from './appserver.js'
import { CodexCli, listedModels, parseWriteAnswer, resolveCodexBinary, SESSION_MODE, writeArgs } from './cli.js'
import { CODEX } from './name.js'
import { CodexPlugins } from './plugins.js'
import { codexBinaryIn, codexTarget, fetchCodex } from './release.js'
import { foldRollout, readRolloutImage, RolloutFold, rolloutFile, rolloutFiles } from './rollout.js'
import { RolloutTail } from './tail.js'
import { TurnRegistry } from './turns.js'
import { CodexUsage } from './usage.js'

const HISTORY_FEED = 5_000
/** The version the README's "Before you run it" names; raised after the live run of each release (`docs/releases.md`). */
const CHECKED = '0.164.0'

/**
 * Codex CLI through `codex exec --json`: a turn is a detached process, a session lives between turns in Even Keel's
 * registry and its rollout (`docs/sessions.md`). The account is the folder `CODEX_HOME` points at.
 */
export const codex: AgentAdapter = {
  title: 'Codex',
  checked: CHECKED,
  setup({ env, timeoutMs, workDir, checkedCli, version = CHECKED, log, onCliChange }) {
    const target = codexTarget(process.platform, process.arch)
    const copy =
      target === null
        ? undefined
        : new PinnedCli({
            dir: join(workDir, 'cli', CODEX),
            version,
            binary: (folder) => codexBinaryIn(folder, target),
            fetch: (into) => fetchCodex(version, into),
            log,
            onReady: onCliChange,
            retryMs: PIN_RETRY_MS,
          })
    const envOf = (home: AccountHome) => codexEnv(env(), home)
    const bin = () => resolveCodexBinary(env(), env().EVEN_KEEL_CODEX_BIN || !checkedCli() ? undefined : copy?.path())
    const cli = new CodexCli(bin, timeoutMs, envOf, new TurnRegistry(join(workDir, 'codex')), new CodexPlugins(bin, envOf))
    const usage = new CodexUsage({
      timeoutMs,
      sessions: (home) => cli.sessions(home),
      refresh: (home) => appServer(bin(), [], workDir, envOf(home), [['account/read', { refreshToken: true }]]),
    })
    return {
      mode: SESSION_MODE,
      env: envOf,
      launch: (home, start) => usage.session(home, () => cli.launch(home, start)),
      resume: (home, { sessionId }, start) => usage.session(home, () => cli.resume(home, sessionId, start)),
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
        const summary = await foldRollout(home.dir, sessionId, new RolloutFold(Infinity, true))
        return summary === undefined ? undefined : { lines: summary.feed.slice(after), turn: summary.turn }
      },
      feedFile: (home, sessionId) => rolloutFile(home.dir, sessionId),
      image: (home, sessionId, tool, index) => readRolloutImage(home.dir, sessionId, tool, index),
      transcripts: async (home) => (await rolloutFiles(home.dir)).map((rollout) => rollout.id),
      authStatus: (home) => cli.authStatus(home),
      login: (home) => cli.login(home),
      logout: (home) => cli.logout(home),
      installed: () => findBinary(bin(), env()),
      version: () => cli.version(env()),
      usage: (home, at) => usage.read(home, at),
      write: async (home, { cwd, prompt, model, timeoutMs }) => {
        const started = Date.now()
        const stdout = await runWithInput(bin(), writeArgs(model), prompt, { cwd, env: envOf(home), timeoutMs })
        return parseWriteAnswer(stdout, model, Date.now() - started)
      },
      models: async (home) => {
        const [answer] = await appServer(bin(), [], workDir, envOf(home), [['model/list', {}]])
        return { models: listedModels(answer), complete: false }
      },
    }
  },
}

/** The folder of a Codex account other than the default `~/.codex` is reached through `CODEX_HOME`. */
export function codexEnv(base: NodeJS.ProcessEnv, home: AccountHome): NodeJS.ProcessEnv {
  return home.dir === join(homedir(), '.codex') ? { ...base } : { ...base, CODEX_HOME: home.dir }
}
