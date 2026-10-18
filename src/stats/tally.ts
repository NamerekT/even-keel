import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { readerSettings, type ReaderSettings } from './model.js'
import { HALTED } from './tally-schema.js'

// Tally inside the service (BTN-70): the collector runs every few minutes on a thread of its own, and without
// TALLY_DB_HOST the database is PGlite in <state>/tally, owned by another thread and served on a loopback port.

export type HostRequest = { type: 'close' }
export type HostMessage = { type: 'ready'; settings: ReaderSettings } | { type: 'failed'; error: string } | { type: 'closed' }

// settings null — the server database from the environment, as the writer role.
export interface CollectRun {
  root: string
  settings: ReaderSettings | null
  huly: HulyProfiles
}

/** The Huly profiles' values the collector reads task titles and writes times with (BTN-200), not the environment's. */
export interface HulyProfiles {
  /** By the key of each project on Huly: the profile it runs on. */
  projects: Record<string, Record<string, string>>
  /** The default Huly profile, for a task of a project the config no longer has; `null` — none. */
  fallback: Record<string, string> | null
}

export interface TallyOptions {
  root: string
  stateDir: string
  env: Record<string, string | undefined>
  intervalMs: number
  firstDelayMs: number
  /** Read at each pass: the address changes on the fly. */
  evenKeelUrl: () => string
  /** Read at each pass: the profiles change on the fly. */
  huly: () => HulyProfiles
  log: (message: string) => void
}

const HOST_CLOSE_MS = 10_000
const workerFile = (name: string) => new URL(`../../tally/src/${name}.ts`, import.meta.url)

export class TallyService {
  readonly reader: ReaderSettings | string | Promise<ReaderSettings>
  private readonly local: Promise<ReaderSettings> | null = null
  private host: Worker | null = null
  private running: Worker | null = null
  private timer: NodeJS.Timeout | null = null
  private stopped = false

  constructor(private readonly options: TallyOptions) {
    const server = readerSettings(options.env)
    if (server !== null) {
      this.reader = server
      return
    }
    this.local = this.openHost()
    this.local.catch((error: unknown) => options.log(`tally: the local database did not open: ${(error as Error).message}`))
    this.reader = this.local
  }

  start(): void {
    const { env, log } = this.options
    if (this.local === null && (!env.TALLY_WRITER_PASSWORD || !env.TALLY_DB_NAME)) {
      log('tally: TALLY_DB_NAME or TALLY_WRITER_PASSWORD is not set, the service does not collect')
      return
    }
    this.schedule(this.options.firstDelayMs)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer !== null) clearTimeout(this.timer)
    await this.running?.terminate()
    const host = this.host
    if (host === null) return
    await new Promise<void>((done) => {
      const timeout = setTimeout(done, HOST_CLOSE_MS)
      host.on('message', (message: HostMessage) => {
        if (message.type !== 'closed') return
        clearTimeout(timeout)
        done()
      })
      host.postMessage({ type: 'close' } satisfies HostRequest)
    })
    await host.terminate()
  }

  private openHost(): Promise<ReaderSettings> {
    const host = new Worker(workerFile('host-worker'), { workerData: { dir: join(this.options.stateDir, 'tally') } })
    this.host = host
    return new Promise((resolve, reject) => {
      host.on('message', (message: HostMessage) => {
        if (message.type === 'ready') resolve(message.settings)
        if (message.type === 'failed') reject(new Error(message.error))
      })
      host.on('error', reject)
      host.on('exit', (code) => {
        reject(new Error(`its thread exited with code ${code}`))
        if (!this.stopped) this.options.log(`tally: the local database thread exited (code ${code}), stats are off until a restart`)
      })
    })
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return
    this.timer = setTimeout(() => void this.collect(), delayMs)
    this.timer.unref()
  }

  // The next run starts an interval after this one started, and never while it is still going.
  private async collect(): Promise<void> {
    const started = Date.now()
    let settings: ReaderSettings | null = null
    if (this.local !== null) {
      try {
        settings = await this.local
      } catch {
        return
      }
    }
    const { root, env, evenKeelUrl, huly, log } = this.options
    const run = new Worker(workerFile('collect-worker'), {
      workerData: { root, settings, huly: huly() } satisfies CollectRun,
      env: { ...process.env, EVEN_KEEL_URL: env.EVEN_KEEL_URL ?? evenKeelUrl() },
    })
    this.running = run
    let halted = false
    run.on('message', (code: number) => {
      halted = code === HALTED
      void run.terminate()
    })
    run.on('error', (error) => log(`tally: ${error.stack ?? error.message}`))
    run.on('exit', () => {
      this.running = null
      if (!halted) this.schedule(Math.max(0, this.options.intervalMs - (Date.now() - started)))
    })
  }
}
