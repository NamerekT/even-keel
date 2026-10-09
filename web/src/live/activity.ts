/** Requests of the page that are in flight: the bar under the header moves while there is at least one. */
export class Activity {
  private count = 0
  private readonly listeners = new Set<() => void>()

  track<T>(work: Promise<T>): Promise<T> {
    this.shift(1)
    const done = () => this.shift(-1)
    work.then(done, done)
    return work
  }

  running(): number {
    return this.count
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private shift(by: number): void {
    this.count += by
    for (const listener of this.listeners) listener()
  }
}

export const activity = new Activity()
