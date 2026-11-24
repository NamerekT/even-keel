/**
 * A fixed window per key: at most `limit` calls in each `windowMs`. For routes open to anyone who reaches the page
 * (BTN-1655), so a guess or a flood costs the hub little.
 */
export class RateLimit {
  private readonly windows = new Map<string, { start: number; count: number }>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts a call of this key; `false` — over the limit, refuse it. */
  take(key: string): boolean {
    const now = this.now()
    if (this.windows.size > 1000) {
      for (const [each, window] of this.windows) if (now - window.start >= this.windowMs) this.windows.delete(each)
    }
    const window = this.windows.get(key)
    if (window === undefined || now - window.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 })
      return true
    }
    window.count++
    return window.count <= this.limit
  }
}
