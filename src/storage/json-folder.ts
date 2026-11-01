import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The parsed `*.json` files of a folder, read at most once per `ttlMs` (BTN-680): the session registries are asked once
 * per account on every sessions tick, and each read parses every session file ever kept on the event loop. The owner
 * calls `forget` after its own write; a write by another process shows within `ttlMs`.
 */
export class JsonFolder<T> {
  private kept: { at: number; items: T[] } | undefined

  constructor(
    private readonly dir: string,
    private readonly parse: (raw: string) => T | undefined,
    private readonly ttlMs = 1_000,
    private readonly now: () => number = Date.now,
  ) {}

  all(): T[] {
    const now = this.now()
    if (this.kept === undefined || now - this.kept.at >= this.ttlMs) this.kept = { at: now, items: this.read() }
    return this.kept.items
  }

  forget(): void {
    this.kept = undefined
  }

  private read(): T[] {
    let names: string[]
    try {
      names = readdirSync(this.dir)
    } catch {
      return []
    }
    return names.filter((name) => name.endsWith('.json')).flatMap((name) => {
      try {
        const item = this.parse(readFileSync(join(this.dir, name), 'utf8'))
        return item === undefined ? [] : [item]
      } catch {
        return []
      }
    })
  }
}
