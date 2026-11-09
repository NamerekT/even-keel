// The context window each account's sessions get on a model, as the agent itself reports it (BTN-187). Asking
// takes a CLI call, so answers are separated by launch settings and kept until the CLI or account settings change.
// They are kept through a restart too (BTN-946): a new start shows the saved window and asks only for a changed stamp.

export interface ContextWindowsOptions {
  /** `task` — the one whose session asked, for the settings its project's sessions run with. */
  probe: (account: string, model: string, task: string, settings?: string) => Promise<number | null>
  /** What the answer depends on besides the model; a new stamp asks again. */
  stamp: (account: string) => Promise<string>
  /** How often the stamp is looked at, and how soon a failed question is asked again. */
  recheckMs: number
  now?: () => number
  onError: (error: unknown) => void
  /** The windows measured before this start. */
  saved?: SavedWindow[]
  /** A new answer of the agent, to keep through a restart. */
  save?: (window: SavedWindow) => void
}

/** One answer of the agent, as the state database keeps it (`context_windows`, `docs/storage.md`). */
export interface SavedWindow {
  account: string
  model: string
  /** The session's original launch settings; `null` — none. */
  settings: string | null
  stamp: string
  /** `null` — the agent's answer named no window. */
  window: number | null
  measuredAt: number
}

interface Known {
  /** `null` — the last question failed, ask again at the next recheck. */
  stamp: string | null
  window: number | null
  checkedAt: number
}

export class ContextWindows {
  private readonly known = new Map<string, Known>()
  private readonly asking = new Map<string, Promise<void>>()
  /** The probes waiting for their turn: one CLI call at a time, so a start's burst does not time out in the folder's queue. */
  private readonly turns: (() => void)[] = []
  private probing = false

  constructor(private readonly options: ContextWindowsOptions) {
    for (const saved of options.saved ?? []) {
      // Checked at the first peek: the stamp may have changed while the service was down.
      this.known.set(keyOf(saved.account, saved.model, saved.settings ?? undefined), { stamp: saved.stamp, window: saved.window, checkedAt: -Infinity })
    }
  }

  /** The window for the account, model and original launch settings; `null` — not measured yet. */
  peek(account: string, model: string, task: string, settings?: string): number | null {
    const key = keyOf(account, model, settings)
    const known = this.known.get(key)
    if ((known === undefined || this.now() - known.checkedAt >= this.options.recheckMs) && !this.asking.has(key)) {
      const asked = this.ask(key, account, model, task, known, settings).finally(() => this.asking.delete(key))
      this.asking.set(key, asked)
    }
    return known?.window ?? null
  }

  /** Settles once no question is out; for tests. */
  async idle(): Promise<void> {
    while (this.asking.size > 0) await Promise.all(this.asking.values())
  }

  private async ask(key: string, account: string, model: string, task: string, known: Known | undefined, settings?: string): Promise<void> {
    try {
      const stamp = await this.options.stamp(account)
      if (known?.stamp === stamp) {
        this.known.set(key, { stamp, window: known.window, checkedAt: this.now() })
        return
      }
      const window = await this.inTurn(() => this.options.probe(account, model, task, settings))
      const measuredAt = this.now()
      this.known.set(key, { stamp, window, checkedAt: measuredAt })
      this.options.save?.({ account, model, settings: settings ?? null, stamp, window, measuredAt })
    } catch (error) {
      this.known.set(key, { stamp: null, window: known?.window ?? null, checkedAt: this.now() })
      this.options.onError(error)
    }
  }

  private async inTurn<T>(call: () => Promise<T>): Promise<T> {
    if (this.probing) await new Promise<void>((turn) => this.turns.push(turn))
    this.probing = true
    try {
      return await call()
    } finally {
      const next = this.turns.shift()
      if (next === undefined) this.probing = false
      else next()
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}

function keyOf(account: string, model: string, settings: string | undefined): string {
  return JSON.stringify([account, model, settings])
}
