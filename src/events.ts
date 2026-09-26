export type Subscriber = (frame: string) => void

export function formatEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export class EventHub {
  private readonly subscribers = new Set<Subscriber>()

  get size(): number {
    return this.subscribers.size
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  broadcast(event: string, data: unknown): void {
    const frame = formatEvent(event, data)
    for (const subscriber of this.subscribers) subscriber(frame)
  }
}
