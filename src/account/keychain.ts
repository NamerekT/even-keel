import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const SERVICE = 'Claude Code-credentials'
const TTL_MS = 60_000
const TIMEOUT_MS = 3_000
const HEX = /^(?:[0-9a-f]{2})+$/i

/**
 * The macOS Keychain item Claude Code keeps a folder's sign-in in, named as the CLI names it: no `CLAUDE_CONFIG_DIR`
 * gives the bare name, a folder adds `-` and the first 8 hex of the sha256 of its path in NFC (`docs/accounts.md`).
 */
export function keychainService(configDir: string | undefined): string {
  if (!configDir) return SERVICE
  return `${SERVICE}-${createHash('sha256').update(configDir.normalize('NFC')).digest('hex').slice(0, 8)}`
}

export interface SecurityAnswer {
  status: number | null
  stdout: string
  timedOut?: boolean
}

export type SecurityRun = (args: string[]) => SecurityAnswer

function runSecurity(args: string[]): SecurityAnswer {
  const result = spawnSync('security', args, { encoding: 'utf8', timeout: TIMEOUT_MS, windowsHide: true })
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' || result.signal !== null
  return { status: result.status, stdout: result.stdout ?? '', timedOut }
}

/**
 * Reads the secret of a Keychain item through `security find-generic-password -w`. An answer is kept for a minute, as
 * the state broadcast asks for it per account. A read that timed out may be held by an access dialog: that item is
 * never asked for again until the service restarts, so the dialog does not come back every minute.
 */
export class KeychainCredentials {
  private readonly answers = new Map<string, { text: string | undefined; at: number }>()
  private readonly blocked = new Set<string>()

  constructor(
    private readonly security: SecurityRun = runSecurity,
    private readonly warn: (message: string) => void = console.warn,
  ) {}

  read(service: string, now: number = Date.now()): string | undefined {
    if (this.blocked.has(service)) return undefined
    const known = this.answers.get(service)
    if (known !== undefined && now - known.at < TTL_MS) return known.text
    const answer = this.security(['find-generic-password', '-s', service, '-w'])
    if (answer.timedOut) {
      this.blocked.add(service)
      this.warn(`Keychain: reading "${service}" took over ${TIMEOUT_MS} ms, likely an access dialog; not asked again until a restart`)
      return undefined
    }
    const text = answer.status === 0 ? decode(answer.stdout.trim()) : undefined
    this.answers.set(service, { text, at: now })
    return text
  }

  forget(): void {
    this.answers.clear()
  }
}

/** `security -w` prints a secret that is not plain text as hex. */
function decode(text: string): string | undefined {
  if (!text) return undefined
  if (text.startsWith('{') || !HEX.test(text)) return text
  return Buffer.from(text, 'hex').toString('utf8')
}
