export type Subscriber = (frame: string) => void

export const SOON_WINDOW_MS = 200

export function formatEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export class EventHub {
  private readonly subscribers = new Set<Subscriber>()
  private readonly ends = new Map<Subscriber, () => void>()
  private readonly last = new Map<string, string>()
  private readonly soon = new Map<string, { produce: () => unknown }>()
  private readonly builtAt = new Map<string, number>()

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

  broadcast(event: string, data: unknown): void {
    const frame = formatEvent(event, data)
    if (this.last.get(event) === frame) return
    this.last.set(event, frame)
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
      return
    }
    this.builtAt.set(event, Date.now())
    this.broadcast(event, produce())
  }

  /** Sends the event every time, unlike `broadcast`: it says something happened, not what the data is now. */
  signal(event: string, data: unknown): void {
    const frame = formatEvent(event, data)
    for (const subscriber of this.subscribers) subscriber(frame)
  }
}
