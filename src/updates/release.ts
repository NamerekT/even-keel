import type { InstallSource, PreviousView, UpdateBlock, UpdateProgress, UpdateResultView } from './model.js'

/** The `updates` key of the config. */
export interface UpdateSettings {
  /** The service asks GitHub for the latest release; off — it never goes there. */
  check: boolean
  /** The page shows a toast about a newer release; off — only the mark next to the version. */
  notify: boolean
  /** The version whose toast the user closed; a later one shows it again. */
  dismissed: string | null
}

export interface Release {
  version: string
  /** The git tag, `v0.2.0`: what the update checks out. */
  tag: string
  /** The release's page on GitHub, or the list of releases. */
  url: string
}

/** A release with its description on GitHub: the release's section of the CHANGELOG. */
export interface ReleaseNote extends Release {
  body: string
  /** What its `### Reverted` section says; `null` — the release reverts nothing. */
  reverted: string | null
}

export interface UpdatesView {
  /** The installed version, `version` of `package.json`. */
  current: string
  /** A release newer than the installed version; `null` — none, or the check is off. */
  available: Release | null
  toast: boolean
  /** Every release newer than the installed version, newest first. */
  notes: ReleaseNote[]
  /** How Even Keel was installed: the page tells how an update goes by it. */
  source: InstallSource
  /** Why the page offers no "Update"; `null` — it does. */
  blocked: UpdateBlock | null
  /** The version an update came from, for "Revert"; `null` — none. */
  previous: PreviousView | null
  progress: UpdateProgress | null
  /** How the last update or revert ended, until the page closes it. */
  result: UpdateResultView | null
}

export const DEFAULT_UPDATES: Readonly<UpdateSettings> = Object.freeze({ check: true, notify: true, dismissed: null })

interface Version {
  core: [number, number, number]
  pre: string[]
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

function versionOf(text: string): Version | null {
  const match = VERSION.exec(text.trim())
  if (match === null) return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4]?.split('.') ?? [] }
}

/** Semver order of two versions, a tag's leading `v` allowed; `null` when either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const left = versionOf(a)
  const right = versionOf(b)
  if (left === null || right === null) return null
  for (let at = 0; at < 3; at++) {
    if (left.core[at] !== right.core[at]) return left.core[at]! - right.core[at]!
  }
  if (left.pre.length === 0 || right.pre.length === 0) return right.pre.length - left.pre.length
  for (let at = 0; at < Math.min(left.pre.length, right.pre.length); at++) {
    const order = compareIdentifiers(left.pre[at]!, right.pre[at]!)
    if (order !== 0) return order
  }
  return left.pre.length - right.pre.length
}

function compareIdentifiers(a: string, b: string): number {
  const numeric = (text: string) => /^\d+$/.test(text)
  if (numeric(a) && numeric(b)) return Number(a) - Number(b)
  if (numeric(a) !== numeric(b)) return numeric(a) ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** One release of `GET /repos/{repo}/releases`; `null` for a draft, a prerelease or a tag that is not a version. */
export function releaseOf(answer: unknown, repo: string): ReleaseNote | null {
  if (typeof answer !== 'object' || answer === null) return null
  const { tag_name: tag, html_url: url, draft, prerelease, body } = answer as Record<string, unknown>
  if (draft === true || prerelease === true || typeof tag !== 'string') return null
  const version = versionOf(tag)
  if (version === null || version.pre.length > 0) return null
  const notes = typeof body === 'string' ? body.replace(/\r\n/g, '\n').trim() : ''
  return {
    version: version.core.join('.'),
    tag,
    url: typeof url === 'string' && url !== '' ? url : `https://github.com/${repo}/releases`,
    body: notes,
    reverted: revertedOf(notes),
  }
}

/** The answer of `GET /repos/{repo}/releases`: its published releases, newest first. */
export function releasesOf(answer: unknown, repo: string): ReleaseNote[] {
  if (!Array.isArray(answer)) return []
  const releases = answer.map((item) => releaseOf(item, repo)).filter((release) => release !== null)
  return releases.sort((a, b) => compareVersions(b.version, a.version) ?? 0)
}

/**
 * The text under a `### Reverted` heading of a release's notes, up to the next heading of the same or a higher level;
 * `null` — no such heading. A heading with nothing under it still marks the release as a revert.
 */
export function revertedOf(notes: string): string | null {
  const lines = notes.split(/\r?\n/)
  const start = lines.findIndex((line) => /^###\s+Reverted\s*#*\s*$/i.test(line.trim()))
  if (start < 0) return null
  const end = lines.findIndex((line, at) => at > start && /^#{1,3}\s/.test(line.trim()))
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim()
}

/** `owner/name` of the `repository` field of `package.json` when it is on GitHub. */
export function repositoryOf(field: unknown): string | null {
  const text = typeof field === 'object' && field !== null ? (field as { url?: unknown }).url : field
  if (typeof text !== 'string') return null
  const match =
    /^(?:git\+)?(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(text) ??
    /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(text) ??
    /^(?:github:)?([\w.-]+)\/([\w.-]+)$/.exec(text)
  return match === null ? null : `${match[1]}/${match[2]}`
}

export type ReleasesView = Pick<UpdatesView, 'current' | 'available' | 'toast' | 'notes'>

/**
 * What the page shows of the releases (`releases` newest first): the mark for a newer release, the toast unless toasts
 * are off or this version's was closed, and the notes of every release newer than the installed one.
 */
export function updatesView(current: string, releases: readonly ReleaseNote[], settings: UpdateSettings): ReleasesView {
  const notes = settings.check ? releases.filter((release) => (compareVersions(release.version, current) ?? 0) > 0) : []
  const latest = notes[0]
  const available = latest === undefined ? null : { version: latest.version, tag: latest.tag, url: latest.url }
  return { current, available, toast: available !== null && settings.notify && settings.dismissed !== available.version, notes }
}
