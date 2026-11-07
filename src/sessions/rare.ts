import type { SessionView } from '../state.js'
import { idleBeforePrompt } from './boot.js'

interface Identity {
  sessionId: string
  cwd: string
  task?: string
  name?: string
  project?: string
}

/** Observation keys live for this service process; a restart may report a still-current event again. */
export class RareEvents {
  projectOf: (session: Identity) => string | undefined = () => undefined
  private readonly seen = new Set<string>()
  private readonly booting = new Set<string>()
  private readonly copies = new Map<string, { old: string; since: number; identity: Identity }>()

  constructor(private readonly log: (line: string) => void = (line) => console.log(line)) {}

  once(entry: string, event: string, session: Identity, detail: string): boolean {
    const key = JSON.stringify([entry, event, session.sessionId])
    if (this.seen.has(key)) return false
    this.seen.add(key)
    const project = session.project ?? this.projectOf(session) ?? 'unknown'
    const task = session.task ?? session.name ?? 'unknown'
    this.log(`rare: ${entry} project=${JSON.stringify(project)} task=${JSON.stringify(task)} session=${JSON.stringify(session.sessionId)} ${detail}`)
    return true
  }

  copy(old: string, session: Identity, since: number, transcript: boolean, now = Date.now()): void {
    if (session.sessionId === old) return
    const identity = { ...session, project: session.project ?? this.projectOf({ ...session, sessionId: old }) ?? this.projectOf(session) }
    if (!this.once('18', `copy:${old}:${since}`, identity,
      `resume-copy oldSession=${JSON.stringify(old)} transcript=${transcript} elapsedMs=${now - since}; following the new job`)) return
    if (!transcript) this.copies.set(session.sessionId, { old, since, identity })
  }

  observe(view: SessionView, transcript: boolean, now = Date.now()): void {
    const copy = this.copies.get(view.sessionId)
    if (copy !== undefined && transcript) {
      this.once('18', `transcript:${copy.old}:${copy.since}`, copy.identity,
        `transcript-appeared oldSession=${JSON.stringify(copy.old)} elapsedMs=${now - copy.since}; following its transcript`)
      this.copies.delete(view.sessionId)
    }
    if (idleBeforePrompt(view, new Date(now)) && this.once('86', 'boot', view,
      `idle-before-prompt elapsedMs=${now - Date.parse(view.startedAt)}; retaining the boot grace`)) this.booting.add(view.sessionId)
    if (this.booting.has(view.sessionId) && view.feed.some((line) => line.kind === 'text' || line.kind === 'tool')) {
      this.once('86', 'answer', view, `first-answer elapsedMs=${now - Date.parse(view.startedAt)}; following the model response`)
      this.booting.delete(view.sessionId)
    }
  }
}

export const rareEvents = new RareEvents()
