import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch as watchFolder, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runGit } from '../../git/run.js'
import type { Git, GitResult } from '../../git/types.js'
import { fileHash, MEMORY_INDEX, MIRROR_MARK, parseMemoryFile, type MemoryFact } from '../record.js'
import { conflictTrailer, openConflicts, pendingConflicts, saveConflicts } from './conflicts.js'
import { flavorOf, MEMORY_FLAVOR, type SyncFlavor, type SyncKind } from './flavor.js'
import { settleTexts, type Settled, type Sides } from './merge.js'
import { reindex } from './reindex.js'
import { findSecrets } from './secrets.js'

/** A change is committed this long after the last edit in the folder. */
export const SETTLE_MS = 30_000
/** After a sync that could not reach the remote, the next try comes this much later, unless an edit or a call comes first. */
export const RETRY_MS = 5 * 60_000
/** The memory repository's own branch: it is Even Keel's repository, never a project's, so no `branch` key applies. */
export const MEMORY_BRANCH = 'main'
export const ATTRIBUTES = MEMORY_FLAVOR.attributes

const PUSH_ROUNDS = 3
const REBASE_STEPS = 200
const SCAN_LIMIT = 1024 * 1024
/** Where a sync puts the texts it merges, inside `.git` so that the folder's watcher never sees them. */
const SCRATCH = '.git/even-keel-merge'

/** What a rebase met of a file changed on both sides: the remote's version and their common one. */
type Met = Omit<Sides, 'own' | 'ownCommitted'>

export interface MemorySyncDeps {
  /** The working copy: a project's memory folder (`sharedMemory`), or the global configuration's (`configStore`). */
  folder: string
  /** The project's bare repository: a path or any address git takes. */
  remote: string
  /** Who the commits are by: the machine's name. */
  author: string
  log(line: string): void
  /** `memory` when absent (BTN-1690, `SyncFlavor`). */
  kind?: SyncKind
  git?: Git
  schedule?(run: () => void, ms: number): () => void
  /** Calls `changed` on every edit in the folder, its subfolders too where `nested`; gives the way to stop. */
  watch?(folder: string, changed: () => void, nested: boolean): () => void
  /** Called after a push brought the remote new commits; never waited for (the hub's mirror, BTN-1649). */
  pushed?(): void
  /** Runs inside each sync before its commit of local edits: files laid into the folder from elsewhere (`ConfigFiles`). */
  beforeCommit?(): void
  /** Runs inside each sync once it is done with the remote, reached or not. */
  afterSync?(): void
  /** After each sync and each `settle`, once `CONFLICTS_FILE` is written: the page's view of them (BTN-1692). */
  conflictsSaved?(): void
}

export interface SyncOutcome {
  /** The folder's files that went into the commit of local edits. */
  committed: string[]
  /** Files kept out of it for what looks like a key (`findSecrets`). */
  withheld: string[]
  /** Records changed on the same lines on both sides: the newer version kept, sessions asked to merge the other. */
  conflicts: string[]
  /** The remote was reached: fetched, rebased onto and pushed what was ahead. */
  reached: boolean
}

/**
 * A project's memory folder kept in step with its bare repository (BTN-1645), on the hub and on a machine alike.
 * A sync commits the folder's edits, fetches, rebases onto the remote (`MEMORY.md` merges by union and is tidied after
 * by `reindex`; a record changed on both sides by `settleTexts`) and pushes. A folder that is missing, empty or not
 * a repository becomes one and takes the remote's history, so an empty folder never deletes a record: only a commit
 * of a deletion does. An empty folder with an empty remote commits nothing. Without the remote the commits stay local
 * until a sync reaches it. One sync runs at a time. After each the conflicts the history leaves open go into
 * `CONFLICTS_FILE` for the hook and the memory tools (BTN-1686). The global configuration is synced the same way, with
 * the differences of its `SyncFlavor` (BTN-1690).
 */
export class MemorySync {
  private readonly git: Git
  private readonly flavor: SyncFlavor
  /** The prefix of its log lines and commit titles. */
  private readonly label: string
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
    this.flavor = flavorOf(deps.kind ?? 'memory')
    this.label = this.flavor.kind
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

  /**
   * A person's choice of a version for a conflict they settle (`SyncFlavor.human`, BTN-1692): `kept` leaves the file as
   * it is, `other` writes the other version into it; either is one commit with the `settled` trailer, then a sync, so
   * the conflict ends on every copy. `false` — no such conflict open with the file as `hash` says: settled already, or
   * the file saved since.
   */
  async settle(file: string, hash: string, take: 'kept' | 'other'): Promise<boolean> {
    const { folder, author } = this.deps
    const done = await this.edit(async () => {
      const conflict = pendingConflicts(folder).find((each) => each.human === true && each.file === file && each.hash === hash)
      if (conflict === undefined) return false
      if (take === 'other') writeFileSync(join(folder, file), conflict.otherText)
      await this.must('add', '--', file)
      const title = `${this.label}: ${file} settled by a person on ${author}, ${take === 'kept' ? 'its version kept' : 'the other version taken'}`
      await this.must('commit', '-q', '--no-verify', '--allow-empty', '-m', title, '-m', `${this.flavor.settled}: ${file}`)
      saveConflicts(folder, pendingConflicts(folder).filter((each) => each.file !== file))
      this.deps.conflictsSaved?.()
      return true
    })
    if (done) {
      this.deps.log(`${this.label}: ${folder} ${file} settled by a person: ${take === 'kept' ? 'the newer version kept' : 'the other version taken'}`)
      await this.sync()
    }
    return done
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
      this.deps.beforeCommit?.()
      await this.commitEdits(outcome)
      for (let round = 0; round < PUSH_ROUNDS && !outcome.reached; round++) {
        const step = await this.exchange(outcome)
        if (step === 'failed') break
        outcome.reached = step === 'pushed'
      }
      this.deps.afterSync?.()
      saveConflicts(this.deps.folder, await openConflicts((...args) => this.run(...args), this.deps.folder, this.flavor))
    } catch (error) {
      this.deps.log(`${this.label}: ${this.deps.folder} sync failed: ${(error as Error).message}`)
    }
    this.deps.conflictsSaved?.()
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
      this.deps.log(`${this.label}: ${folder} is a new working copy of ${remote}`)
    }
    const url = await this.run('remote', 'get-url', 'origin')
    if (url.code !== 0) await this.must('remote', 'add', 'origin', remote)
    else if (url.out !== remote) await this.must('remote', 'set-url', 'origin', remote)
    if (this.rebasing()) {
      await this.run('rebase', '--abort')
      this.deps.log(`${this.label}: ${folder} a rebase was left unfinished: aborted, the local commits are kept`)
    }
    const info = join(folder, '.git', 'info')
    mkdirSync(info, { recursive: true })
    writeIfOther(join(info, 'attributes'), this.flavor.attributes)
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
        this.deps.log(`${this.label}: ${folder} ${path} is not committed: it looks like it holds a key (${where}); remove it from the file`)
      }
    }
    outcome.committed = list(await this.must('diff', '--cached', '--name-only', '-z'))
    if (outcome.committed.length === 0) return
    const files = outcome.committed.length === 1 ? '1 file' : `${outcome.committed.length} files`
    await this.must('commit', '-q', '--no-verify', '-m', `${this.label}: ${files} from ${this.deps.author}`, '-m', outcome.committed.join('\n'))
  }

  /** One round with the remote: fetch, take its history, tidy, push; `rejected` — someone pushed in between. */
  private async exchange(outcome: SyncOutcome): Promise<'pushed' | 'rejected' | 'failed'> {
    const { folder } = this.deps
    // `--prune`: a remote made anew drops the old `origin/main`, else HEAD would look pushed already (BTN-1674).
    const fetched = await this.run('fetch', '-q', '--prune', 'origin')
    if (fetched.code !== 0) {
      this.deps.log(`${this.label}: ${folder} cannot reach its repository, the commits stay here: ${fetched.out.split('\n')[0]}`)
      return 'failed'
    }
    const upstream = `refs/remotes/origin/${MEMORY_BRANCH}`
    const remote = (await this.run('rev-parse', '--verify', '-q', upstream)).code === 0
    if (remote && !(await this.hasHead())) {
      const taken = await this.run('checkout', '-q', '-B', MEMORY_BRANCH, upstream)
      if (taken.code !== 0) {
        this.deps.log(`${this.label}: ${folder} cannot take the repository's files: ${taken.out.split('\n')[0]}`)
        return 'failed'
      }
    } else if (remote && !(await this.rebase(upstream, outcome))) return 'failed'
    // Nothing here and nothing there: no root commit of `.gitattributes` alone, or a copy with history would have to
    // rebase all of it onto that (BTN-1674). The first copy with a file pushes its history as it is.
    if (!(await this.hasHead())) return 'pushed'
    await this.tidy(outcome.withheld)
    if (remote && (await this.must('rev-list', '--count', `${upstream}..HEAD`)) === '0') return 'pushed'
    const pushed = await this.run('push', '-q', 'origin', `HEAD:refs/heads/${MEMORY_BRANCH}`)
    if (pushed.code === 0) {
      this.deps.pushed?.()
      return 'pushed'
    }
    if (/\[rejected\]|fetch first|non-fast-forward/.test(pushed.out)) return 'rejected'
    this.deps.log(`${this.label}: ${folder} cannot push to its repository, the commits stay here: ${pushed.out.split('\n')[0]}`)
    return 'failed'
  }

  /**
   * Local commits onto the remote's; never left unfinished: a file changed on both sides takes its own version for the
   * rest of the rebase, so that it stays in the history, and is settled once the rebase is done (`settleMet`); anything
   * else aborts it.
   */
  private async rebase(upstream: string, outcome: SyncOutcome): Promise<boolean> {
    const { folder } = this.deps
    const met = new Map<string, Met>()
    let step = await this.run('rebase', '-q', '--autostash', upstream)
    for (let n = 0; step.code !== 0; n++) {
      if (!this.rebasing() || n >= REBASE_STEPS) {
        if (this.rebasing()) await this.run('rebase', '--abort')
        this.deps.log(`${this.label}: ${folder} cannot rebase onto its repository, the local commits are kept: ${step.out.split('\n')[0]}`)
        return false
      }
      const unmerged = list((await this.must('diff', '--name-only', '--diff-filter=U', '-z')))
      if (unmerged.length === 0) {
        // The replayed commit came out empty once its conflict was settled.
        step = await this.run('rebase', '--skip')
        continue
      }
      if (!(await this.takeOwn(upstream, met))) {
        await this.run('rebase', '--abort')
        this.deps.log(`${this.label}: ${folder} cannot settle a conflict with its repository (${unmerged.join(', ')}): the local commits are kept`)
        return false
      }
      step = await this.run('rebase', '--continue')
    }
    await this.settleMet(met, outcome)
    return true
  }

  /**
   * Every unmerged path of a stopped rebase takes the own version, the remote's kept in `met` for `settleMet`. During a
   * rebase stage 2 is the upstream's and stage 3 the commit being replayed. A side that deleted the file loses to the
   * side that changed it: only an uncontested deletion removes a record.
   */
  private async takeOwn(upstream: string, met: Map<string, Met>): Promise<boolean> {
    const listed = await this.run('ls-files', '-u', '-z')
    if (listed.code !== 0) return false
    const stages = new Map<string, Set<string>>()
    for (const entry of listed.out.split('\0')) {
      const match = /^\d+ [0-9a-f]+ ([123])\t(.+)$/s.exec(entry)
      if (match !== null) stages.set(match[2]!, (stages.get(match[2]!) ?? new Set()).add(match[1]!))
    }
    for (const [path, has] of stages) {
      const both = has.has('2') && has.has('3')
      if (both && path !== MEMORY_INDEX && !met.has(path)) {
        const remote = await this.stageText(path, '2')
        const base = has.has('1') ? await this.stageText(path, '1') : null
        if (remote === null || (has.has('1') && base === null)) return false
        met.set(path, { base, remote, remoteCommitted: await this.authored(upstream, path) })
      }
      const keep = await this.run('checkout', has.has('3') ? '--theirs' : '--ours', '--', path)
      if (keep.code !== 0 || (await this.run('add', '--', path)).code !== 0) return false
    }
    return true
  }

  /** The exact text of a stage of an unmerged path (`cat-file` would lose its trailing newlines to the runner's trim). */
  private async stageText(path: string, stage: '1' | '2'): Promise<string | null> {
    const scratch = join(this.deps.folder, SCRATCH)
    try {
      if ((await this.run('checkout-index', '-f', `--stage=${stage}`, `--prefix=${SCRATCH}/`, '--', path)).code !== 0) return null
      return readFileSync(join(scratch, path), 'utf8')
    } catch {
      return null
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }

  /** When `path` was last committed on `ref`, by its author's time, which a rebase keeps; 0 — unknown. */
  private async authored(ref: string, path: string): Promise<number> {
    const time = Number((await this.run('log', '-1', '--format=%at', ref, '--', path)).out)
    return Number.isFinite(time) ? time * 1000 : 0
  }

  /**
   * The files the rebase met on both sides, each settled by `settleTexts` against the own version it ended with. A real
   * conflict gets two commits: the first puts the other version into the file, the second the newer one with the
   * trailer (`conflictTrailer`), so the other is the second's parent wherever the history goes.
   */
  private async settleMet(met: ReadonlyMap<string, Met>, outcome: SyncOutcome): Promise<void> {
    const { folder, author } = this.deps
    const finals = new Map<string, string>()
    const others = new Map<string, string>()
    for (const [path, sides] of met) {
      const at = join(folder, path)
      if (!existsSync(at)) continue
      const own = readFileSync(at, 'utf8')
      const ownCommitted = await this.authored('HEAD', path)
      const human = this.flavor.human(path)
      const merge = human ? async () => null : (base: string, mine: string, theirs: string) => this.mergeTexts(base, mine, theirs)
      let settled: Settled = await settleTexts({ ...sides, own, ownCommitted }, merge)
      if (settled.kind === 'newer' && this.flavor.firstMeetingConflicts) settled = { ...settled, kind: 'conflict' }
      if (settled.text !== own) finals.set(path, settled.text)
      if (settled.kind === 'conflict') {
        outcome.conflicts.push(path)
        finals.set(path, settled.text)
        if (settled.newer === 'own') others.set(path, sides.remote)
        const who = human ? 'a person settles the other, it is in the history' : 'sessions are asked to merge the other'
        this.deps.log(`${this.label}: ${folder} ${path} was changed on two machines: the newer version is kept, ${who}`)
      } else if (settled.kind !== 'same') {
        this.deps.log(`${this.label}: ${folder} ${path} was changed on two machines: ${settled.kind === 'merged' ? 'merged' : 'the newer version is kept, they had no common one'}`)
      }
    }
    if (others.size > 0) {
      for (const [path, text] of others) writeFileSync(join(folder, path), text)
      await this.must('add', '--', ...others.keys())
      await this.must('commit', '-q', '--no-verify', '-m', `${this.label}: other versions of ${[...others.keys()].join(', ')} from ${author}`)
    }
    if (finals.size === 0) return
    for (const [path, text] of finals) writeFileSync(join(folder, path), text)
    await this.must('add', '--', ...finals.keys())
    const merged = `${finals.size === 1 ? '1 file' : `${finals.size} files`} merged`
    const title = `${this.label}: ${outcome.conflicts.length > 0 ? `conflict in ${outcome.conflicts.join(', ')}` : merged} from ${author}`
    const trailers = outcome.conflicts.map((path) => conflictTrailer(path, this.flavor.trailer))
    await this.must('commit', '-q', '--no-verify', '--allow-empty', '-m', title, ...(trailers.length > 0 ? ['-m', trailers.join('\n')] : []))
  }

  /** A three-way merge of texts by `git merge-file`; `null` — the same lines changed on both sides. */
  private async mergeTexts(base: string, own: string, remote: string): Promise<string | null> {
    const scratch = join(this.deps.folder, SCRATCH)
    mkdirSync(scratch, { recursive: true })
    try {
      writeFileSync(join(scratch, 'own'), own)
      writeFileSync(join(scratch, 'base'), base)
      writeFileSync(join(scratch, 'remote'), remote)
      const merged = await this.run('merge-file', '-q', `${SCRATCH}/own`, `${SCRATCH}/base`, `${SCRATCH}/remote`)
      return merged.code === 0 ? readFileSync(join(scratch, 'own'), 'utf8') : null
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
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
      const lines = had.split(/\r?\n/)
      const missing = this.flavor.attributes.split('\n').filter((line) => line !== '' && !lines.includes(line))
      if (missing.length > 0) writeFileSync(attributes, `${had}${had === '' || had.endsWith('\n') ? '' : '\n'}${missing.join('\n')}\n`)
      paths.push('.gitattributes')
    }
    const index = join(folder, MEMORY_INDEX)
    if (this.flavor.index && !withheld.includes(MEMORY_INDEX)) {
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
    await this.must('commit', '-q', '--no-verify', '-m', `${this.label}: ${this.flavor.index ? 'index' : 'attributes'} from ${this.deps.author}`)
  }

  private watchFolder(): void {
    if (this.unwatch !== null) return
    const watch = this.deps.watch ?? defaultWatch
    try {
      this.unwatch = watch(this.deps.folder, () => this.touched(), this.flavor.nested)
    } catch (error) {
      this.deps.log(`${this.label}: ${this.deps.folder} cannot be watched, it syncs on calls only: ${(error as Error).message}`)
    }
  }
}

function defaultSchedule(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms)
  timer.unref?.()
  return () => clearTimeout(timer)
}

function defaultWatch(folder: string, changed: () => void, nested: boolean): () => void {
  const watcher = watchFolder(folder, { recursive: nested }, (_event, name) => {
    if (name?.split(/[\\/]/)[0] !== '.git') changed()
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
