/** Longest a resume may run: a stop and the wait for the session to show up again, 30 s each. */
const RUNNING_MS = 3 * 60_000
/** How long a resumed session may take to get its process after the resume returned. */
const ARMED_MS = 60_000

/**
 * Sessions the chain is resuming (a reply, a limit resume). The service stops the session first and the daemon
 * respawns it, so for several seconds `claude agents` calls it stopped and then working with no process: a held
 * session is shown working rather than finished until it is live again after the resume.
 */
export class ResumeHolds {
  private readonly holds = new Map<string, { until: number; armed: boolean }>()

  constructor(private readonly now: () => number = Date.now) {}

  async during(sessionId: string, resume: () => Promise<string>): Promise<string> {
    this.holds.set(sessionId, { until: this.now() + RUNNING_MS, armed: false })
    try {
      const resumed = await resume()
      if (resumed === sessionId) this.holds.set(sessionId, { until: this.now() + ARMED_MS, armed: true })
      else this.holds.delete(sessionId)
      return resumed
    } catch (error) {
      this.holds.delete(sessionId)
      throw error
    }
  }

  held(sessionId: string): boolean {
    const hold = this.holds.get(sessionId)
    return hold !== undefined && this.now() <= hold.until
  }

  /** Drops the holds of sessions live again after their resume, and the expired ones. */
  sweep(live: (sessionId: string) => boolean): void {
    for (const [sessionId, hold] of this.holds) {
      if (this.now() > hold.until || (hold.armed && live(sessionId))) this.holds.delete(sessionId)
    }
  }
}
