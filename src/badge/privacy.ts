import type { BadgeState, BadgeTask } from './model.js'

/**
 * Why a free text is left out: a string of the service's own (layer 1), a shape (layer 2), the filter itself failed, or
 * its list of strings is not read yet.
 */
export type PrivacyLayer = 'identifier' | 'pattern' | 'error' | 'unready'
/**
 * The free texts of the state the filter reads. A new one gets a name here and a branch in `withoutPrivate`;
 * `action.status`, the session's own status line, is judged while the state is built (`BadgeInputs.statusOk`), since a
 * caught one gives way to the default action, and then once more here as the action's text.
 */
export type PrivacyField = 'titleEn' | 'action.text' | 'action.tool' | 'action.status'

const MIN_LENGTH = 3
/** Words too common to forbid: an account folder called `work` must not empty every badge. */
const COMMON = new Set([
  'admin', 'agent', 'api', 'app', 'badge', 'build', 'chain', 'claude', 'code', 'codex', 'copilot', 'default', 'demo', 'dev', 'docs', 'git', 'global', 'home',
  'local', 'main', 'master', 'node', 'opencode', 'personal', 'project', 'root', 'server', 'service', 'system', 'task', 'tasks', 'test', 'tests', 'user', 'users',
  'web', 'work',
])

/**
 * The last label of a dotted name that makes it a file, not a host: `x.ts` and `badge.md` would otherwise read as hosts
 * of the `.ts` and `.md` zones. Any other dotted name ending in letters counts as a host.
 */
const FILE_ENDINGS = new Set([
  'bat', 'c', 'cfg', 'cjs', 'cmd', 'conf', 'cpp', 'cs', 'css', 'csv', 'dll', 'exe', 'gif', 'go', 'h', 'html', 'ini', 'java', 'jpg', 'js', 'json', 'jsx', 'kt', 'lock',
  'log', 'map', 'md', 'mjs', 'mts', 'pdf', 'php', 'png', 'ps1', 'py', 'rb', 'rs', 'scss', 'sh', 'snap', 'sql', 'svelte', 'svg', 'toml', 'ts', 'tsx', 'ttf', 'txt', 'vue',
  'wasm', 'woff', 'xml', 'yaml', 'yml', 'zip',
])

const SECRET = /(?<![A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{4,}|gh[pousr]_[A-Za-z0-9]{4,}|github_pat_\w+|glpat-[\w-]+|xox[a-z]-[\w-]+|AKIA[0-9A-Z]{8,}|eyJ[A-Za-z0-9_-]{6,})/
const ASSIGNMENT = /[A-Za-z_][A-Za-z0-9_]*=[^\s=>]|(?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*\S/i
const BEARER = /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i
const URL = /[a-z][a-z0-9+.-]*:\/\//i
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}(?![a-z0-9])/i
const DATE_TIME = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/g
const PHONE = /(?<![\w.])\+?\(?\d[\d ().-]{5,}\d(?![\w.])/g
const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/
const COLON_HEX = /(?<![\w:])[0-9a-f:]+(?![\w:])/gi
const DOTTED = /(?<![\w@/\\.-])(?:[a-z0-9-]+\.)+([a-z]{2,})(?![\w-])/gi
const LOCALHOST = /\blocalhost\b/i
const PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\s\\]|~[\\/]|(?<![\w.:<*~/-])\/[\w.~-]+\/[\w.~-]/

/** A number someone could dial: `+` and seven digits, or ten digits without it; dates and times are not counted. */
function hasPhone(text: string): boolean {
  for (const [match] of text.replace(DATE_TIME, ' ').matchAll(PHONE)) {
    const digits = match.replace(/\D/g, '').length
    if (digits >= (match.startsWith('+') ? 7 : 10)) return true
  }
  return false
}

/** IPv6 and MAC addresses: a run of hex groups with `::` or at least five colons, so `12:30:45` stays a time. */
function hasColonAddress(text: string): boolean {
  for (const [match] of text.matchAll(COLON_HEX)) {
    if (!/[0-9a-f]/i.test(match)) continue
    if (match.includes('::') || match.split(':').length > 5) return true
  }
  return false
}

function hasHost(text: string): boolean {
  if (LOCALHOST.test(text)) return true
  for (const match of text.matchAll(DOTTED)) if (!FILE_ENDINGS.has(match[1]!.toLowerCase())) return true
  return false
}

/** Layer 2: whether the text has the shape of a secret, a contact, an address or an absolute path. */
export function looksPrivate(text: string): boolean {
  return SECRET.test(text) || ASSIGNMENT.test(text) || BEARER.test(text) || URL.test(text) || EMAIL.test(text) || IPV4.test(text) || PATH.test(text) || hasHost(text) || hasColonAddress(text) || hasPhone(text)
}

/**
 * The strings a badge must not carry, from what the service knows (layer 1): lower case, no duplicates. An e-mail also
 * gives its name before `@`, an address its host, and a `*.ts.net` host its tailnet. Left out: strings shorter than
 * three characters, common words and `allowed` — the badge's own project.
 */
export function bannedOf(values: Iterable<string | null | undefined>, allowed: Iterable<string | null | undefined> = []): string[] {
  const skip = new Set(COMMON)
  for (const value of allowed) if (typeof value === 'string') skip.add(value.trim().toLowerCase())
  const result = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    for (const form of formsOf(value.trim())) {
      const lower = form.toLowerCase()
      if ([...lower].length >= MIN_LENGTH && !skip.has(lower)) result.add(lower)
    }
  }
  return [...result]
}

function formsOf(value: string): string[] {
  const forms = [value]
  const host = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/@\s]*@)?([^/:?#\s]+)/i.exec(value)?.[1]
  if (host !== undefined) forms.push(host)
  const tailnet = /(?:^|\.)([a-z0-9-]+)\.ts\.net$/i.exec(host ?? value)?.[1]
  if (tailnet !== undefined) forms.push(tailnet)
  const mail = /^([^\s@]+)@[^\s@]+$/.exec(value)?.[1]
  if (mail !== undefined) forms.push(mail)
  return forms
}

/**
 * Which layer keeps `text` off the badge; `null` — it may go. A forbidden string counts where it stands as a word, in
 * any case: the key `NAM` does not hide "name". A failure of the filter is a reason too, and so is a list not read
 * yet (`null`): not sure — not published.
 */
export function privateLayer(text: string, banned: readonly string[] | null): PrivacyLayer | null {
  if (banned === null) return 'unready'
  try {
    if (banned.length > 0) {
      const words = banned.map((each) => each.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
      if (new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, 'iu').test(text)) return 'identifier'
    }
    return looksPrivate(text) ? 'pattern' : null
  } catch {
    return 'error'
  }
}

/**
 * The state as it may leave the service (BTN-931): a free text a layer catches is left out whole, never masked — a
 * title leaves no key, an action keeps only its tool. Both the push and the preview go through here.
 */
export function withoutPrivate(state: BadgeState, banned: readonly string[] | null, report: (field: PrivacyField, layer: PrivacyLayer) => void): BadgeState {
  const layerOf = (field: PrivacyField, text: string): boolean => {
    const layer = privateLayer(text, banned)
    if (layer !== null) report(field, layer)
    return layer !== null
  }
  const active = state.active.map((task) => {
    const result: BadgeTask = { ...task }
    if (result.titleEn !== undefined && layerOf('titleEn', result.titleEn)) delete result.titleEn
    const action = result.action
    if (action !== undefined && action !== null) {
      if (layerOf('action.tool', action.tool)) result.action = null
      else if (action.text !== action.tool && layerOf('action.text', action.text)) result.action = { tool: action.tool, text: action.tool }
    }
    return result
  })
  return { ...state, active }
}
