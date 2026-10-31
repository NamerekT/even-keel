import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import type { ServiceContext } from '../service.js'
import { ScriptedAgent } from './agent.fixture.js'
import { Board, BOARD_TRACKER, BOARD_VARIABLE } from './tracker.fixture.js'

export const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
export const KEY = 'ABC'
const ACCOUNT = 'script'
/** The real `setTimeout`, for waits on real I/O (git, the database) while the service's own timers are fake. */
const realTimeout = globalThis.setTimeout

/**
 * The service as `src/main.ts` starts it, in a folder of its own: a git repository for the one project, the board
 * for its tracker and the scripted agent for every account. Its timers are fake, so a scenario moves its clock.
 */
export class Harness {
  readonly dir = mkdtempSync(join(tmpdir(), 'even-keel-e2e-'))
  readonly repo = join(this.dir, 'repo')
  readonly board = new Board()
  readonly agent = new ScriptedAgent(() => this.repo)
  readonly log: string[] = []
  private context: ServiceContext | undefined
  private readonly saved = { ...process.env }
  private readonly console = { log: console.log, warn: console.warn, error: console.error }

  get service(): ServiceContext {
    if (this.context === undefined) throw new Error('e2e: the service is not running')
    return this.context
  }

  async start(): Promise<void> {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: new Date('2026-10-01T09:00:00Z') })
    this.prepare()
    await this.environment()
    await this.boot()
  }

  /** Stops the service and starts it anew on the same folder, as a restart of the machine's service would; `between` runs while it is down. */
  async restart(between?: () => void): Promise<void> {
    await this.halt()
    between?.()
    await this.boot()
  }

  async stop(): Promise<void> {
    this.agent.listing?.open()
    await this.halt()
    vi.useRealTimers()
    Object.assign(console, this.console)
    for (const name of Object.keys(process.env)) if (!(name in this.saved)) delete process.env[name]
    Object.assign(process.env, this.saved)
    rmSync(this.dir, { recursive: true, force: true, maxRetries: 5 })
  }

  /** Moves the clock by `step` until `done` holds, letting real I/O run between the steps; throws past `limitMs`. */
  async until(done: () => boolean, what: string, { step = 1_000, limitMs = 5 * 60_000 } = {}): Promise<void> {
    for (let passed = 0; passed <= limitMs; passed += step) {
      if (done()) return
      await vi.advanceTimersByTimeAsync(step)
      await this.agent.settled()
      await realWork()
    }
    if (done()) return
    throw new Error(`e2e: ${what} did not happen in ${limitMs / 1000} s of the service's time\n${this.log.slice(-40).join('\n')}`)
  }

  /** The chain's start button: it reads the tracker first, so the clock moves until it is through. */
  async startChain(project: string): Promise<void> {
    let started = false
    const start = this.service.chainControl.start(project).finally(() => (started = true))
    await this.until(() => started, `the chain of ${project} started`)
    await start
  }

  /** A command of the page, through the service's own server; throws on an error answer. */
  async post(command: string, body: Record<string, unknown>): Promise<void> {
    const { host, port } = this.service.listen
    let answer: Response | undefined
    let failure: unknown
    void fetch(`http://${host}:${port}/api/${command}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(
      (response) => (answer = response),
      (error: unknown) => (failure = error ?? new Error('fetch failed')),
    )
    await this.until(() => answer !== undefined || failure !== undefined, `the page's ${command} answered`, { step: 100 })
    if (failure !== undefined) throw failure
    if (!answer!.ok) throw new Error(`e2e: ${command}: ${answer!.status} ${await answer!.text()}`)
  }

  /** Moves the clock by `ms`, letting real I/O run along. */
  async pass(ms: number, step = 1_000): Promise<void> {
    let passed = 0
    await this.until(() => (passed += step) > ms, `${ms} ms passing`, { step, limitMs: ms + step })
  }

  git(...args: string[]): string {
    return execFileSync('git', ['-C', this.repo, ...args], { encoding: 'utf8' }).trim()
  }

  private prepare(): void {
    for (const folder of ['data', 'accounts/script', 'codex-accounts', 'opencode-accounts', 'copilot-accounts', 'claude', 'codex', 'repo']) mkdirSync(join(this.dir, folder), { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main', this.repo])
    this.git('config', 'user.email', 'john@example.com')
    this.git('config', 'user.name', 'John Doe')
    this.git('config', 'commit.gpgsign', 'false')
    this.git('config', 'core.autocrlf', 'false')
    writeFileSync(join(this.repo, 'README.md'), '# Example\n')
    writeFileSync(join(this.repo, '.gitignore'), '.temp/\n')
    this.git('add', '.')
    this.git('commit', '-q', '-m', 'Initial commit')
    const config = {
      version: 19,
      language: 'en',
      accounts: { claude: ACCOUNT },
      updates: { check: false },
      projects: [{ id: PROJECT_ID, key: KEY, tracker: BOARD_TRACKER, repo: this.repo }],
    }
    writeFileSync(join(this.dir, 'data', 'even-keel.config.json'), JSON.stringify(config, null, 2))
  }

  private async environment(): Promise<void> {
    const [port, mcpPort] = await Promise.all([freePort(), freePort()])
    for (const name of Object.keys(process.env)) if (name.startsWith('CLAUDE') || name.startsWith('EVEN_KEEL') || name.startsWith('TALLY')) delete process.env[name]
    Object.assign(process.env, {
      EVEN_KEEL_DATA: join(this.dir, 'data'),
      EVEN_KEEL_HOST: '127.0.0.1',
      EVEN_KEEL_PORT: String(port),
      EVEN_KEEL_MCP_PORT: String(mcpPort),
      EVEN_KEEL_ACCOUNTS_DIR: join(this.dir, 'accounts'),
      EVEN_KEEL_CODEX_ACCOUNTS_DIR: join(this.dir, 'codex-accounts'),
      EVEN_KEEL_OPENCODE_ACCOUNTS_DIR: join(this.dir, 'opencode-accounts'),
      EVEN_KEEL_COPILOT_ACCOUNTS_DIR: join(this.dir, 'copilot-accounts'),
      CLAUDE_CONFIG_DIR: join(this.dir, 'claude'),
      CODEX_HOME: join(this.dir, 'codex'),
      [BOARD_VARIABLE]: 'token',
    })
    for (const method of ['log', 'warn', 'error'] as const) console[method] = (...args: unknown[]) => void this.log.push(args.map(String).join(' '))
  }

  /** Imports the service anew: a fresh module graph, the scripted agent and the board registered before it reads them. */
  private async boot(): Promise<void> {
    vi.resetModules()
    const { AGENTS } = await import('../agent/adapters.js')
    const agents = AGENTS as Record<string, unknown>
    for (const name of Object.keys(agents)) delete agents[name]
    const { CLAUDE } = await import('../claude/name.js')
    agents[CLAUDE] = this.agent.adapter()
    const { ADAPTERS } = await import('../tracker/adapters.js')
    ;(ADAPTERS as Record<string, unknown>)[BOARD_TRACKER] = this.board.adapter()
    await import('../main.js')
    const service = (await import('../service.js')).service
    this.context = service
    await this.until(() => service.account.view.accounts.some((entry) => entry.key === ACCOUNT && entry.status?.loggedIn === true), 'the account read')
  }

  private async halt(): Promise<void> {
    const service = this.service
    this.context = undefined
    await this.agent.settled()
    await service.monitor.stop()
    await service.writes.settled()
    vi.clearAllTimers()
    await Promise.allSettled([service.packages.close(), new Promise((resolve) => service.server.close(resolve)), service.tally.stop()])
    service.server.closeAllConnections()
    await service.writes.settled()
    await service.stateDb.close()
  }
}

/**
 * Waits in real time while git or a file read of the service is under way, so that its clock does not run ahead of
 * real work on a loaded machine: a refresh of the tracker that has not come back yet sets no timer for the next one.
 */
async function realWork(limitMs = 10_000): Promise<void> {
  const busy = () => process.getActiveResourcesInfo().some((kind) => kind === 'ProcessWrap' || kind.startsWith('FSReq'))
  const started = performance.now()
  for (let quiet = 0; quiet < 2 && performance.now() - started < limitMs; ) {
    await new Promise((resolve) => realTimeout(resolve, 5))
    quiet = busy() ? 0 : quiet + 1
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address !== null ? resolve(address.port) : reject(new Error('no port'))))
    })
  })
}
