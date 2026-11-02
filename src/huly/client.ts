import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { stateDirOf } from '../locations.js'
import { fail, notice, NoticeError, type Notice } from '../notice/notice.js'
import { installDependencies } from '../packages/npm.js'

/**
 * The Huly client, at the versions Even Keel is tested with: a clone has them in `devDependencies`, the npm package
 * installs them into the data folder once a Huly profile needs them (BTN-666) — ~19.5 MB nobody else should carry.
 */
export const HULY_CLIENT = {
  '@hcengineering/api-client': '0.7.423',
  '@hcengineering/core': '0.7.423',
  '@hcengineering/rank': '0.7.423',
  '@hcengineering/text-core': '0.7.423',
  '@hcengineering/text-markdown': '0.7.423',
} as const

/**
 * Tiptap 2 has no fix for GHSA-cp6q-959q-f8rh, and `@hcengineering/text` still asks for `^2` (BTN-698). On Tiptap 3 its
 * HTML conversion throws in Node, but Even Keel reads and writes markup only as markdown, which never reaches Tiptap.
 */
const TIPTAP = '3.32.2'
const TIPTAP_PACKAGES = [
  'core', 'html', 'pm', 'starter-kit', 'suggestion', 'extension-blockquote', 'extension-bold', 'extension-bullet-list',
  'extension-code', 'extension-code-block', 'extension-document', 'extension-dropcursor', 'extension-gapcursor',
  'extension-hard-break', 'extension-heading', 'extension-highlight', 'extension-history', 'extension-horizontal-rule',
  'extension-italic', 'extension-link', 'extension-list-item', 'extension-mention', 'extension-ordered-list',
  'extension-paragraph', 'extension-strike', 'extension-subscript', 'extension-superscript', 'extension-table',
  'extension-table-cell', 'extension-table-header', 'extension-table-row', 'extension-task-item', 'extension-task-list',
  'extension-text', 'extension-text-align', 'extension-text-style', 'extension-typography', 'extension-underline',
]

/** npm `overrides` of the client's install, the same as in Even Keel's `package.json`. */
export const HULY_CLIENT_OVERRIDES = {
  '@hcengineering/text': Object.fromEntries(TIPTAP_PACKAGES.map((name) => [`@tiptap/${name}`, TIPTAP])) as Record<string, string>,
}

const PINNED: Record<string, string> = { ...HULY_CLIENT, ...HULY_CLIENT_OVERRIDES['@hcengineering/text'] }

export type HulyPackage = keyof typeof HULY_CLIENT

export interface HulyClientDeps {
  /** Where the client is installed when the code does not resolve it itself. */
  dir: () => string
  /** The code's own `require`: a clone's `node_modules`. */
  own: NodeJS.Require
  /** Installs the dependencies of the folder's `package.json`. */
  install: (dir: string) => Promise<void>
  /** The install started or ended: the page shows it. */
  changed?: () => void
  log?: (line: string) => void
}

/** Finds the Huly client, or installs it into the data folder and says so until it is there. */
export class HulyClient {
  private from: NodeJS.Require | null = null
  private running: Promise<void> | null = null
  private failure: Notice | null = null
  changed: (() => void) | undefined

  constructor(private readonly deps: HulyClientDeps) {
    this.changed = deps.changed
  }

  /**
   * The package; throws `huly.clientInstalling` and starts the install when it is nowhere, `huly.clientFailed` after
   * a failed one. `install: false` — a reader in another thread (Tally's worker), which leaves the install to the service.
   */
  require<T = unknown>(name: HulyPackage, { install = true }: { install?: boolean } = {}): T {
    hideWebStorage()
    const from = this.locate()
    if (from !== null) return from(name) as T
    if (this.failure !== null) throw new NoticeError(this.failure)
    if (install) this.install()
    throw fail('huly.clientInstalling', {})
  }

  /** Starts the install unless one runs or the client already loads; also the page's "Retry". */
  install(): void {
    if (this.running !== null || this.locate() !== null) return
    this.failure = null
    const dir = this.deps.dir()
    const log = this.deps.log ?? ((line: string) => console.log(line))
    log(`huly: installing the Huly client into ${dir}`)
    this.running = (async () => {
      try {
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ private: true, dependencies: HULY_CLIENT, overrides: HULY_CLIENT_OVERRIDES }, null, 2)}\n`)
        await this.deps.install(dir)
        if (this.find() === null) throw new Error('npm finished, but the packages are not at their versions')
        log('huly: the Huly client is installed')
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        this.failure = notice('huly.clientFailed', {}, { detail })
        log(`huly: the Huly client could not be installed: ${detail}`)
      } finally {
        this.running = null
        this.changed?.()
      }
    })()
    this.changed?.()
  }

  /** Resolves when no install runs. */
  async installed(): Promise<void> {
    await this.running
  }

  /** What the page shows: an install that runs or failed; `null` — none. */
  view(): Notice | null {
    if (this.running !== null) return notice('huly.clientInstalling', {})
    return this.failure
  }

  /** Where the packages load from; none while an install writes the folder. */
  private locate(): NodeJS.Require | null {
    return this.from ?? (this.running === null ? this.find() : null)
  }

  private find(): NodeJS.Require | null {
    if (resolvesAll(this.deps.own)) return (this.from = this.deps.own)
    const dir = this.deps.dir()
    if (!pinnedIn(dir)) return null
    this.failure = null
    return (this.from = createRequire(join(dir, 'package.json')))
  }
}

/**
 * Node 25+ has the browser's `sessionStorage` and `localStorage`. The Huly client then takes Node for a browser: its
 * connect reaches for `window`, its load for `indexedDB`, and a failed connect leaves a timer that throws outside any
 * promise and ends the whole process. The service needs neither storage, so they are hidden before the client loads.
 */
export function hideWebStorage(scope: object = globalThis): void {
  for (const name of ['sessionStorage', 'localStorage']) {
    if (name in scope) Object.defineProperty(scope, name, { value: undefined, configurable: true, writable: true })
  }
}

function resolvesAll(from: NodeJS.Require): boolean {
  try {
    for (const name of Object.keys(HULY_CLIENT)) from.resolve(name)
    return true
  } catch {
    return false
  }
}

function pinnedIn(dir: string): boolean {
  return Object.entries(PINNED).every(([name, version]) => {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as { version?: unknown }
      return manifest.version === version
    } catch {
      return false
    }
  })
}

/** A Huly profile appeared or is there at the start: the client is installed before anything connects. */
export function installForProfiles(profiles: readonly { kind: string }[], client: HulyClient = hulyClient): void {
  if (profiles.some((profile) => profile.kind === 'huly')) client.install()
}

/** The service's client: in `state/huly-client` of the data folder. */
export const hulyClient = new HulyClient({
  dir: () => join(stateDirOf(), 'huly-client'),
  own: createRequire(import.meta.url),
  install: installDependencies,
})
