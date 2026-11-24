import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch as watchFolder, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runGit } from '../../git/run.js'
import type { Git, GitResult } from '../../git/types.js'
import { fileHash, MEMORY_INDEX, MIRROR_MARK, parseMemoryFile, type MemoryFact } from '../record.js'
import { settleConflicts } from './conflicts.js'
import { reindex } from './reindex.js'
import { findSecrets } from './secrets.js'

/** A change is committed this long after the last edit in the folder. */
export const SETTLE_MS = 30_000
/** After a sync that could not reach the remote, the next try comes this much later, unless an edit or a call comes first. */
export const RETRY_MS = 5 * 60_000
/** The memory repository's own branch: it is Even Keel's repository, never a project's, so no `branch` key applies. */
export const MEMORY_BRANCH = 'main'
export const ATTRIBUTES = `${MEMORY_INDEX} merge=union\n`

const PUSH_ROUNDS = 3
const REBASE_STEPS = 200
const SCAN_LIMIT = 1024 * 1024

export interface MemorySyncDeps {
  /** The working copy: a project's memory folder (`sharedMemory`). */
  folder: string
  /** The project's bare repository: a path or any address git takes. */
  remote: string
  /** Who the commits are by: the machine's name. */
  author: string
  log(line: string): void
  git?: Git
  schedule?(run: () => void, ms: number): () => void
  /** Calls `changed` on every edit in the folder; gives the way to stop. */
  watch?(folder: string, changed: () => void): () => void
}

export interface SyncOutcome {
  /** The folder's files that went into the commit of local edits. */
  committed: string[]
  /** Files kept out of it for what looks like a key (`findSecrets`). */
  withheld: string[]
  /** Side files made for records changed on both sides (`settleConflicts`). */
  conflicts: string[]
  /** The remote was reached: fetched, rebased onto and pushed what was ahead. */
  reached: boolean
}

/**
 * A project's memory folder kept in step with its bare repository (BTN-1645), on the hub and on a machine alike.
 * A sync commits the folder's edits, fetches, rebases onto the remote (`MEMORY.md` merges by union and is tidied after
 * by `reindex`; a record changed on both sides by `settleConflicts`) and pushes. A folder that is missing, empty or not
 * a repository becomes one and takes the remote's history, so an empty folder never deletes a record: only a commit
 * of a deletion does. Without the remote the commits stay local until a sync reaches it. One sync runs at a time.
 */
export class MemorySync {
  private readonly git: Git
  private current: Promise<unknown> = Promise.resolve()
  private pending: Promise<SyncOutcome> | null = null
  private cancel: (() => void) | null = null
  private retrying = false
  private unwatch: (() => void) | null = null
  private stopped = false
  /** Withheld file contents already logged, so a file left with a key is not logged at every sync. */
  private readonly told = new Set<string>()

  constructor(private readonly deps: MemorySyncDeps) {
    this.git = deps.git ?? runGit
  }

  /** The first sync — it commits what was edited while Even Keel was not running — then a sync after every edit. */
  start(): Promise<SyncOutcome> {
    this.stopped = false
    return this.sync()
  }

  stop(): void {
    this.stopped = true
    this.cancel?.()
    this.cancel = null
    this.unwatch?.()
    this.unwatch = null
  }

  /** An edit in the folder: a sync `SETTLE_MS` after the last one. */
  touched(): void {
    if (!this.stopped) this.arm(SETTLE_MS, false)
  }

  /** A sync now, or after the running one; calls meanwhile share the one queued. */
  sync(): Promise<SyncOutcome> {
    if (this.pending !== null) return this.pending
    const next = this.current
      .catch(() => {})
      .then(() => {
        this.pending = null
        return this.syncNow()
      })
    this.pending = next
    this.current = next
    return next
  }

  /** A change of the folder's files by Even Keel itself (the memory tools), run between two syncs, never inside one. */
  edit<T>(step: () => T): Promise<T> {
    const next = this.current.catch(() => {}).then(step)
    this.current = next
    return next
  }

  private arm(ms: number, retry: boolean): void {
    if (retry && this.cancel !== null) return
    this.cancel?.()
    this.retrying = retry
    const schedule = this.deps.schedule ?? defaultSchedule
    this.cancel = schedule(() => {
      this.cancel = null
      void this.sync()
    }, ms)
  }

  private async syncNow(): Promise<SyncOutcome> {
    const outcome: SyncOutcome = { committed: [], withheld: [], conflicts: [], reached: false }
    if (this.retrying) {
      this.cancel?.()
      this.cancel = null
    }
    try {
      await this.ensureRepository()
      await this.commitEdits(outcome)
      for (let round = 0; round < PUSH_ROUNDS && !outcome.reached; round++) {
        const step = await this.exchange(outcome)
        if (step === 'failed') break
        outcome.reached = step === 'pushed'
      }
    } catch (error) {
      this.deps.log(`memory: ${this.deps.folder} sync failed: ${(error as Error).message}`)
    }
    if (!this.stopped) {
      this.watchFolder()
      if (!outcome.reached) this.arm(RETRY_MS, true)
    }
    return outcome
  }

  private run(...args: string[]): Promise<GitResult> {
    const { folder, author } = this.deps
    const config: [string, string][] = [
      ['user.name', author],
      ['user.email', `${author.toLowerCase().replace(/[^a-z0-9.-]+/g, '-') || 'machine'}@even-keel.invalid`],
      ['core.hooksPath', join(folder, '.git', 'no-hooks')],
      ['commit.gpgSign', 'false'],
      ['advice.detachedHead', 'false'],
      // Git for Windows sets `core.autocrlf` system-wide: the files must stay byte for byte what every copy wrote.
      ['core.autocrlf', 'false'],
    ]
    // A machine's remote is its relay on the loopback (BTN-1648): a proxy of the environment must not catch it.
    const env: Record<string, string> = { GIT_CONFIG_COUNT: String(config.length), GIT_EDITOR: 'true', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' }
    config.forEach(([key, value], index) => {
      env[`GIT_CONFIG_KEY_${index}`] = key
      env[`GIT_CONFIG_VALUE_${index}`] = value
    })
    return this.git(folder, args, env)
  }

  private async must(...args: string[]): Promise<string> {
    const result = await this.run(...args)
    if (result.code !== 0) throw new Error(`git ${args[0]}: ${result.out}`)
    return result.out
  }

  private async ensureRepository(): Promise<void> {
    const { folder, remote } = this.deps
    mkdirSync(folder, { recursive: true })
    if (!existsSync(join(folder, '.git'))) {
      await this.must('init', '-q', '-b', MEMORY_BRANCH)
      this.deps.log(`memory: ${folder} is a new working copy of ${remote}`)
    }
    const url = await this.run('remote', 'get-url', 'origin')
    if (url.code !== 0) await this.must('remote', 'add', 'origin', remote)
    else if (url.out !== remote) await this.must('remote', 'set-url', 'origin', remote)
    if (this.rebasing()) {
      await this.run('rebase', '--abort')
      this.deps.log(`memory: ${folder} a rebase was left unfinished: aborted, the local commits are kept`)
    }
    const info = join(folder, '.git', 'info')
    mkdirSync(info, { recursive: true })
    writeIfOther(join(info, 'attributes'), ATTRIBUTES)
    writeIfOther(join(info, 'exclude'), `${MIRROR_MARK}\n`)
  }

  private rebasing(): boolean {
    const dir = join(this.deps.folder, '.git')
    return existsSync(join(dir, 'rebase-merge')) || existsSync(join(dir, 'rebase-apply'))
  }

  private async hasHead(): Promise<boolean> {
    return (await this.run('rev-parse', '--verify', '-q', 'HEAD')).code === 0
  }

  /** Every edit of the folder into one commit, a file that looks like it holds a key left out (and logged once). */
  private async commitEdits(outcome: SyncOutcome): Promise<void> {
    const { folder } = this.deps
    if (readdirSync(folder).every((name) => name === '.git')) return
    await this.must('add', '-A')
    const head = await this.hasHead()
    for (const path of list(await this.must('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'))) {
      const text = readText(join(folder, path))
      const hits = text === null ? [] : findSecrets(text)
      if (hits.length === 0) continue
      const known = head && (await this.run('cat-file', '-e', `HEAD:${path}`)).code === 0
      await this.must(...(known ? ['reset', '-q', 'HEAD', '--', path] : ['rm', '--cached', '-q', '--', path]))
      outcome.withheld.push(path)
      const told = `${path}\0${fileHash(text!)}`
      if (!this.told.has(told)) {
        this.told.add(told)
        const where = hits.map((hit) => `${hit.kind} on line ${hit.line}`).join(', ')
        this.deps.log(`memory: ${folder} ${path} is not committed: it looks like it holds a key (${where}); remove it from the file`)
      }
    }
    outcome.committed = list(await this.must('diff', '--cached', '--name-only', '-z'))
    if (outcome.committed.length === 0) return
    const files = outcome.committed.length === 1 ? '1 file' : `${outcome.committed.length} files`
    await this.must('commit', '-q', '--no-verify', '-m', `memory: ${files} from ${this.deps.author}`, '-m', outcome.committed.join('\n'))
  }

  /** One round with the remote: fetch, take its history, tidy, push; `rejected` — someone pushed in between. */
  private async exchange(outcome: SyncOutcome): Promise<'pushed' | 'rejected' | 'failed'> {
    const { folder } = this.deps
    const fetched = await this.run('fetch', '-q', 'origin')
    if (fetched.code !== 0) {
      this.deps.log(`memory: ${folder} cannot reach its repository, the commits stay here: ${fetched.out.split('\n')[0]}`)
      return 'failed'
    }
    const upstream = `refs/remotes/origin/${MEMORY_BRANCH}`
    const remote = (await this.run('rev-parse', '--verify', '-q', upstream)).code === 0
    if (remote && !(await this.hasHead())) {
      const taken = await this.run('checkout', '-q', '-B', MEMORY_BRANCH, upstream)
      if (taken.code !== 0) {
        this.deps.log(`memory: ${folder} cannot take the repository's files: ${taken.out.split('\n')[0]}`)
        return 'failed'
      }
    } else if (remote && !(await this.rebase(upstream, outcome))) return 'failed'
    await this.tidy(outcome.withheld)
    if (!(await this.hasHead())) return 'pushed'
    if (remote && (await this.must('rev-list', '--count', `${upstream}..HEAD`)) === '0') return 'pushed'
    const pushed = await this.run('push', '-q', 'origin', `HEAD:refs/heads/${MEMORY_BRANCH}`)
    if (pushed.code === 0) return 'pushed'
    if (/\[rejected\]|fetch first|non-fast-forward/.test(pushed.out)) return 'rejected'
    this.deps.log(`memory: ${folder} cannot push to its repository, the commits stay here: ${pushed.out.split('\n')[0]}`)
    return 'failed'
  }

  /** Local commits onto the remote's; never left unfinished: a conflict is settled, anything else aborted. */
  private async rebase(upstream: string, outcome: SyncOutcome): Promise<boolean> {
    const { folder } = this.deps
    let step = await this.run('rebase', '-q', '--autostash', upstream)
    for (let n = 0; step.code !== 0; n++) {
      if (!this.rebasing() || n >= REBASE_STEPS) {
        if (this.rebasing()) await this.run('rebase', '--abort')
        this.deps.log(`memory: ${folder} cannot rebase onto its repository, the local commits are kept: ${step.out.split('\n')[0]}`)
        return false
      }
      const unmerged = list((await this.must('diff', '--name-only', '--diff-filter=U', '-z')))
      if (unmerged.length === 0) {
        // The replayed commit came out empty once its conflict was settled.
        step = await this.run('rebase', '--skip')
        continue
      }
      const sides = await settleConflicts((...args) => this.run(...args), folder)
      if (sides === null) {
        await this.run('rebase', '--abort')
        this.deps.log(`memory: ${folder} cannot settle a conflict with its repository (${unmerged.join(', ')}): the local commits are kept`)
        return false
      }
      for (const side of sides) this.deps.log(`memory: ${folder} ${side} is another machine's version of a record changed here too: to be merged`)
      outcome.conflicts.push(...sides)
      step = await this.run('rebase', '--continue')
    }
    return true
  }

  /**
   * `.gitattributes` and `MEMORY.md` as the folder's files call for them, committed when they changed. A withheld file
   * the repository does not have yet gets no index line: the other copies would drop it again at once.
   */
  private async tidy(withheld: readonly string[]): Promise<void> {
    const { folder } = this.deps
    const paths: string[] = []
    const attributes = join(folder, '.gitattributes')
    const had = existsSync(attributes) ? readFileSync(attributes, 'utf8') : ''
    if (!withheld.includes('.gitattributes')) {
      if (!had.split(/\r?\n/).includes(ATTRIBUTES.trim())) writeFileSync(attributes, `${had}${had === '' || had.endsWith('\n') ? '' : '\n'}${ATTRIBUTES}`)
      paths.push('.gitattributes')
    }
    const index = join(folder, MEMORY_INDEX)
    if (!withheld.includes(MEMORY_INDEX)) {
      const unknown: string[] = []
      for (const path of withheld) if ((await this.run('cat-file', '-e', `HEAD:${path}`)).code !== 0) unknown.push(path)
      const files = recordFiles(folder)
      for (const path of unknown) files.delete(path)
      const before = existsSync(index) ? readFileSync(index, 'utf8') : null
      const after = reindex(before ?? '', files)
      if (after !== (before ?? '').replace(/\r\n/g, '\n') && !(before === null && after === '')) writeFileSync(index, after)
      if (existsSync(index)) paths.push(MEMORY_INDEX)
    }
    if (paths.length === 0) return
    await this.must('add', '--', ...paths)
    if ((await this.run('diff', '--cached', '--quiet')).code === 0) return
    await this.must('commit', '-q', '--no-verify', '-m', `memory: index from ${this.deps.author}`)
  }

  private watchFolder(): void {
    if (this.unwatch !== null) return
    const watch = this.deps.watch ?? defaultWatch
    try {
      this.unwatch = watch(this.deps.folder, () => this.touched())
    } catch (error) {
      this.deps.log(`memory: ${this.deps.folder} cannot be watched, it syncs on calls only: ${(error as Error).message}`)
    }
  }
}

function defaultSchedule(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms)
  timer.unref?.()
  return () => clearTimeout(timer)
}

function defaultWatch(folder: string, changed: () => void): () => void {
  const watcher = watchFolder(folder, (_event, name) => {
    if (name !== '.git') changed()
  })
  watcher.on('error', () => watcher.close())
  return () => watcher.close()
}

/** Every record file of the folder, read: what `MEMORY.md` indexes. */
function recordFiles(folder: string): Map<string, MemoryFact> {
  const files = new Map<string, MemoryFact>()
  for (const name of readdirSync(folder).sort()) {
    if (!name.endsWith('.md') || name === MEMORY_INDEX) continue
    const text = readText(join(folder, name))
    if (text !== null) files.set(name, parseMemoryFile(text, name.slice(0, -'.md'.length)))
  }
  return files
}

function readText(path: string): string | null {
  try {
    const stat = statSync(path)
    return stat.isFile() && stat.size <= SCAN_LIMIT ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

function writeIfOther(path: string, text: string): void {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text)
}

function list(out: string): string[] {
  return out.split('\0').filter((path) => path !== '')
}
