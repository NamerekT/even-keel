import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const SERVICE = 'Claude Code-credentials'
/** The `-a` the CLI writes its sign-in item with (CLI 2.1.317). */
const ACCOUNT = 'claude-code-user'
const NOT_FOUND = 44
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

export type SecurityRun = (args: string[], input?: string) => SecurityAnswer

function runSecurity(args: string[], input?: string): SecurityAnswer {
  const result = spawnSync('security', args, { encoding: 'utf8', input, timeout: TIMEOUT_MS, windowsHide: true })
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

  /**
   * Carries a folder's sign-in item to the name of the folder's new path (BTN-745): the `.pending-*` folder of "Add
   * account" is renamed after the sign-in, and its item would stay behind matching no folder. An item already under the
   * new name wins and the old one is only deleted; a failed write keeps the old one. The secret goes to `security -i` on
   * stdin as hex, as the CLI writes it, never in the arguments.
   */
  move(from: string, to: string): void {
    this.forget()
    const old = this.ask(['find-generic-password', '-a', ACCOUNT, '-s', from, '-w'])
    if (old?.status !== 0) return
    const text = decode(old.stdout.trim())
    if (text === undefined) return
    const present = this.ask(['find-generic-password', '-a', ACCOUNT, '-s', to])
    if (present === undefined) return
    if (present.status === NOT_FOUND) {
      const hex = Buffer.from(text, 'utf8').toString('hex')
      const written = this.ask(['-i'], `add-generic-password -U -a "${ACCOUNT}" -s "${to}" -X "${hex}"\n`)
      if (written?.status !== 0) {
        this.warn(`Keychain: could not write "${to}"; the sign-in stays under "${from}"`)
        return
      }
    } else if (present.status !== 0) return
    if (this.ask(['delete-generic-password', '-a', ACCOUNT, '-s', from])?.status !== 0) this.warn(`Keychain: could not delete "${from}"`)
  }

  /** One `security` call; `undefined` when it timed out, likely on an access dialog. */
  private ask(args: string[], input?: string): SecurityAnswer | undefined {
    const answer = this.security(args, input)
    if (!answer.timedOut) return answer
    this.warn(`Keychain: "security ${args[0]}" took over ${TIMEOUT_MS} ms, likely an access dialog`)
    return undefined
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
