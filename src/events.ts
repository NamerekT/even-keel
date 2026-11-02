import type { KeyedParts } from './patch.js'

export type Subscriber = (frame: string) => void

export const SOON_WINDOW_MS = 200

export function formatEvent(event: string, data: unknown): string {
  return frameOf(event, JSON.stringify(data))
}

const frameOf = (event: string, json: string) => `event: ${event}\ndata: ${json}\n\n`

interface Entries {
  order: string[]
  json: Map<string, string>
}

/** The JSON of each part last sent, a keyed part's by its entries. */
interface Sent {
  parts: Map<string, string>
  keyed: Map<string, Entries>
}

export class EventHub {
  private readonly subscribers = new Set<Subscriber>()
  private readonly ends = new Map<Subscriber, () => void>()
  private readonly last = new Map<string, string>()
  private readonly sent = new Map<string, Sent>()
  private readonly soon = new Map<string, { produce: () => unknown }>()
  private readonly builtAt = new Map<string, number>()

  /** `parted` — the events whose object data goes in parts after the first frame, with their keyed parts. */
  constructor(private readonly parted: Record<string, KeyedParts> = {}) {}

  get size(): number {
    return this.subscribers.size
  }

  /** `end` closes the subscriber's stream when the hub lets every page go. */
  subscribe(subscriber: Subscriber, end?: () => void): () => void {
    this.subscribers.add(subscriber)
    if (end !== undefined) this.ends.set(subscriber, end)
    return () => {
      this.subscribers.delete(subscriber)
      this.ends.delete(subscriber)
    }
  }

  /** Closes every stream: the pages connect again and meet the guard as it is now (a new token). */
  closeAll(): void {
    const ends = [...this.ends.values()]
    this.subscribers.clear()
    this.ends.clear()
    for (const end of ends) end()
  }

  /**
   * Subscribes a page with the data it starts from, sent whole. The pages already there get the same data as a patch
   * first, so that every page's base is what the hub last sent.
   */
  join(event: string, data: unknown, subscriber: Subscriber, end?: () => void): () => void {
    this.broadcast(event, data)
    subscriber(formatEvent(event, data))
    return this.subscribe(subscriber, end)
  }

  broadcast(event: string, data: unknown): void {
    const keyed = this.parted[event]
    if (keyed !== undefined && typeof data === 'object' && data !== null && !Array.isArray(data)) {
      this.broadcastParts(event, data, keyed)
      return
    }
    const frame = formatEvent(event, data)
    if (this.last.get(event) === frame) return
    this.last.set(event, frame)
    this.send(frame)
  }

  private broadcastParts(event: string, data: object, keyed: KeyedParts): void {
    const now: Sent = { parts: new Map(), keyed: new Map() }
    for (const [name, value] of Object.entries(data)) {
      if (value === undefined) continue
      const entries = keyed[name] === undefined ? null : entriesOf(value, keyed[name])
      if (entries === null) now.parts.set(name, JSON.stringify(value))
      else now.keyed.set(name, entries)
    }
    const before = this.sent.get(event)
    this.sent.set(event, now)
    if (before === undefined) {
      this.send(formatEvent(event, data))
      return
    }
    const parts = [...now.parts].filter(([name, json]) => before.parts.get(name) !== json).map(([name, json]) => `${JSON.stringify(name)}:${json}`)
    const gone = [...before.parts.keys(), ...before.keyed.keys()].filter((name) => !now.parts.has(name) && !now.keyed.has(name))
    const changes = [...now.keyed].flatMap(([name, entries]) => {
      const was = before.keyed.get(name)
      const sameOrder = was !== undefined && was.order.length === entries.order.length && was.order.every((id, index) => entries.order[index] === id)
      const changed = entries.order.filter((id) => was?.json.get(id) !== entries.json.get(id)).map((id) => entries.json.get(id)!)
      if (sameOrder && changed.length === 0) return []
      const order = sameOrder ? '' : `"order":${JSON.stringify(entries.order)},`
      return [`${JSON.stringify(name)}:{"by":${JSON.stringify(keyed[name])},${order}"changed":[${changed.join(',')}]}`]
    })
    const fields = [
      ...(parts.length > 0 ? [`"parts":{${parts.join(',')}}`] : []),
      ...(gone.length > 0 ? [`"gone":${JSON.stringify(gone)}`] : []),
      ...(changes.length > 0 ? [`"keyed":{${changes.join(',')}}`] : []),
    ]
    if (fields.length > 0) this.send(frameOf(`${event}Patch`, `{${fields.join(',')}}`))
  }

  private send(frame: string): void {
    for (const subscriber of this.subscribers) subscriber(frame)
  }

  /**
   * `broadcast` of data that is costly to build, such as the whole state (BTN-691): `produce` runs at most once per
   * `SOON_WINDOW_MS` per event. A call within the window waits for its end, and the calls that pile up meanwhile run
   * only the last producer once. With no page listening nothing is built.
   */
  broadcastSoon(event: string, produce: () => unknown): void {
    const pending = this.soon.get(event)
    if (pending !== undefined) {
      pending.produce = produce
      return
    }
    const wait = (this.builtAt.get(event) ?? -Infinity) + SOON_WINDOW_MS - Date.now()
    if (wait <= 0) {
      this.build(event, produce)
      return
    }
    const slot = { produce }
    this.soon.set(event, slot)
    setTimeout(() => {
      this.soon.delete(event)
      this.build(event, slot.produce)
    }, wait).unref?.()
  }

  private build(event: string, produce: () => unknown): void {
    if (this.subscribers.size === 0) {
      // The next page gets the state at connection, so the old frame must not hide data equal to it.
      this.last.delete(event)
      this.sent.delete(event)
      return
    }
    this.builtAt.set(event, Date.now())
    this.broadcast(event, produce())
  }

  /** Sends the event every time, unlike `broadcast`: it says something happened, not what the data is now. */
  signal(event: string, data: unknown): void {
    this.send(formatEvent(event, data))
  }
}

/** The entries of a keyed part by their ids; `null` — not an array of entries with ids of their own. */
function entriesOf(value: unknown, field: string): Entries | null {
  if (!Array.isArray(value)) return null
  const json = new Map<string, string>()
  for (const entry of value as unknown[]) {
    const id = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>)[field] : undefined
    if (typeof id !== 'string' || json.has(id)) return null
    json.set(id, JSON.stringify(entry))
  }
  return { order: [...json.keys()], json }
}
