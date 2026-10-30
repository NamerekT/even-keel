/**
 * Reloading the page on a new build. A page left open over an update runs the old code against the new service, and
 * its lazy chunks are gone from `dist/web` (the build empties it): opening the task card blanked the whole page.
 */

/** The built files a page's `index.html` names; their names carry the hash of their content, so a new build names others. */
export function assetsOf(html: string): string {
  return [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]).sort().join(' ')
}

export interface BuildWatchDeps {
  /** `index.html` as the page was loaded with it. */
  loaded: string
  fetchIndex: () => Promise<string>
  /** Whether a reload loses nothing the user is doing now. */
  idle: () => boolean
  reload: () => void
  /** Calls `check` again a moment later. */
  later: (check: () => void) => void
}

/**
 * Takes the service's start time of each state; after a restart asks the service's `index.html` and reloads the page
 * once that names another build, waiting while the user is busy. A restart on the same build keeps the page.
 */
export function watchBuild(deps: BuildWatchDeps): (startedAt: string) => void {
  const loaded = assetsOf(deps.loaded)
  let seen: string | null = null
  let checking = false
  let reloading = false
  const reloadWhenIdle = () => {
    if (deps.idle()) deps.reload()
    else deps.later(reloadWhenIdle)
  }
  return (startedAt) => {
    if (seen === null) seen = startedAt
    if (startedAt === seen || checking || reloading) return
    checking = true
    deps.fetchIndex().then(
      (html) => {
        checking = false
        seen = startedAt
        if (assetsOf(html) === loaded) return
        reloading = true
        reloadWhenIdle()
      },
      // The state came, the page did not: the next state asks again.
      () => (checking = false),
    )
  }
}

/**
 * No open modal and no text field in focus: a reload loses no input and no open window. A modal the URL reopens
 * (`data-restorable`, the task card) does not count.
 */
export function pageIdle(doc: Document): boolean {
  if (doc.querySelector('dialog[open]:not([data-restorable]), [aria-modal="true"]:not([data-restorable])') !== null) return false
  const focused = doc.activeElement
  return focused === null || !focused.matches('textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"])')
}

const MISSING_CHUNK_KEY = 'even-keel:missing-chunk-reload'
const MISSING_CHUNK_PAUSE_MS = 10_000

/**
 * A lazy chunk the page asked for is gone: the service serves a newer build. Reloads the page, but not twice within
 * a few seconds, so a chunk missing from the new build too does not loop.
 */
export function reloadOnMissingChunk(storage: Pick<Storage, 'getItem' | 'setItem'>, now: number, reload: () => void): void {
  const last = Number(storage.getItem(MISSING_CHUNK_KEY) ?? 0)
  if (now - last < MISSING_CHUNK_PAUSE_MS) return
  storage.setItem(MISSING_CHUNK_KEY, String(now))
  reload()
}
