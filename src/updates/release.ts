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
  /** The release's page on GitHub, or the list of releases. */
  url: string
}

export interface UpdatesView {
  /** The installed version, `version` of `package.json`. */
  current: string
  /** A release newer than the installed version; `null` — none, or the check is off. */
  available: Release | null
  toast: boolean
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

/** The answer of `GET /repos/{repo}/releases/latest`; `null` for a draft, a prerelease or a tag that is not a version. */
export function releaseOf(answer: unknown, repo: string): Release | null {
  if (typeof answer !== 'object' || answer === null) return null
  const { tag_name: tag, html_url: url, draft, prerelease } = answer as Record<string, unknown>
  if (draft === true || prerelease === true || typeof tag !== 'string') return null
  const version = versionOf(tag)
  if (version === null || version.pre.length > 0) return null
  return { version: version.core.join('.'), url: typeof url === 'string' && url !== '' ? url : `https://github.com/${repo}/releases` }
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

/** What the page shows: the mark for a newer release, and the toast unless toasts are off or this version's was closed. */
export function updatesView(current: string, latest: Release | null, settings: UpdateSettings): UpdatesView {
  const order = latest === null ? null : compareVersions(latest.version, current)
  const available = settings.check && order !== null && order > 0 ? latest : null
  return { current, available, toast: available !== null && settings.notify && settings.dismissed !== available.version }
}
