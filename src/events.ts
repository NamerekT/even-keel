export type Subscriber = (frame: string) => void

export function formatEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export class EventHub {
  private readonly subscribers = new Set<Subscriber>()
  private readonly ends = new Map<Subscriber, () => void>()
  private readonly last = new Map<string, string>()

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

  /** Sends the event every time, unlike `broadcast`: it says something happened, not what the data is now. */
  signal(event: string, data: unknown): void {
    const frame = formatEvent(event, data)
    for (const subscriber of this.subscribers) subscriber(frame)
  }
}
