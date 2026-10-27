import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import type { AgentAdapter } from '../agent/contract.js'
import { isMuslLinux } from '../agent/npm.js'
import { PIN_RETRY_MS, PinnedCli } from '../agent/pinned.js'
import { TurnRegistry } from '../codex/turns.js'
import { findBinary } from '../paths.js'
import { OpenCodeCli, resolveOpenCodeBinary, SESSION_MODE } from './cli.js'
import { sessionImage, sessionList, sessionRows } from './db.js'
import { openCodeEnv, readAuth } from './home.js'
import { OPENCODE } from './name.js'
import { fetchOpenCode, openCodeBinaryIn, openCodePackage } from './release.js'
import { OpenCodeTail } from './tail.js'
import { foldSession } from './transcript.js'
import { openCodeUsage } from './usage.js'

const HISTORY_FEED = 5_000
/** The version the README's "Before you run it" names; raised after the live run of each release (`docs/releases.md`). */
const CHECKED = '1.18.25'

/**
 * OpenCode through `opencode run --format json`: a turn is a detached process, as Codex's is; a session lives between
 * turns in Even Keel's registry and the account's `opencode.db` (`docs/sessions.md`). The account is a folder of the
 * four XDG folders. Its limits are its sign-in's, asked of ChatGPT or GitHub (`openCodeUsage`). Sessions run on Even
 * Keel's own copy of the checked version, the platform's npm package, as Codex's do (BTN-347).
 */
export const opencode: AgentAdapter = {
  title: 'OpenCode',
  checked: CHECKED,
  setup({ env, timeoutMs, workDir, checkedCli, version = CHECKED, log, onCliChange }) {
    const copy =
      openCodePackage(process.platform, process.arch, isMuslLinux()) === null
        ? undefined
        : new PinnedCli({
            dir: join(workDir, 'cli', OPENCODE),
            version,
            binary: (folder) => openCodeBinaryIn(folder),
            fetch: (into) => fetchOpenCode(version, into),
            log,
            onReady: onCliChange,
            retryMs: PIN_RETRY_MS,
          })
    const envOf = (home: AccountHome) => openCodeEnv(env(), home.dir)
    const bin = () => resolveOpenCodeBinary(env(), env().EVEN_KEEL_OPENCODE_BIN || !checkedCli() ? undefined : copy?.path())
    const cli = new OpenCodeCli(bin, timeoutMs, envOf, new TurnRegistry(join(workDir, OPENCODE)))
    return {
      mode: SESSION_MODE,
      env: envOf,
      launch: (home, start) => cli.launch(home, start),
      resume: (home, { sessionId }, start) => cli.resume(home, sessionId, start),
      stop: (_home, { sessionId }) => cli.stop(sessionId),
      sessions: (home) => cli.sessions(home),
      tail: (home, agent) => new OpenCodeTail(home.dir, agent, (sessionId) => cli.turnErrors(sessionId)),
      record: async (home, sessionId) => {
        const rows = await sessionRows(home.dir, sessionId)
        if (rows === undefined) return undefined
        const summary = foldSession(rows.messages, rows.parts, HISTORY_FEED, false, await cli.turnErrors(sessionId))
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
          ...(summary.apiError?.notice === undefined ? {} : { apiErrorNotice: summary.apiError.notice }),
          account: null,
        }
      },
      feed: async (home, sessionId, after) => {
        const rows = await sessionRows(home.dir, sessionId)
        if (rows === undefined) return undefined
        const summary = foldSession(rows.messages, rows.parts, Infinity, true, await cli.turnErrors(sessionId))
        return { lines: summary.feed.slice(after), turn: summary.turn }
      },
      transcripts: async (home) => (await sessionList(home.dir)).map((session) => session.id),
      image: (home, sessionId, tool, index) => sessionImage(home.dir, sessionId, tool, index),
      usage: (home, at) => openCodeUsage(readAuth(home.dir), at, timeoutMs),
      authStatus: (home) => cli.authStatus(home),
      login: (home, method) => cli.login(home, method),
      logout: (home) => cli.logout(home),
      installed: () => findBinary(bin(), env()),
      version: () => cli.version(env()),
      write: (home, turn) => cli.write(home, turn),
      // `run -m` takes nothing but `<provider>/<model>` of a provider the account is signed in to; an empty list says nothing.
      models: async (home) => {
        const models = await cli.models(home)
        return { models, complete: models.length > 0 }
      },
      contextWindow: async (home, model) => windowOf(await readFile(join(home.dir, 'cache', 'opencode', 'models.json'), 'utf8').catch(() => ''), model),
    }
  },
}

/**
 * The context window of `<provider>/<model>` in OpenCode's copy of the models.dev catalogue (`<cache>/opencode/models.json`,
 * `{ <provider>: { models: { <model>: { limit: { context } } } } }`); `null` when the catalogue has no such model.
 */
export function windowOf(catalogue: string, model: string): number | null {
  const slash = model.indexOf('/')
  if (slash <= 0) return null
  try {
    const context: unknown = JSON.parse(catalogue)?.[model.slice(0, slash)]?.models?.[model.slice(slash + 1)]?.limit?.context
    return typeof context === 'number' && context > 0 ? context : null
  } catch {
    return null
  }
}
