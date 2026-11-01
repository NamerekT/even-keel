import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { vi } from 'vitest'
import type { Notice } from '../notice/notice.js'
import type { ServiceContext } from '../service.js'
import { ScriptedAgent } from './agent.fixture.js'
import { Ci, FORGE_WEB } from './ci.fixture.js'
import { Pulls } from './forge.fixture.js'
import { Board, BOARD_TRACKER, BOARD_VARIABLE } from './tracker.fixture.js'

export const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
export const KEY = 'ABC'
/** The second project of `Harness.second`: a clone of the same remote. */
export const SECOND_ID = '22222222-2222-4222-8222-222222222222'
export const SECOND_KEY = 'DEF'
/** The release project of `Harness.release`: a clone of the same remote on `RELEASE_BRANCH`, merging into `PROJECT_ID`. */
export const RELEASE_ID = '33333333-3333-4333-8333-333333333333'
export const RELEASE_KEY = 'REL'
export const RELEASE_BRANCH = 'release/v0.1'
/** The remote's address on the bench's forge; git is pointed at the bare repository by `insteadOf`. */
const FORGE_URL = `${FORGE_WEB}/john/example.git`
const ACCOUNT = 'script'
/** A Codex account folder the scripted agent plays too: a project names it in `accounts` for a run label to pick it. */
export const CODEX_ACCOUNT = 'coder'
const SIGNALS = ['SIGINT', 'SIGTERM'] as const
/** The real `setTimeout`, for waits on real I/O (git, the database) while the service's own timers are fake. */
const realTimeout = globalThis.setTimeout

/**
 * The service as `src/main.ts` starts it, in a folder of its own: a git repository for the one project, the board
 * for its tracker and the scripted agent for every account. Its timers are fake, so a scenario moves its clock.
 */
export class Harness {
  readonly dir = mkdtempSync(join(tmpdir(), 'even-keel-e2e-'))
  readonly repo = join(this.dir, 'repo')
  /** The checkout of the second project, with `second` set. */
  readonly repo2 = join(this.dir, 'repo2')
  /** The checkout of the release project, with `release` set. */
  readonly releaseRepo = join(this.dir, 'release')
  /** The bare repository behind the forge's remote, with `forge` set. */
  readonly remote = join(this.dir, 'remote.git')
  readonly board = new Board()
  readonly ci = new Ci(() => this.remote)
  /** The pull requests of the forge, with `forge` set: the real Forgejo adapter reads them in place of its API. */
  readonly pulls = new Pulls(() => this.remote)
  readonly agent = new ScriptedAgent((cwd) => this.checkoutOf(cwd), () => this.service.listen)
  readonly log: string[] = []
  /** Keys of the project's entry in the config file the service starts on, set before `start`. */
  readonly project: Record<string, unknown> = {}
  /** Top-level keys of the config file the service starts on (`parallel`), set before `start`. */
  readonly config: Record<string, unknown> = {}
  /**
   * Set before `start`: the project's checkout is a clone of a bare repository on a forge with a CI workflow, its runs
   * played by `ci` in place of the Forgejo adapter, and a Forgejo profile with a token is made for it at the first start.
   */
  forge = false
  /** Set before `start`, with `forge`: keys of a second project `SECOND_KEY`, its clone `repo2` of the same remote. */
  second: Record<string, unknown> | null = null
  /**
   * Set before `start`, with `forge`: keys of a release project `RELEASE_KEY`, its clone `releaseRepo` of the same remote
   * on `RELEASE_BRANCH` (pushed from `main` at the start), its `mergeInto` the project `PROJECT_ID`.
   */
  release: Record<string, unknown> | null = null
  /** Whether the scripted agent plays Codex too, with the account folder `CODEX_ACCOUNT`; set before `start`. */
  codex = false
  private context: ServiceContext | undefined
  /** The shutdown listeners the running service added: a halt takes them off, so that boots do not pile them up. */
  private signals: { signal: NodeJS.Signals; listener: NodeJS.SignalsListener }[] = []
  private readonly saved = { ...process.env }
  private readonly console = { log: console.log, warn: console.warn, error: console.error }

  get service(): ServiceContext {
    if (this.context === undefined) throw new Error('e2e: the service is not running')
    return this.context
  }

  /** `prepared` runs once the folder, its checkouts and the environment are ready, before the service reads them. */
  async start(prepared?: () => void): Promise<void> {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: new Date('2026-10-01T09:00:00Z') })
    this.prepare()
    await this.environment()
    prepared?.()
    await this.boot()
  }

  /** Stops the service and starts it anew on the same folder, as a restart of the machine's service would; `between` runs while it is down. */
  async restart(between?: () => void | Promise<void>): Promise<void> {
    await this.halt()
    await between?.()
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
    const answer = await this.send(command, body)
    if (!answer.ok) throw new Error(`e2e: ${command}: ${answer.status} ${await answer.text()}`)
  }

  /** A command of the page the service is to refuse: the notice it answers with; throws on a success. */
  async refused(command: string, body: Record<string, unknown>): Promise<Notice> {
    const answer = await this.send(command, body)
    if (answer.ok) throw new Error(`e2e: ${command} went through`)
    return ((await answer.json()) as { notice: Notice }).notice
  }

  private async send(command: string, body: Record<string, unknown>): Promise<Response> {
    const { host, port } = this.service.listen
    let answer: Response | undefined
    let failure: unknown
    void fetch(`http://${host}:${port}/api/${command}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(
      (response) => (answer = response),
      (error: unknown) => (failure = error ?? new Error('fetch failed')),
    )
    await this.until(() => answer !== undefined || failure !== undefined, `the page's ${command} answered`, { step: 100 })
    if (failure !== undefined) throw failure
    return answer!
  }

  /** Moves the clock by `ms`, letting real I/O run along. */
  async pass(ms: number, step = 1_000): Promise<void> {
    let passed = 0
    await this.until(() => (passed += step) > ms, `${ms} ms passing`, { step, limitMs: ms + step })
  }

  git(...args: string[]): string {
    return this.gitIn(this.repo, ...args)
  }

  gitIn(repo: string, ...args: string[]): string {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
  }

  /** The project checkout a session's folder is in: its worktrees are inside it. */
  private checkoutOf(cwd: string): string {
    return [this.repo2, this.releaseRepo, this.repo].find((repo) => cwd === repo || cwd.startsWith(repo + sep) || cwd.startsWith(`${repo}/`)) ?? this.repo
  }

  private prepare(): void {
    const codex = this.codex ? `codex-accounts/${CODEX_ACCOUNT}` : 'codex-accounts'
    for (const folder of ['data', `accounts/${ACCOUNT}`, codex, 'opencode-accounts', 'copilot-accounts', 'claude', 'codex', 'repo']) mkdirSync(join(this.dir, folder), { recursive: true })
    if (this.forge) writeFileSync(join(this.dir, '.gitconfig'), '[core]\n\tlongpaths = true\n')
    execFileSync('git', ['init', '-q', '-b', 'main', this.repo])
    this.configure(this.repo)
    writeFileSync(join(this.repo, 'README.md'), '# Example\n')
    writeFileSync(join(this.repo, '.gitignore'), '.temp/\n')
    if (this.forge) {
      mkdirSync(join(this.repo, '.forgejo', 'workflows'), { recursive: true })
      writeFileSync(join(this.repo, '.forgejo', 'workflows', 'ci.yml'), 'on: push\n')
    }
    this.git('add', '.')
    this.git('commit', '-q', '-m', 'Initial commit')
    const projects: Record<string, unknown>[] = [{ id: PROJECT_ID, key: KEY, tracker: BOARD_TRACKER, repo: this.repo, ...this.project }]
    this.board.keys.set(PROJECT_ID, KEY)
    if (this.forge) {
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main', this.remote])
      this.git('remote', 'add', 'origin', FORGE_URL)
      this.git('push', '-q', '-u', 'origin', 'main')
    }
    if (this.second !== null) {
      if (!this.forge) throw new Error('e2e: a second project needs the forge')
      this.clone(this.repo2, 'main')
      projects.push({ id: SECOND_ID, key: SECOND_KEY, tracker: BOARD_TRACKER, repo: this.repo2, ...this.second })
      this.board.keys.set(SECOND_ID, SECOND_KEY)
    }
    if (this.release !== null) {
      if (!this.forge) throw new Error('e2e: a release project needs the forge')
      this.git('push', '-q', 'origin', `main:refs/heads/${RELEASE_BRANCH}`)
      this.clone(this.releaseRepo, RELEASE_BRANCH)
      projects.push({ id: RELEASE_ID, key: RELEASE_KEY, tracker: BOARD_TRACKER, repo: this.releaseRepo, branch: RELEASE_BRANCH, mergeInto: PROJECT_ID, ...this.release })
      this.board.keys.set(RELEASE_ID, RELEASE_KEY)
    }
    const config = { version: 19, language: 'en', accounts: { claude: ACCOUNT }, updates: { check: false }, projects, ...this.config }
    writeFileSync(join(this.dir, 'data', 'even-keel.config.json'), JSON.stringify(config, null, 2))
  }

  /** Another clone of the bare repository on `branch`, its remote at the forge's address as the first checkout's. */
  private clone(path: string, branch: string): void {
    // Checked out as committed: a machine's `core.autocrlf` would leave the clone with changes to every file.
    execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', '-b', branch, this.remote, path])
    this.configure(path)
    this.gitIn(path, 'remote', 'set-url', 'origin', FORGE_URL)
    this.gitIn(path, 'fetch', '-q', 'origin')
  }

  /** A checkout's identity and line endings; with the forge, its remote's address leads git to the bare repository. */
  private configure(repo: string): void {
    this.gitIn(repo, 'config', 'user.email', 'john@example.com')
    this.gitIn(repo, 'config', 'user.name', 'John Doe')
    this.gitIn(repo, 'config', 'commit.gpgsign', 'false')
    this.gitIn(repo, 'config', 'core.autocrlf', 'false')
    if (this.forge) this.gitIn(repo, 'config', `url.${this.remote.replaceAll('\\', '/')}.insteadOf`, FORGE_URL)
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
    // The forge's checkouts sync by the built-in fetch, merge and push, not by a `git sync` alias of the machine.
    if (this.forge) Object.assign(process.env, { FORGEJO_TOKEN: 'token', GIT_CONFIG_GLOBAL: join(this.dir, '.gitconfig') })
    for (const method of ['log', 'warn', 'error'] as const) console[method] = (...args: unknown[]) => void this.log.push(args.map(String).join(' '))
  }

  /** Imports the service anew: a fresh module graph, the scripted agent and the board registered before it reads them. */
  private async boot(): Promise<void> {
    vi.resetModules()
    const { AGENTS } = await import('../agent/adapters.js')
    const agents = AGENTS as Record<string, unknown>
    for (const name of Object.keys(agents)) delete agents[name]
    const { CLAUDE } = await import('../claude/name.js')
    const { CODEX } = await import('../codex/name.js')
    agents[CLAUDE] = this.agent.adapter()
    if (this.codex) agents[CODEX] = this.agent.adapter()
    const { ADAPTERS } = await import('../tracker/adapters.js')
    ;(ADAPTERS as Record<string, unknown>)[BOARD_TRACKER] = this.board.adapter()
    if (this.forge) {
      const { CI_SOURCES } = await import('../ci/adapters.js')
      CI_SOURCES.forgejo = () => this.ci.source()
      const { FORGES } = await import('../review/wiring.js')
      const { forgejoPulls } = await import('../review/forgejo.js')
      FORGES.forgejo = ({ web, owner, repo }, token, timeoutMs) => forgejoPulls({ web, owner, repo, token }, timeoutMs, this.pulls.fetch)
    }
    const before = new Map(SIGNALS.map((signal) => [signal, new Set(process.listeners(signal))]))
    await import('../main.js')
    this.signals = SIGNALS.flatMap((signal) => process.listeners(signal).filter((listener) => !before.get(signal)!.has(listener)).map((listener) => ({ signal, listener })))
    const service = (await import('../service.js')).service
    this.context = service
    await this.until(() => service.account.view.accounts.some((entry) => entry.key === ACCOUNT && entry.status?.loggedIn === true), 'the account read')
  }

  private async halt(): Promise<void> {
    const service = this.service
    this.context = undefined
    for (const { signal, listener } of this.signals) process.removeListener(signal, listener)
    this.signals = []
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
