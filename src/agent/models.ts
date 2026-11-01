import type { AccountHome } from '../account/homes.js'
import { notice, type Notice } from '../notice/notice.js'
import type { ModelList } from './contract.js'
import { copilotModel, copilotUnsupported } from '../opencode/support.js'

/** How long a list read from the agent is kept: `opencode models` and Codex's app-server take seconds. */
const FRESH_MS = 10 * 60_000
/** How long an agent that did not answer is left alone. */
const RETRY_MS = 60_000

export interface ModelCatalogDeps {
  /** `Agent.models` of the account's agent; `null` — the agent has no list. */
  list: (home: AccountHome) => Promise<ModelList | null>
  /** The agent's title, for the refusal. */
  title: (home: AccountHome) => string
  /** The account as the page names it. */
  name: (home: AccountHome) => string
  now: () => number
  log: (line: string) => void
}

interface Kept {
  list: ModelList | null
  at: number
}

/**
 * The models of each account folder, read from its agent and kept for a while (BTN-336): the page offers them in the
 * model fields, and a launch is refused on a model a complete list does not have — OpenCode's first turn on one dies
 * with an "Unexpected server error" and nothing else.
 */
export class ModelCatalog {
  private readonly kept = new Map<string, Kept>()
  private readonly reading = new Map<string, Promise<ModelList | null>>()

  constructor(private readonly deps: ModelCatalogDeps) {}

  /** A provider refused a model after the list had allowed it; read that account again next time. */
  invalidate(account: string): void {
    this.kept.delete(account)
    this.reading.delete(account)
  }

  /** The account's list; `null` — its agent has none or did not answer. */
  async of(home: AccountHome): Promise<ModelList | null> {
    const kept = this.kept.get(home.key)
    if (kept !== undefined && this.deps.now() - kept.at < (kept.list === null ? RETRY_MS : FRESH_MS)) return kept.list
    return this.read(home)
  }

  /**
   * Why a session of `task` cannot start on `model` in the account; `undefined` — it can, or nothing says it cannot. A
   * kept list without the model is read anew first: the account may have signed in to another provider since.
   */
  async refusal(home: AccountHome, task: string, model: string | null): Promise<Notice | undefined> {
    if (home.agent === 'opencode' && copilotModel(model)) return copilotUnsupported()
    if (model === null) return undefined
    const had = this.kept.has(home.key)
    let list = await this.of(home)
    if (had && lacks(list, model)) list = await this.read(home)
    if (list === null || !lacks(list, model)) return undefined
    return notice('chain.unknownModel', { task, model, agent: this.deps.title(home), account: this.deps.name(home), known: nearest(list.models, model) })
  }

  private read(home: AccountHome): Promise<ModelList | null> {
    const running = this.reading.get(home.key)
    if (running !== undefined) return running
    const read = this.deps.list(home).then(
      (list) => home.agent === 'opencode' && list !== null ? { ...list, models: list.models.filter(model => !copilotModel(model)) } : list,
      (error: unknown) => {
        this.deps.log(`models: ${home.key} did not list its models: ${error instanceof Error ? error.message : String(error)}`)
        return null
      },
    )
    const kept = read.then((list) => {
      if (this.reading.get(home.key) === kept) {
        this.kept.set(home.key, { list, at: this.deps.now() })
        this.reading.delete(home.key)
      }
      return list
    })
    this.reading.set(home.key, kept)
    return kept
  }
}

/**
 * `models` with those of `wanted`'s provider (the part before `/`) first, the longest common name prefix ahead, then the
 * rest in the listed order (BTN-585): the refusal names only the first few, and a list opening with another provider's
 * models reads as if the account had none of the asked one.
 */
export function nearest(models: string[], wanted: string): string[] {
  const cut = wanted.indexOf('/')
  if (cut < 0) return models
  const provider = wanted.slice(0, cut + 1)
  const name = wanted.slice(cut + 1)
  const own = models.filter(model => model.startsWith(provider))
  const shared = (model: string) => {
    const other = model.slice(provider.length)
    let at = 0
    while (at < name.length && at < other.length && name[at] === other[at]) at++
    return at
  }
  return [...own.sort((a, b) => shared(b) - shared(a)), ...models.filter(model => !model.startsWith(provider))]
}

function lacks(list: ModelList | null, model: string): boolean {
  return list !== null && list.complete && !list.models.includes(model)
}
