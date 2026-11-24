import { startAuthentication, startRegistration } from '@simplewebauthn/browser'

/** Posts one `/api/<name>` sign-in call and gives its answer; a refusal throws a `NoticeError`. */
export type AuthPost = <T>(name: string, body: object) => Promise<T>

/** A passkey needs a secure context (HTTPS or `localhost`) and a browser with WebAuthn. */
export function passkeysWork(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof PublicKeyCredential === 'function'
}

/** `dev:fake` has no authenticator behind it: the browser's dialog is skipped and the fake source answers. */
const fake = import.meta.env.MODE === 'fake'

/** Signs this browser in with a passkey; `false` — the person closed the browser's dialog. */
export async function signInWithPasskey(post: AuthPost): Promise<boolean> {
  const optionsJSON = await post<Parameters<typeof startAuthentication>[0]['optionsJSON']>('auth/passkey/options', {})
  const response = await ceremony(() => (fake ? Promise.resolve({}) : startAuthentication({ optionsJSON })))
  if (response === null) return false
  await post('auth/passkey', { response })
  return true
}

/** Adds a passkey of this device for the name the page is open by; `false` — cancelled in the browser's dialog. */
export async function addPasskey(post: AuthPost): Promise<boolean> {
  const optionsJSON = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>('auth/passkey/register/options', {})
  const response = await ceremony(() => (fake ? Promise.resolve({}) : startRegistration({ optionsJSON })))
  if (response === null) return false
  await post('auth/passkey/register', { response })
  return true
}

async function ceremony<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (error) {
    if (cancelled(error)) return null
    throw error
  }
}

/** The browser says `NotAllowedError` both for a closed dialog and a timeout; the library wraps it with the cause. */
export function cancelled(error: unknown): boolean {
  const name = (each: unknown) => (each instanceof Error || (typeof each === 'object' && each !== null) ? (each as { name?: unknown }).name : undefined)
  return name(error) === 'NotAllowedError' || name((error as { cause?: unknown } | null)?.cause) === 'NotAllowedError'
}
