import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import type { AgentAdapter } from '../agent/contract.js'
import { runWithInput } from '../agent/oneturn.js'
import { PIN_RETRY_MS, PinnedCli } from '../agent/pinned.js'
import { chatGptAccountIn, chatGptPool, chatGptSignInIn, pollChatGpt } from '../limits/chatgpt.js'
import { notice } from '../notice/notice.js'
import { findBinary } from '../paths.js'
import { appServer } from './appserver.js'
import { CodexCli, listedModels, parseWriteAnswer, resolveCodexBinary, SESSION_MODE, writeArgs } from './cli.js'
import { CODEX } from './name.js'
import { CodexPlugins } from './plugins.js'
import { codexBinaryIn, codexTarget, fetchCodex } from './release.js'
import { foldRollout, limitsOfRollout, RolloutFold, rolloutFile, rolloutFiles } from './rollout.js'
import { RolloutTail } from './tail.js'
import { TurnRegistry } from './turns.js'

const HISTORY_FEED = 5_000
/** How many of the newest rollouts are searched for the account's limits. */
const LIMIT_ROLLOUTS = 20
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
      transcripts: async (home) => (await rolloutFiles(home.dir)).map((rollout) => rollout.id),
      authStatus: (home) => cli.authStatus(home),
      login: (home) => cli.login(home),
      logout: (home) => cli.logout(home),
      installed: () => findBinary(bin(), env()),
      version: () => cli.version(env()),
      usage: async (home, at) => {
        const auth = await readFile(join(home.dir, 'auth.json'), 'utf8').catch(() => undefined)
        const signIn = chatGptSignInIn(auth)
        if (signIn !== undefined) {
          const answer = await pollChatGpt(signIn, at, timeoutMs).catch(() => undefined)
          if (answer?.kind === 'limits') return answer
        }
        const account = chatGptAccountIn(auth)
        for (const { file } of (await rolloutFiles(home.dir)).slice(0, LIMIT_ROLLOUTS)) {
          const limits = limitsOfRollout(await readFile(file, 'utf8').catch(() => ''))
          if (limits !== undefined) return { kind: 'limits', limits: account === null ? limits : { ...limits, pool: chatGptPool(account) } }
        }
        return { kind: 'missing', reason: notice('usage.noRollout', {}) }
      },
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
