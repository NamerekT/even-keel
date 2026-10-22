import { CODEX } from '../codex/name.js'
import { COPILOT } from '../copilot/name.js'
import { OPENCODE } from '../opencode/name.js'

const CLAUDE_API = 'https://api.anthropic.com'
const OPENAI_API = 'https://api.openai.com'
const OPENCODE_API = 'https://opencode.ai'
const GITHUB_API = 'https://api.github.com'

/** The API the agent's sign-in renews its tokens against: account calls wait until it answers (EKR-15). */
export function providerUrl(agent: string): string {
  if (agent === OPENCODE) return OPENCODE_API
  if (agent === COPILOT) return GITHUB_API
  return agent === CODEX ? OPENAI_API : CLAUDE_API
}

/** Any HTTP answer, an error status too, means the network is up. */
export async function answers(url: string, timeoutMs: number): Promise<boolean> {
  try {
    await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) })
    return true
  } catch {
    return false
  }
}

export interface ReachabilityOptions {
  probe: (url: string) => Promise<boolean>
  ttlMs: number
  now: () => number
  /** A provider stopped or started answering; that it answers at first is not a change. */
  onChange: (url: string, up: boolean) => void
}

interface Known {
  up: boolean
  at: number
  asking?: Promise<boolean>
}

/**
 * Whether a provider answers, probed at most once per `ttlMs`. After a reboot the service starts before the network,
 * and a CLI call that renews an account's single-use token then may lose the renewal and sign the account out.
 */
export class Reachability {
  private readonly known = new Map<string, Known>()

  constructor(private readonly options: ReachabilityOptions) {}

  up(url: string): Promise<boolean> {
    const known = this.known.get(url)
    if (known?.asking !== undefined) return known.asking
    if (known !== undefined && this.options.now() - known.at < this.options.ttlMs) return Promise.resolve(known.up)
    const asking = this.options.probe(url).then((up) => {
      this.known.set(url, { up, at: this.options.now() })
      if (up !== (known?.up ?? true)) this.options.onChange(url, up)
      return up
    })
    this.known.set(url, { up: known?.up ?? true, at: known?.at ?? -Infinity, asking })
    return asking
  }
}
