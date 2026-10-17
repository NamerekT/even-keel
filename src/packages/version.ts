const VERSION = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/

/**
 * `candidate` is a later version than `installed`: dotted numbers compare as numbers, a pre-release comes before its
 * release; a version that does not parse is later whenever it differs. An install without a version is older than any.
 */
export function isNewer(candidate: string | null, installed: string | null): boolean {
  if (candidate === null) return false
  if (installed === null) return true
  const a = VERSION.exec(candidate)
  const b = VERSION.exec(installed)
  if (a === null || b === null) return candidate !== installed
  const left = a[1]!.split('.').map(Number)
  const right = b[1]!.split('.').map(Number)
  for (let at = 0; at < Math.max(left.length, right.length); at++) {
    const diff = (left[at] ?? 0) - (right[at] ?? 0)
    if (diff !== 0) return diff > 0
  }
  const [pre, old] = [a[2], b[2]]
  if (pre === undefined || old === undefined) return pre === undefined && old !== undefined
  return pre.localeCompare(old, 'en', { numeric: true }) > 0
}
