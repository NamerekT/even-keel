import { notice, type Notice } from '../notice/notice.js'

/**
 * What the wizard's one field "Folder or repository address" holds, by its text alone (BTN-1093): `address` — a remote
 * git clones; `path` — a full path or one from `~`; `name` — a bare folder name for Even Keel's projects folder;
 * `relative` — a path from the service's working folder, which is never guessed; `none` — none of these.
 */
export type TargetKind =
  | { kind: 'blank' }
  | { kind: 'none' }
  | { kind: 'address'; host: string }
  | { kind: 'path' }
  | { kind: 'name' }
  | { kind: 'relative' }

/** The URL schemes git clones over the network. */
const SCHEMES = new Set(['http', 'https', 'ssh', 'git', 'git+ssh', 'ssh+git'])
const URL_FORM = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i
const URL_HOST = /^(?:[^@/\s]*@)?(\[[^\]]+\]|[^/:\s]+)/
const SCP_FORM = /^(?:[^@\s]+@)?([^@\s:]+):(\S+)$/

/**
 * The kind of the typed text on the service's `platform`. A colon with no slash before it is an scp address, as git
 * reads it (`url_is_local_not_ssh`), except one letter before it on Windows: a drive. Without a platform — the page,
 * before the service answers — a one-letter host is taken for a drive as well.
 */
export function targetKind(input: string, platform?: string): TargetKind {
  if (input === '') return { kind: 'blank' }
  const text = input.trim()
  // eslint-disable-next-line no-control-regex
  if (text === '' || /[\u0000-\u001f\u007f]/.test(text)) return { kind: 'none' }
  const windows = platform === undefined || platform === 'win32'
  const url = URL_FORM.exec(text)
  if (url !== null) {
    const host = URL_HOST.exec(url[2]!)
    if (!SCHEMES.has(url[1]!.toLowerCase()) || /\s/.test(text) || host === null) return { kind: 'none' }
    return { kind: 'address', host: host[1]! }
  }
  const colon = text.indexOf(':')
  const slash = text.indexOf('/')
  const drive = windows && /^[a-z]:/i.test(text)
  if (colon >= 0 && !drive && (slash < 0 || colon < slash)) {
    const scp = SCP_FORM.exec(text)
    return scp === null ? { kind: 'none' } : { kind: 'address', host: scp[1]! }
  }
  if (windows ? /^(?:[a-z]:)?[\\/]/i.test(text) : text.startsWith('/')) return { kind: 'path' }
  if (text === '~' || (windows ? /^~[\\/]/ : /^~\//).test(text)) return { kind: 'path' }
  if (/[\\/~:]/.test(text) || text === '.' || text === '..') return { kind: 'relative' }
  return /\s/.test(text) ? { kind: 'none' } : { kind: 'name' }
}

const WINDOWS_BAD = /[<>:"|?*\\/]/
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i

/** Why a folder's name cannot be made on the platform; `null` — it can. macOS and Linux forbid only a slash. */
export function nameRefusal(name: string, platform: string): Notice | null {
  const dots = name === '.' || name === '..'
  if (platform !== 'win32') return dots || name.includes('/') ? notice('wizard.folderNameSlash', { value: name }) : null
  if (dots || WINDOWS_BAD.test(name)) return notice('wizard.folderName', { value: name })
  if (WINDOWS_DEVICE.test(name)) return notice('wizard.reservedName', { value: name })
  if (/[. ]$/.test(name)) return notice('wizard.nameEnd', { value: name })
  return null
}
