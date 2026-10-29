import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import type { AgentAdapter } from '../agent/contract.js'
import { cliCopy } from '../agent/copy.js'
import { isMuslLinux } from '../agent/npm.js'
import { PinnedCli } from '../agent/pinned.js'
import { TurnRegistry } from '../codex/turns.js'
import { askCopilot, askCopilotToken } from '../limits/copilot.js'
import { notice } from '../notice/notice.js'
import { findBinary } from '../paths.js'
import { CopilotCli, resolveCopilotBinary, SESSION_MODE } from './cli.js'
import { copilotEnv, eventsFile, tokenOf } from './home.js'
import { COPILOT } from './name.js'
import { machineToken } from './machine.js'
import { copilotBinaryIn, copilotPackage, fetchCopilot } from './release.js'
import { CopilotTail } from './tail.js'
import { foldEvents } from './transcript.js'
import { withTurnError } from './errors.js'

const HISTORY_FEED = 5_000
/** The version the README's "Before you run it" names; raised after the live run of each release (`docs/releases.md`). */
const CHECKED = '1.0.98'

/**
 * GitHub Copilot CLI through `copilot -p … --output-format json`: a turn is a detached process, as Codex's is; a session
 * lives between turns in Even Keel's registry and the account folder's `session-state/<id>/events.jsonl`
 * (`docs/sessions.md`). The account is a `COPILOT_HOME` with a GitHub token, or none for the CLI's own sign-in. Only a
 * token's monthly allowance or a confirmed `gh-cli` fallback can be read. Sessions run on Even Keel's own copy of the checked
 * version, the platform's npm package, as Codex's do (BTN-347).
 */
export const copilot: AgentAdapter = {
  title: 'GitHub Copilot',
  checked: CHECKED,
  setup({ env, timeoutMs, workDir, checkedCli, version = CHECKED, log, onCliChange, onCliFailure, onCliProgress }) {
    const copy =
      copilotPackage(process.platform, process.arch, isMuslLinux()) === null
        ? undefined
        : new PinnedCli({
            dir: join(workDir, 'cli', COPILOT),
            version,
            binary: (folder) => copilotBinaryIn(folder),
            fetch: (into, progress) => fetchCopilot(version, into, progress),
            log,
            onReady: onCliChange,
            onChange: onCliProgress ?? onCliChange,
            onFailure: onCliFailure,
          })
    const envOf = (home: AccountHome) => copilotEnv(env(), home.dir)
    const bin = () => resolveCopilotBinary(env(), env().EVEN_KEEL_COPILOT_BIN || !checkedCli() ? undefined : copy?.path())
    const registry = new TurnRegistry(join(workDir, COPILOT))
    const cli = new CopilotCli(bin, timeoutMs, envOf, registry)
    const read = (home: AccountHome, sessionId: string) => readFile(eventsFile(home.dir, sessionId), 'utf8').catch(() => undefined)
    return {
      cli: cliCopy(copy, { checkedCli }, version, () => findBinary(resolveCopilotBinary(env()), env()), () => !!env().EVEN_KEEL_COPILOT_BIN, 155 * 1_000_000),
      mode: SESSION_MODE,
      env: envOf,
      launch: (home, start) => cli.launch(home, start),
      resume: (home, { sessionId }, start) => cli.resume(home, sessionId, start),
      stop: (_home, { sessionId }) => cli.stop(sessionId),
      sessions: (home) => cli.sessions(home),
      tail: (home, agent) => new CopilotTail(home.dir, agent, (id) => cli.error(home, id)),
      record: async (home, sessionId) => {
        const text = await read(home, sessionId)
        const error = await cli.error(home, sessionId)
        if (text === undefined && error === undefined) return undefined
        const summary = withTurnError(foldEvents(text ?? '', HISTORY_FEED), error, HISTORY_FEED)
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
        const text = await read(home, sessionId)
        const error = await cli.error(home, sessionId)
        if (text === undefined && error === undefined) return undefined
        const summary = withTurnError(foldEvents(text ?? '', Infinity, true), error, Infinity)
        return { lines: summary.feed.slice(after), turn: summary.turn }
      },
      feedFile: async (home, sessionId) => eventsFile(home.dir, sessionId),
      transcripts: async (home) => [...new Set([...(await sessionIds(home.dir)), ...(await registry.list(home.key)).map((entry) => entry.sessionId)])],
      authStatus: (home) => cli.authStatus(home),
      login: (home) => cli.login(home),
      logout: (home) => cli.logout(home),
      installed: () => findBinary(bin(), env()),
      // As a session runs: without it a binary answers with the newer version it updated itself to.
      version: () => cli.version({ ...env(), COPILOT_AUTO_UPDATE: 'false' }),
      keyUsage: true,
      usage: async (home, at) => {
        const token = tokenOf(home.dir)
        if (token !== null) return askCopilotToken(token, at, timeoutMs)
        const machine = await machineToken(bin(), envOf(home), home.dir, timeoutMs)
        return machine === null ? { kind: 'missing', reason: notice('usage.copilotMachine', {}) } : askCopilot(machine, at, timeoutMs)
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
