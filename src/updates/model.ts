import { compareVersions } from './release.js'

/** `git` — a checkout with its sources, run by tsx; `npm` — the package npm installed, only its build (BTN-265). */
export type InstallSource = 'git' | 'npm'

/**
 * Why the page offers no "Update": the service is not run by a service manager (`npm start`), the folder is no git
 * checkout, it has uncommitted changes, HEAD is not the release tag of the installed version (a developer's copy, one
 * a CI builds after every push), the npm package is not a global install, or the checkout is not read yet.
 */
export type UpdateBlock = 'service' | 'git' | 'dirty' | 'tag' | 'global' | 'checking'

/** An installation from npm (BTN-265): the update installs the release's version of the package into the same prefix. */
export interface NpmPackage {
  name: string
  /** `--prefix` of the global install the package is in. */
  prefix: string
}

/** `rebuild` — `service/rebuild.ps1` after a green push: the checkout is already where it should be. */
export type UpdateMode = 'update' | 'revert' | 'rebuild'

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
}

/** `logs/update.json`: how the last update, revert or rebuild ended, written by the update process. */
export interface UpdateRecord {
  mode: UpdateMode
  from: { version: string; commit: string; branch: string | null; tag: string | null; storage: StorageVersions | null }
  /** `null` for a rebuild. */
  to: { version: string; tag: string } | null
  startedAt: string
  finishedAt: string
  failed: StepFailure | null
  /** `null` — nothing was rolled back; `failed: null` — the rollback went through. */
  rollback: { failed: StepFailure | null } | null
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
  mode: 'update' | 'revert'
  from: string
  to: string | null
  at: string
  /** `null` — it went through. */
  step: UpdateStep | null
  output: string
  rollback: 'none' | 'done' | 'failed'
  rollbackStep: UpdateStep | null
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
  if (record === null || record.mode === 'rebuild' || record.failed !== null || record.to === null || record.from.tag === null) return null
  if (compareVersions(record.to.version, current) !== 0) return null
  const order = compareVersions(record.from.version, current)
  if (order === null || order >= 0) return null
  return { version: record.from.version, blocked: !sameStorage(record.from.storage, storage) ? 'storage' : block }
}

export function resultView(record: UpdateRecord | null): UpdateResultView | null {
  if (record === null || record.seen || record.mode === 'rebuild') return null
  const { failed, rollback } = record
  const output = [failed?.output, rollback?.failed?.output].filter((text) => text !== undefined && text !== '').join('\n\n')
  return {
    mode: record.mode,
    from: record.from.version,
    to: record.to?.version ?? null,
    at: record.finishedAt,
    step: failed?.step ?? null,
    output,
    rollback: rollback === null ? 'none' : rollback.failed === null ? 'done' : 'failed',
    rollbackStep: rollback?.failed?.step ?? null,
  }
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
  return { step: (text(raw.step) ?? 'launch') as UpdateStep, output: text(raw.output) ?? '' }
}

/** `logs/update.json` as read back; a version that wrote another shape leaves what it cannot read out. */
export function recordOf(raw: unknown): UpdateRecord | null {
  if (!isObject(raw) || !isObject(raw.from)) return null
  const mode = raw.mode
  if (mode !== 'update' && mode !== 'revert' && mode !== 'rebuild') return null
  const { from, to, rollback } = raw
  const version = text(from.version)
  const commit = text(from.commit)
  if (version === null || commit === null) return null
  const target = isObject(to) && text(to.version) !== null && text(to.tag) !== null ? { version: to.version as string, tag: to.tag as string } : null
  return {
    mode,
    from: { version, commit, branch: text(from.branch), tag: text(from.tag), storage: storageOf(from.storage) },
    to: target,
    startedAt: text(raw.startedAt) ?? '',
    finishedAt: text(raw.finishedAt) ?? '',
    failed: failureOf(raw.failed),
    rollback: isObject(rollback) ? { failed: failureOf(rollback.failed) } : null,
    seen: raw.seen === true,
  }
}
