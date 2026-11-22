import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

interface Parsed<T> {
  mtimeMs: number
  size: number
  ino: number
  item: T | undefined
}

/**
 * The parsed `*.json` files of a folder, read at most once per `ttlMs` (BTN-680): the session registries are asked once
 * per account on every sessions tick. A read lists the folder once and parses again only the files whose mtime, size or
 * inode changed since the last one (BTN-1476): the folders keep every session ever started. The owner calls `forget`
 * after its own write; a write by another process shows within `ttlMs`.
 */
export class JsonFolder<T> {
  private kept: { at: number; items: T[] } | undefined
  private files = new Map<string, Parsed<T>>()

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

  /** The next `all` reads the folder again; `name` (`<id>.json`) is parsed anew even if its stamp looks unchanged. */
  forget(name?: string): void {
    this.kept = undefined
    if (name !== undefined) this.files.delete(name)
  }

  private read(): T[] {
    let names: string[]
    try {
      names = readdirSync(this.dir)
    } catch {
      this.files.clear()
      return []
    }
    const files = new Map<string, Parsed<T>>()
    const items: T[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const parsed = this.parsed(name)
      if (parsed === undefined) continue
      files.set(name, parsed)
      if (parsed.item !== undefined) items.push(parsed.item)
    }
    this.files = files
    return items
  }

  private parsed(name: string): Parsed<T> | undefined {
    const file = join(this.dir, name)
    try {
      const stat = statSync(file, { throwIfNoEntry: false })
      if (stat === undefined || !stat.isFile()) return undefined
      const known = this.files.get(name)
      if (known !== undefined && known.mtimeMs === stat.mtimeMs && known.size === stat.size && known.ino === stat.ino) return known
      // A file that cannot be read is not kept and is tried again next time; one that does not parse is kept as nothing.
      const raw = readFileSync(file, 'utf8')
      let item: T | undefined
      try {
        item = this.parse(raw)
      } catch {
        item = undefined
      }
      return { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino, item }
    } catch {
      return undefined
    }
  }
}
