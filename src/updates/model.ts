import { compareVersions } from './release.js'

/** `git` — a checkout with its sources, run by tsx; `npm` — the package npm installed, only its build (BTN-265). */
export type InstallSource = 'git' | 'npm'

/**
 * Why the page offers no "Update": the service is not run by a service manager (`npm start`), the folder is no git
 * checkout, it has uncommitted changes, HEAD is not the release tag of the installed version (a developer's copy, one
 * a CI builds after every push), the npm package is not a global install, or the checkout is not read yet.
 */
export type UpdateBlock = 'service' | 'git' | 'dirty' | 'tag' | 'global' | 'checking' | 'container'

/** An installation from npm (BTN-265): the update installs the release's version of the package into the same prefix. */
export interface NpmPackage {
  name: string
  /** `--prefix` of the global install the package is in. */
  prefix: string
}

/**
 * `rebuild` — `service/rebuild.ps1` after a green push: the checkout is already where it should be. `follow` — a
 * machine of a hub moves itself to the hub's commit or version after the hub refused its API version (BTN-1275).
 */
export type UpdateMode = 'update' | 'revert' | 'rebuild' | 'follow'

export const UPDATE_STEPS = ['settle', 'stop', 'fetch', 'checkout', 'restore', 'install', 'build', 'start', 'answer', 'launch'] as const
/**
 * `launch` — the service could not start the update process at all; `restore` — the rollback's checkout, or for an npm
 * package the install of the version that ran before; `install` of a package installs the release's version.
 */
export type UpdateStep = (typeof UPDATE_STEPS)[number]

/** What the previous version must read for "Revert" to be safe: the config and `state/`, the state database, Tally. */
export interface StorageVersions {
  schema: number
  database: number
  tally: number
}

export interface Checkout {
  commit: string
  /** `null` — a detached HEAD. */
  branch: string | null
  /** The tags pointing at HEAD. */
  tags: string[]
  /** Changes of tracked files; untracked ones do not count. */
  dirty: boolean
}

export interface StepFailure {
  step: UpdateStep
  /** The end of the failed command's output. */
  output: string
  /** A rebuild's checkout moved off its branch or changed during the run: the step left it as it was (BTN-1426). */
  moved?: true
}

/** A rebuild's target: a commit and the version its `package.json` has. */
export interface UpdateTarget {
  version: string
  tag: string
}

/** `logs/update.json`: how the last update, revert or rebuild ended, written by the update process. */
export interface UpdateRecord {
  mode: UpdateMode
  from: { version: string; commit: string; branch: string | null; tag: string | null; storage: StorageVersions | null }
  /**
   * `tag` is the ref for this run, a commit for rebuild and follow; older rebuilds had no target. A rebuild whose
   * checkout a chain moved on along its branch meanwhile names the commit it built last.
   */
  to: UpdateTarget | null
  startedAt: string
  finishedAt: string
  failed: StepFailure | null
  /**
   * `null` — nothing was rolled back; `failed: null` — the rollback went through. `to` — a rebuild's checkout moved on
   * along its branch after the failure, so the rollback built and started that commit instead of the one before.
   */
  rollback: { failed: StepFailure | null; to?: UpdateTarget } | null
  /** The page's "Close" on the result. */
  seen: boolean
}

export interface PreviousView {
  version: string
  /** Why the page has no "Revert": the storage format changed, or what keeps the checkout from moving. */
  blocked: 'storage' | UpdateBlock | null
}

export interface UpdateProgress {
  mode: 'update' | 'revert'
  target: string
  /** `settling` — waiting for the chains to settle; `running` — the update process has it. */
  phase: 'settling' | 'running'
  /** The projects whose chains are waited for. */
  waiting: string[]
}

export interface UpdateResultView {
  mode: 'update' | 'revert' | 'rebuild'
  from: string
  to: string | null
  at: string
  /** `null` — it went through. */
  step: UpdateStep | null
  output: string
  /** `moved` — a rebuild's checkout moved during the run, so the rollback left it and the running service as they were. */
  rollback: 'none' | 'done' | 'failed' | 'moved'
  rollbackStep: UpdateStep | null
  /** The commit a rebuild's rollback built instead of the one before (`UpdateRecord.rollback.to`). */
  onward?: string
}

/** The tag of the installed version at HEAD; `null` — none. */
export function tagOf(checkout: Checkout, current: string): string | null {
  return checkout.tags.find((tag) => compareVersions(tag, current) === 0) ?? null
}

/** `checkout`: `undefined` — not read yet, `null` — no git checkout. */
export function updateBlock(service: boolean, checkout: Checkout | null | undefined, current: string): UpdateBlock | null {
  if (checkout === undefined) return 'checking'
  if (checkout === null) return 'git'
  if (!service) return 'service'
  if (checkout.dirty) return 'dirty'
  return tagOf(checkout, current) === null ? 'tag' : null
}

/** A package needs no checkout: npm brings any published version back. */
export function packageBlock(service: boolean, prefix: string | null): UpdateBlock | null {
  if (prefix === null) return 'global'
  return service ? null : 'service'
}

export function sameStorage(a: StorageVersions | null, b: StorageVersions): boolean {
  return a !== null && a.schema === b.schema && a.database === b.database && a.tally === b.tally
}

/** "Revert to <version>": only after an update that went through to the installed version from an older release tag. */
export function previousOf(record: UpdateRecord | null, current: string, storage: StorageVersions, block: UpdateBlock | null): PreviousView | null {
  if (record === null || record.mode === 'rebuild' || record.mode === 'follow' || record.failed !== null || record.to === null || record.from.tag === null) return null
  if (compareVersions(record.to.version, current) !== 0) return null
  const order = compareVersions(record.from.version, current)
  if (order === null || order >= 0) return null
  return { version: record.from.version, blocked: !sameStorage(record.from.storage, storage) ? 'storage' : block }
}

/**
 * Whether the record ends on the running version: a run that went through left its target, a failed one the version
 * it came from, a failed rollback either. A record on another version is stale — `even-keel update` from a terminal or
 * a `git pull` by hand moved the install since (BTN-315).
 */
export function leftRunning(record: UpdateRecord, current: string): boolean {
  if (record.mode === 'rebuild' || record.mode === 'follow') return true
  const on = (version: string | undefined) => version !== undefined && compareVersions(version, current) === 0
  if (record.failed === null) return on(record.to?.version)
  return on(record.from.version) || (record.rollback?.failed != null && on(record.to?.version))
}

export function resultView(record: UpdateRecord | null): UpdateResultView | null {
  if (record === null || record.seen || record.mode === 'follow') return null
  const { failed, rollback } = record
  const rebuild = record.mode === 'rebuild'
  if (rebuild && (record.to === null || (failed?.step !== 'start' && failed?.step !== 'answer'))) return null
  const output = [failed?.output, rollback?.failed?.output].filter((text) => text !== undefined && text !== '').join('\n\n')
  return {
    mode: record.mode,
    from: rebuild ? record.from.commit.slice(0, 8) : record.from.version,
    to: (rebuild ? record.to?.tag.slice(0, 8) : record.to?.version) ?? null,
    at: record.finishedAt,
    step: failed?.step ?? null,
    output,
    rollback: rollback === null ? 'none' : rollback.failed === null ? 'done' : rollback.failed.moved === true ? 'moved' : 'failed',
    rollbackStep: rollback?.failed?.step ?? null,
    ...(rollback?.to !== undefined && { onward: rollback.to.tag.slice(0, 8) }),
  }
}

function targetOf(raw: unknown): UpdateTarget | null {
  return isObject(raw) && text(raw.version) !== null && text(raw.tag) !== null ? { version: raw.version as string, tag: raw.tag as string } : null
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null)

function storageOf(raw: unknown): StorageVersions | null {
  if (!isObject(raw)) return null
  const [schema, database, tally] = [count(raw.schema), count(raw.database), count(raw.tally)]
  return schema === null || database === null || tally === null ? null : { schema, database, tally }
}

function failureOf(raw: unknown): StepFailure | null {
  if (!isObject(raw)) return null
  return { step: (text(raw.step) ?? 'launch') as UpdateStep, output: text(raw.output) ?? '', ...(raw.moved === true && { moved: true as const }) }
}

function rollbackOf(raw: unknown): UpdateRecord['rollback'] {
  if (!isObject(raw)) return null
  const to = targetOf(raw.to)
  return { failed: failureOf(raw.failed), ...(to !== null && { to }) }
}

/** `logs/update.json` as read back; a version that wrote another shape leaves what it cannot read out. */
export function recordOf(raw: unknown): UpdateRecord | null {
  if (!isObject(raw) || !isObject(raw.from)) return null
  const mode = raw.mode
  if (mode !== 'update' && mode !== 'revert' && mode !== 'rebuild' && mode !== 'follow') return null
  const { from, to, rollback } = raw
  const version = text(from.version)
  const commit = text(from.commit)
  if (version === null || commit === null) return null
  return {
    mode,
    from: { version, commit, branch: text(from.branch), tag: text(from.tag), storage: storageOf(from.storage) },
    to: targetOf(to),
    startedAt: text(raw.startedAt) ?? '',
    finishedAt: text(raw.finishedAt) ?? '',
    failed: failureOf(raw.failed),
    rollback: rollbackOf(rollback),
    seen: raw.seen === true,
  }
}
