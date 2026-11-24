import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { passkeyHost } from '../../../src/access/passkey-host.js'

/** Posts one `/api/<name>` sign-in call and gives its answer; a refusal throws a `NoticeError`. */
export type AuthPost = <T>(name: string, body: object) => Promise<T>

/** A passkey needs a secure context (HTTPS or `localhost`), a host name rather than an IP address and a browser with WebAuthn. */
export function passkeysWork(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !openedByIp() && typeof PublicKeyCredential === 'function'
}

/** The page is open by an IP address, v4 or v6: WebAuthn refuses it as an RP ID even in a secure context (BTN-1632). */
export function openedByIp(hostname: string | undefined = typeof location === 'undefined' ? undefined : location.hostname): boolean {
  return hostname !== undefined && !passkeyHost(hostname)
}

/**
 * `dev:fake` has no authenticator behind it: the browser's dialog is skipped and the fake source answers;
 * `?signIn=nopasskeys` refuses at once, as a browser without passkeys does.
 */
const fake = import.meta.env.MODE === 'fake'

function fakeCeremony<T>(): Promise<T> {
  if (new URLSearchParams(location.search).get('signIn') !== 'nopasskeys') return Promise.resolve({} as T)
  return Promise.reject(Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' }))
}

/**
 * Why a ceremony gave no passkey: `cancelled` — the person closed the browser's dialog or let it time out;
 * `unsupported` — the browser refused with no dialog at all, as Telegram's in-app browser on iOS does (BTN-1630).
 */
export type Refusal = 'cancelled' | 'unsupported'

/** Signs this browser in with a passkey; `true` once in, else why not. */
export async function signInWithPasskey(post: AuthPost): Promise<true | Refusal> {
  const optionsJSON = await post<Parameters<typeof startAuthentication>[0]['optionsJSON']>('auth/passkey/options', {})
  const answer = await ceremony(() => (fake ? fakeCeremony<Awaited<ReturnType<typeof startAuthentication>>>() : startAuthentication({ optionsJSON })))
  if ('refused' in answer) return answer.refused
  await post('auth/passkey', { response: answer.response })
  return true
}

/** Adds a passkey of this device for the name the page is open by; `true` once added, else why not. */
export async function addPasskey(post: AuthPost): Promise<true | Refusal> {
  const optionsJSON = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>('auth/passkey/register/options', {})
  const answer = await ceremony(() => (fake ? fakeCeremony<Awaited<ReturnType<typeof startRegistration>>>() : startRegistration({ optionsJSON })))
  if ('refused' in answer) return answer.refused
  await post('auth/passkey/register', { response: answer.response })
  return true
}

/**
 * A `NotAllowedError` faster than this, with the page never losing focus, came from the browser itself: a dialog
 * a person closes takes the focus and longer than that.
 */
export const NO_DIALOG_MS = 1000

/** What the ceremony watches on the page: the clock and whether the page lost focus since the start. */
export interface PageWatch {
  now(): number
  left(): boolean
  stop(): void
}

/** Runs one browser ceremony; a `NotAllowedError` is a refusal, any other error is thrown. */
export async function ceremony<T>(run: () => Promise<T>, watch: PageWatch = watchPage()): Promise<{ response: T } | { refused: Refusal }> {
  const start = watch.now()
  try {
    return { response: await run() }
  } catch (error) {
    if (!cancelled(error)) throw error
    return { refused: watch.now() - start < NO_DIALOG_MS && !watch.left() ? 'unsupported' : 'cancelled' }
  } finally {
    watch.stop()
  }
}

function watchPage(): PageWatch {
  let left = false
  const away = () => {
    left = true
  }
  window.addEventListener('blur', away)
  document.addEventListener('visibilitychange', away)
  return {
    now: () => performance.now(),
    left: () => left,
    stop: () => {
      window.removeEventListener('blur', away)
      document.removeEventListener('visibilitychange', away)
    },
  }
}

/** The browser says `NotAllowedError` both for a closed dialog and a timeout; the library wraps it with the cause. */
export function cancelled(error: unknown): boolean {
  const name = (each: unknown) => (each instanceof Error || (typeof each === 'object' && each !== null) ? (each as { name?: unknown }).name : undefined)
  return name(error) === 'NotAllowedError' || name((error as { cause?: unknown } | null)?.cause) === 'NotAllowedError'
}
