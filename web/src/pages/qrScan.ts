/**
 * "Scan a QR" of the sign-in screen (BTN-1657): the pure parts. An installed app on an iPhone keeps its own cookies,
 * apart from Safari's, and the system camera opens a link in Safari, so the app reads the invitation's QR itself and
 * opens the link in its own window. The decoder is `qrRead.ts`, loaded only with the scanner.
 */

interface CameraScope {
  isSecureContext?: boolean
  navigator?: { mediaDevices?: { getUserMedia?: unknown; enumerateDevices?: () => Promise<Array<{ kind: string }>> } }
}

/**
 * Whether this browser has a camera to scan with: a secure page with `getUserMedia` and a video input among the devices.
 * The devices are listed before any permission, with their kinds though without labels.
 */
export async function cameraHere(scope: CameraScope): Promise<boolean> {
  const media = scope.navigator?.mediaDevices
  if (scope.isSecureContext !== true || typeof media?.getUserMedia !== 'function') return false
  if (typeof media.enumerateDevices !== 'function') return true
  try {
    return (await media.enumerateDevices()).some((device) => device.kind === 'videoinput')
  } catch {
    return false
  }
}

/** What a scanned code is: an invitation of this address to open, one of another address, or something else. */
export type Scanned = { at: 'invite'; url: string } | { at: 'elsewhere'; host: string } | { at: 'other' }

/**
 * The invitation in a scanned text (`<origin>/invite#<secret>`, `inviteLink`). Only this page's own origin is opened:
 * another one would take the app out of its window and its cookies, and a code from anywhere must not navigate anywhere.
 */
export function scannedInvite(text: string, origin: string): Scanned {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return { at: 'other' }
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.pathname !== '/invite' || url.hash.length < 2) return { at: 'other' }
  return url.origin === origin ? { at: 'invite', url: url.href } : { at: 'elsewhere', host: url.host }
}

/** Why the camera gave nothing, by the error of `getUserMedia`. */
export function cameraProblem(error: unknown): 'blocked' | 'noCamera' | 'failed' {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'blocked'
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') return 'noCamera'
  return 'failed'
}
