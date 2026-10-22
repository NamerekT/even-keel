/** Longest a resume may run: a stop and the wait for the session to show up again, 30 s each. */
const RUNNING_MS = 3 * 60_000
/** How long a resumed session may take to get its process after the resume returned. */
const ARMED_MS = 60_000
/** How long a resumed session counts as mid-turn while the daemon has not shown its turn yet: it lagged 8–20 s (BTN-307). */
const TURN_MS = 45_000

interface Turn {
  until: number
  armed: boolean
  /** The question the session showed when the resume began: a different one means the new turn has ended on it. */
  ask: string | null
}

/**
 * Sessions the chain is resuming (a reply, a limit resume). The service stops the session first and the daemon
 * respawns it, so for several seconds `claude agents` calls it stopped and then working with no process: a held
 * session is shown working rather than finished until it is live again after the resume.
 *
 * Its status lags longer still: a resumed session counts as mid-turn (`turning`) until the daemon shows it working,
 * so a message sent in that window goes the way of a working session's instead of stopping it again (invariant 1).
 */
export class ResumeHolds {
  private readonly holds = new Map<string, { until: number; armed: boolean }>()
  private readonly turns = new Map<string, Turn>()

  constructor(private readonly now: () => number = Date.now) {}

  async during(sessionId: string, resume: () => Promise<string>, ask: string | null = null): Promise<string> {
    this.holds.set(sessionId, { until: this.now() + RUNNING_MS, armed: false })
    this.turns.set(sessionId, { until: this.now() + RUNNING_MS, armed: false, ask })
    try {
      const resumed = await resume()
      if (resumed === sessionId) this.holds.set(sessionId, { until: this.now() + ARMED_MS, armed: true })
      else this.holds.delete(sessionId)
      this.turns.delete(sessionId)
      this.turns.set(resumed, { until: this.now() + TURN_MS, armed: true, ask })
      return resumed
    } catch (error) {
      this.holds.delete(sessionId)
      this.turns.delete(sessionId)
      throw error
    }
  }

  held(sessionId: string): boolean {
    const hold = this.holds.get(sessionId)
    return hold !== undefined && this.now() <= hold.until
  }

  /** Whether the session counts as mid-turn after its resume whatever its status says; `ask` — the question it shows now. */
  turning(sessionId: string, ask: string | null): boolean {
    const turn = this.turns.get(sessionId)
    if (turn === undefined || this.now() > turn.until) return false
    return ask === null || ask === turn.ask
  }

  /** Drops the holds of sessions live again after their resume, the turns the daemon shows working, and the expired ones. */
  sweep(live: (sessionId: string) => boolean, working: (sessionId: string) => boolean = () => false): void {
    for (const [sessionId, hold] of this.holds) {
      if (this.now() > hold.until || (hold.armed && live(sessionId))) this.holds.delete(sessionId)
    }
    for (const [sessionId, turn] of this.turns) {
      if (this.now() > turn.until || (turn.armed && working(sessionId))) this.turns.delete(sessionId)
    }
  }
}
