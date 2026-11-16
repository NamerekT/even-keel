// What the `even-keel` command says after install and update: the page's address, once the page answers (EKR-111).
import { posix, win32 } from 'node:path'
import { listenOf, localUrlOf } from './config.js'

export type PageAddress = { url: string } | { error: string }

/** The address the service listens on, by the rules of `listenOf`: a wrong port is its error, not a throw. */
export function pageAddressOf(env: NodeJS.ProcessEnv): PageAddress {
  try {
    return { url: localUrlOf(listenOf(env)) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** Where the service writes its log: the user journal of the systemd unit on Linux, the file in the data folder elsewhere. */
export function pageLogOf(platform: NodeJS.Platform, home: string): string {
  if (platform === 'linux') return 'journalctl --user -u even-keel'
  return (platform === 'win32' ? win32 : posix).join(home, 'logs', 'even-keel.log')
}

export type PageState =
  | { kind: 'ready'; url: string }
  | { kind: 'silent'; url: string; log: string }
  /** Linux without a systemd user manager: no service runs, the page comes with a foreground `even-keel`. */
  | { kind: 'noService'; url: string }
  | { kind: 'unknown'; error: string }

export function pageMessageOf(state: PageState): string {
  switch (state.kind) {
    case 'ready':
      return `Open ${state.url}`
    case 'silent':
      return `The page at ${state.url} does not answer yet. Log: ${state.log}`
    case 'noService':
      return `Once Even Keel runs, its page is at ${state.url}`
    case 'unknown':
      return `The address of the page is unknown: ${state.error}`
  }
}

/**
 * Whether the CLI opens the page itself: only at the first install from npx and once the page answered, never by SSH,
 * and on Linux only with a display to open it on.
 */
export function opensBrowser(at: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; firstInstall: boolean; responded: boolean }): boolean {
  if (!at.firstInstall || !at.responded) return false
  const ssh = Boolean(at.env.SSH_CONNECTION || at.env.SSH_TTY)
  if (at.platform === 'win32') return true
  if (at.platform === 'darwin') return !ssh
  if (at.platform === 'linux') return !ssh && Boolean(at.env.DISPLAY || at.env.WAYLAND_DISPLAY)
  return false
}

/** The command that opens `url` in the default browser; `null` — none known for the platform. */
export function browserCommandOf(platform: NodeJS.Platform, url: string): [string, string[]] | null {
  if (platform === 'win32') return ['cmd', ['/c', 'start', '', url]]
  if (platform === 'darwin') return ['open', [url]]
  if (platform === 'linux') return ['xdg-open', [url]]
  return null
}

export interface PageWait {
  /** Resolves on any HTTP answer, rejects when there is none. */
  request: (url: string) => Promise<unknown>
  now: () => number
  sleep: (ms: number) => Promise<void>
  /** 0 — ask once. */
  timeoutMs?: number
  intervalMs?: number
}

/** Asks `url` until it answers with any status or `timeoutMs` passes: whether it answered. */
export async function waitForPage(url: string, { request, now, sleep, timeoutMs = 30_000, intervalMs = 1_000 }: PageWait): Promise<boolean> {
  const until = now() + timeoutMs
  for (;;) {
    try {
      await request(url)
      return true
    } catch {
      // Not up yet.
    }
    if (now() >= until) return false
    await sleep(Math.min(intervalMs, until - now()))
  }
}
