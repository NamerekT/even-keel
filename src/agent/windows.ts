// The context window each account's sessions get on a model, as the agent itself reports it (BTN-187). Asking
// takes a CLI call, so answers are separated by launch settings and kept until the CLI or account settings change.

export interface ContextWindowsOptions {
  /** `task` — the one whose session asked, for the settings its project's sessions run with. */
  probe: (account: string, model: string, task: string, settings?: string) => Promise<number | null>
  /** What the answer depends on besides the model; a new stamp asks again. */
  stamp: (account: string) => Promise<string>
  /** How often the stamp is looked at, and how soon a failed question is asked again. */
  recheckMs: number
  now?: () => number
  onError: (error: unknown) => void
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

  constructor(private readonly options: ContextWindowsOptions) {}

  /** The window for the account, model and original launch settings; `null` — not measured yet. */
  peek(account: string, model: string, task: string, settings?: string): number | null {
    const key = JSON.stringify([account, model, settings])
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
      const window = known?.stamp === stamp ? known.window : await this.options.probe(account, model, task, settings)
      this.known.set(key, { stamp, window, checkedAt: this.now() })
    } catch (error) {
      this.known.set(key, { stamp: null, window: known?.window ?? null, checkedAt: this.now() })
      this.options.onError(error)
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}
