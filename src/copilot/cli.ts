import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, openSync, readdirSync, readFileSync } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { AccountHome } from '../account/homes.js'
import type { AccountStatus } from '../account/model.js'
import { gatewayName, type SessionStart } from '../agent/contract.js'
import { isAlive, killTree } from '../agent/process.js'
import { polledProcessStartedAt, processBelongsToTurn, processStartedAt, turnStartedAt } from '../codex/process.js'
import { entryOf, lastEvent, outputTail, type CodexSession, type TurnRegistry } from '../codex/turns.js'
import { fail, notice, NoticeError, type Notice } from '../notice/notice.js'
import type { AgentEntry } from '../sessions/agents.js'
import { eventsFile, parseAuth, tokenFile, tokenOf } from './home.js'
import { COPILOT } from './name.js'
import { protectionRules } from '../sessions/protection.js'
import { modelRefusal, outputError, type TurnError } from './errors.js'

const run = promisify(execFile)

/** The transcript appears with the session's first event, before the model is asked. */
const APPEAR_TIMEOUT_MS = 120_000
const POLL_MS = 500
const STOP_TIMEOUT_MS = 30_000
const GIT_TIMEOUT_MS = 10_000

/**
 * Chain sessions run without a human: every tool is allowed and `--no-ask-user` takes the question tool away, so a
 * question is the text a turn ends with. Paths outside the session's folder are allowed one by one (`--add-dir`), the
 * main checkout a merge goes into among them. Copilot has no OS sandbox, so there is no `execution.copilot`.
 */
export const SESSION_MODE = 'allow-all-tools'

/**
 * `EVEN_KEEL_COPILOT_BIN`, else Even Keel's own copy of the checked version (`pinned`, BTN-347), else on Windows the
 * `copilot.exe` winget installed (its folder is on the user's PATH only through a link the service may not see), else
 * `copilot` on the PATH.
 */
export function resolveCopilotBinary(env: NodeJS.ProcessEnv, pinned?: string): string {
  if (env.EVEN_KEEL_COPILOT_BIN) return env.EVEN_KEEL_COPILOT_BIN
  if (pinned !== undefined) return pinned
  if (process.platform !== 'win32' || env.LOCALAPPDATA === undefined) return 'copilot'
  const winget = join(env.LOCALAPPDATA, 'Microsoft', 'WinGet')
  const link = join(winget, 'Links', 'copilot.exe')
  if (existsSync(link)) return link
  const packages = join(winget, 'Packages')
  const folder = readdirSafe(packages).find((name) => name.startsWith('GitHub.Copilot_'))
  const native = folder === undefined ? undefined : join(packages, folder, 'copilot.exe')
  return native !== undefined && existsSync(native) ? native : 'copilot'
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

export interface TurnPlace {
  cwd: string
  /** The folders besides `cwd` the session's tools may touch. */
  dirs: string[]
  /** The MCP servers to turn off: the project's, the account's and the plugins' own. */
  disabled: string[]
  /** The folder's git remotes, for the Protection rules of `git push <remote> <flag>`. */
  remotes: string[]
}

/**
 * A new session gets its id from Even Keel (`--session-id`) and its task as its name; a resume names the session. The
 * prompt goes as `--prompt=`: a reply starts with `- "question" → answer`, which `-p` would take for an option.
 */
export function turnArgs(start: Pick<SessionStart, 'name' | 'model' | 'mcp' | 'plugins' | 'protection'>, prompt: string, place: TurnPlace, session: { id: string; resume: boolean }): string[] {
  const { name, model, mcp, plugins = [] } = start
  return [
    '-C',
    place.cwd,
    '--output-format',
    'json',
    '--no-auto-update',
    '--no-ask-user',
    `--${SESSION_MODE}`,
    ...(start.protection === undefined ? [] : protectionRules(start.protection, place.remotes).copilot.flatMap(rule => ['--deny-tool', rule])),
    ...(session.resume ? [`--resume=${session.id}`] : ['--session-id', session.id, '--name', name]),
    ...(model === null ? [] : ['--model', model]),
    ...place.dirs.flatMap((dir) => ['--add-dir', dir]),
    ...(mcp === undefined ? [] : ['--disable-builtin-mcps', ...place.disabled.flatMap((server) => ['--disable-mcp-server', server]), ...gatewayArgs(mcp)]),
    ...plugins.flatMap((plugin) => ['--plugin-dir', plugin.dir]),
    `--prompt=${prompt}`,
  ]
}

/** The gateway's servers as `--additional-mcp-config` takes them. */
function gatewayArgs(mcp: NonNullable<SessionStart['mcp']>): string[] {
  if (mcp.length === 0) return []
  const servers = Object.fromEntries(mcp.map((server) => [gatewayName(server), { type: 'http', url: server.url, tools: ['*'] }]))
  return ['--additional-mcp-config', JSON.stringify({ mcpServers: servers })]
}

/**
 * The MCP servers a chain session must not start itself: the project's `.mcp.json`, `.github/mcp.json` and
 * `.vscode/mcp.json`, the account's `mcp-config.json` and every plugin's own, which reach it through the gateway.
 */
export function ownServers(cwd: string, home: string, plugins: SessionStart['plugins'] = []): string[] {
  const names = new Set<string>()
  const files = [join(cwd, '.mcp.json'), join(cwd, '.github', 'mcp.json'), join(cwd, '.vscode', 'mcp.json'), join(home, 'mcp-config.json')]
  for (const file of files) for (const name of serversIn(file)) names.add(name)
  for (const plugin of plugins) for (const name of plugin.servers) names.add(name)
  return [...names]
}

function serversIn(file: string): string[] {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const servers = value.mcpServers ?? value.servers
    return typeof servers === 'object' && servers !== null ? Object.keys(servers) : []
  } catch {
    return []
  }
}

/** The turn is over once the CLI wrote its `result` line, the last of `--output-format json`. */
export function turnEnded(stdout: string): boolean {
  const event = lastEvent(stdout)
  return event?.type === 'result'
}

/** The session a turn ran in, from its `result` line; `undefined` until the turn is over. */
export function sessionOf(stdout: string): string | undefined {
  for (const line of stdout.split('\n').reverse()) {
    const event = parse(line)
    if (event?.type === 'result' && typeof event.sessionId === 'string') return event.sessionId
  }
  return undefined
}

function parse(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

export class CopilotCli {
  constructor(
    private readonly bin: () => string,
    private readonly timeoutMs: number,
    private readonly envOf: (home: AccountHome) => NodeJS.ProcessEnv,
    private readonly registry: TurnRegistry,
  ) {}

  async launch(home: AccountHome, start: SessionStart): Promise<string> {
    const { name, cwd } = start
    const sessionId = randomUUID()
    const turn = await this.turn(home, start, cwd, { id: sessionId, resume: false }, notice('copilot.startFailed', { task: name, cwd }))
    this.registry.save({ sessionId, name, cwd, account: home.key, startedAt: turn.at, pid: turn.pid, out: turn.out })
    return sessionId
  }

  /** Copilot resumes in the session's own folder, whatever `start.cwd` says. */
  async resume(home: AccountHome, sessionId: string, start: SessionStart): Promise<string> {
    const session = await this.registry.get(sessionId)
    if (session === undefined) throw fail('copilot.unknownSession', { session: sessionId })
    const { name, cwd } = session
    const turn = await this.turn(home, start, cwd, { id: sessionId, resume: true }, notice('copilot.resumeFailed', { task: name, cwd }))
    const { stopped: _, ...kept } = session
    this.registry.save({ ...kept, account: home.key, pid: turn.pid, out: turn.out })
    return sessionId
  }

  async stop(sessionId: string): Promise<void> {
    const session = await this.registry.get(sessionId)
    if (session === undefined || session.stopped === true) return
    if ((await this.turnLive(session)) && processBelongsToTurn(await processStartedAt(session.pid), turnStartedAt(session.out), APPEAR_TIMEOUT_MS)) {
      await killTree(session.pid)
      const deadline = Date.now() + STOP_TIMEOUT_MS
      while (isAlive(session.pid)) {
        if (Date.now() > deadline) throw fail('copilot.stillRunning', { session: sessionId })
        await delay(POLL_MS)
      }
    }
    this.registry.save({ ...session, stopped: true })
  }

  async sessions(home: AccountHome): Promise<AgentEntry[]> {
    const sessions = await this.registry.list(home.key)
    return Promise.all(sessions.map(async (session) => entryOf(session, session.stopped !== true && (await this.turnLive(session)), COPILOT)))
  }

  async error(home: AccountHome, sessionId: string): Promise<TurnError | undefined> {
    const session = await this.registry.get(sessionId)
    if (session === undefined || session.account !== home.key || await this.turnLive(session)) return undefined
    const text = outputError(await outputTail(session.out))
    if (text === undefined) return undefined
    const info = await stat(session.out).catch(() => undefined)
    return info === undefined ? undefined : { at: info.mtime.toISOString(), text }
  }

  /** `copilot --version`: `GitHub Copilot CLI 1.0.98.` */
  async version(env: NodeJS.ProcessEnv): Promise<string> {
    return (await run(this.bin(), ['--version'], { env, timeout: this.timeoutMs, windowsHide: true })).stdout
  }

  async authStatus(home: AccountHome): Promise<AccountStatus> {
    return parseAuth(tokenOf(home.dir))
  }

  /**
   * The CLI's own device sign-in. Its token goes to the OS credential store, shared by every folder, so the page adds
   * Copilot accounts by token instead; this is only for the CLI's contract.
   */
  login(home: AccountHome): ChildProcessWithoutNullStreams {
    return spawn(this.bin(), ['login'], { env: this.envOf(home), windowsHide: true, stdio: 'pipe' })
  }

  async logout(home: AccountHome): Promise<void> {
    await rm(tokenFile(home.dir), { force: true })
  }

  private async turnLive(session: CodexSession): Promise<boolean> {
    return isAlive(session.pid) && !turnEnded(await outputTail(session.out))
      && processBelongsToTurn(await polledProcessStartedAt(session.pid), turnStartedAt(session.out), APPEAR_TIMEOUT_MS)
  }

  /**
   * A turn is a detached process writing its JSON events into a file, as Codex's is. The session's id is known before
   * it starts; the turn has started once the session's transcript has the turn's prompt or the process is over.
   */
  private async turn(home: AccountHome, start: SessionStart, cwd: string, session: { id: string; resume: boolean }, failure: Notice): Promise<{ pid: number; out: string; at: number }> {
    const dirs = [await mainCheckout(cwd)].filter((dir): dir is string => dir !== null)
    const place: TurnPlace = { cwd, dirs, disabled: ownServers(cwd, home.dir, start.plugins), remotes: await remotesOf(cwd) }
    const at = Date.now()
    const out = this.registry.turnFile(start.name, at)
    const transcript = eventsFile(home.dir, session.id)
    const before = session.resume ? await size(transcript) : 0
    const fd = openSync(out, 'a')
    let exited = false
    let child
    try {
      child = spawn(this.bin(), turnArgs(start, start.prompt, place, session), { cwd, env: this.envOf(home), detached: true, stdio: ['ignore', fd, fd], windowsHide: true })
      child.on('error', () => (exited = true))
      child.on('exit', () => (exited = true))
      child.unref()
    } catch (error) {
      throw new NoticeError({ ...failure, detail: (error as Error).message }, { cause: error })
    } finally {
      closeSync(fd)
    }
    const deadline = at + APPEAR_TIMEOUT_MS
    for (;;) {
      const text = await outputTail(out)
      if (child.pid !== undefined && ((await size(transcript)) > before || (exited && sessionOf(text) === session.id))) return { pid: child.pid, out, at }
      if (exited || Date.now() > deadline) {
        if (!exited && child.pid !== undefined) await killTree(child.pid)
        const refusal = modelRefusal(outputError(text) ?? '')
        if (refusal !== undefined) throw new NoticeError(refusal)
        throw new NoticeError({ ...failure, detail: text.trim().slice(-500) })
      }
      await delay(POLL_MS)
    }
  }
}

/** The main checkout of the repository `cwd` is in (itself, for the checkout); `null` — `cwd` is not in one. */
async function mainCheckout(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeout: GIT_TIMEOUT_MS, windowsHide: true })
    return dirname(stdout.trim())
  } catch {
    return null
  }
}

async function remotesOf(cwd: string): Promise<string[]> {
  return run('git', ['-C', cwd, 'remote'], { timeout: GIT_TIMEOUT_MS, windowsHide: true }).then(({ stdout }) => stdout.split(/\s+/).filter(Boolean), () => [])
}

async function size(file: string): Promise<number> {
  return stat(file).then(
    (info) => info.size,
    () => 0,
  )
}
