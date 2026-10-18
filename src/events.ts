export type Subscriber = (frame: string) => void

export function formatEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export class EventHub {
  private readonly subscribers = new Set<Subscriber>()
  private readonly last = new Map<string, string>()

  get size(): number {
    return this.subscribers.size
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
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
