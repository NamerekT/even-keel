/** What a memory file seems to hold that must never reach the memory repository's history (BTN-1645). */
export interface SecretHit {
  kind: string
  /** 1-based */
  line: number
}

const KNOWN: readonly (readonly [string, RegExp])[] = [
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI key', /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}/],
  ['Stripe key', /\b[sr]k_live_[0-9A-Za-z]{20,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['Linear key', /\blin_api_[A-Za-z0-9]{32,}/],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
]

const URL_PASSWORD = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s/@]{6,})@/i
const ASSIGNED = /[A-Za-z0-9_-]*(?:api[_-]?key|secret|token|passw(?:or)?d|credential)[A-Za-z0-9_-]*["']?\s*[:=]\s*["']?([A-Za-z0-9_\-+/=.]{20,})/i
const PLACEHOLDER = /^(?:password|passwd|secret|changeme|example|x+|\*+)$|[<>{}$]/i

/**
 * Keys and passwords in `text`, a line each at most: the formats of known providers, a password inside a URL, and a
 * long random-looking value assigned to a key-like name. Even Keel is installed through npm, so this is its own
 * scanner rather than an outside program; it errs towards a false alarm, which only keeps one file out of a commit.
 */
export function findSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = []
  text.split(/\r?\n/).forEach((content, index) => {
    const kind = kindOf(content)
    if (kind !== null) hits.push({ kind, line: index + 1 })
  })
  return hits
}

function kindOf(line: string): string | null {
  for (const [kind, pattern] of KNOWN) if (pattern.test(line)) return kind
  const url = URL_PASSWORD.exec(line)
  if (url !== null && !PLACEHOLDER.test(url[1]!)) return 'password in a URL'
  const assigned = ASSIGNED.exec(line)
  if (assigned !== null && randomLooking(assigned[1]!)) return 'assigned secret'
  return null
}

/** Letters and digits mixed with more than 3.5 bits a character: a key, not a word or a path. */
function randomLooking(value: string): boolean {
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return false
  const counts = new Map<string, number>()
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1)
  let entropy = 0
  for (const count of counts.values()) {
    const share = count / value.length
    entropy -= share * Math.log2(share)
  }
  return entropy > 3.5
}
