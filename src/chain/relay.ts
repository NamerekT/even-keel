import type { TaskPlace } from '../git/types.js'
import type { Language } from '../language.js'
import { resetTimeOf } from '../limits/reset.js'
import { fail } from '../notice/notice.js'
import { fill } from '../sessions/prompt.js'
import type { CacheTtl, FeedLine } from '../sessions/transcript.js'
import type { TaskBrief } from '../tracker/source.js'
import { PROMPTS, type HandoffReason } from './prompts.js'

export type { HandoffReason } from './prompts.js'

export const WARM_CACHE_MS = 55 * 60_000
const WARM_SHORT_CACHE_MS = 4 * 60_000
const HANDOFF_STEPS = 10

/** How long after its last reply an API session's cache stays warm: an hour's cache as a subscription's, else five minutes. */
export function warmCacheMs(ttl: CacheTtl | null): number {
  return ttl === '1h' ? WARM_CACHE_MS : WARM_SHORT_CACHE_MS
}

export function resumePrompt(language: Language): string {
  return PROMPTS[language].resume
}

/** `pullRequests` — PR mode: the session does not merge, it marks its turn's end for Even Keel to open a pull request. */
export function startPrompt(task: string, place: TaskPlace, language: Language, main = 'main', pullRequests = false): string {
  const text = PROMPTS[language]
  const lines = [fill`${task}`, '', text.worktree(place.path)]
  if (place.branch !== null) lines.push(text.branch(place.branch))
  lines.push(pullRequests ? text.pullRequest(main) : text.cleanup(main))
  return lines.join('\n') + '\n'
}

/** The prompt of the session that fixes a red main without a task: the report of what broke, then its place and rules. */
export function fixPrompt(report: string, place: TaskPlace, language: Language, main = 'main'): string {
  const text = PROMPTS[language]
  const lines = [fill`${report.trim()}`, '', text.worktree(place.path)]
  if (place.branch !== null) lines.push(text.branch(place.branch))
  lines.push(text.fixRules(main))
  return lines.join('\n') + '\n'
}

/** A handoff of the fix session carries the report again: there is no task to read it from, so without it nothing starts. */
export function withReport(task: string, prompt: string, report: string | undefined): string {
  if (report === undefined || report.trim() === '') throw fail('chain.fixReportMissing', { task })
  return `${prompt}\n${report.trim()}\n`
}

export function mainFixedPrompt(red: string, fixed: string | null, language: Language, main = 'main'): string {
  return PROMPTS[language].mainFixed(red.slice(0, 7), fixed === null ? null : fixed.slice(0, 7), main)
}

export function withBrief(prompt: string, brief: TaskBrief | undefined, language: Language): string {
  if (brief === undefined) return prompt
  const lines = ['', PROMPTS[language].brief(brief.title.trim())]
  const description = brief.description.trim()
  if (description !== '') lines.push('', description)
  return prompt + lines.join('\n') + '\n'
}

export interface TrackerPlace {
  title: string
  project: string
}

/** The project in the tracker (a GitHub repository, a Linear project) as the config names it: the session's working folder may have no remote that tells it. */
export function withTracker(prompt: string, tracker: TrackerPlace | null, language: Language): string {
  return tracker === null ? prompt : `${prompt}\n${PROMPTS[language].tracker(tracker.title, tracker.project)}\n`
}

export function withProjectPrompt(prompt: string, text: string | null, language: Language): string {
  return text === null ? prompt : `${prompt}\n${PROMPTS[language].project(text)}\n`
}

export function withUnattended(prompt: string, on: boolean, language: Language): string {
  return on ? `${prompt}\n${PROMPTS[language].unattended}\n` : prompt
}

export type RelayAction = 'resume' | 'relay'
export type RelayStep = 'wait' | RelayAction

export interface HandoffSession {
  sessionId: string
  agentId: string
  account: string
  cwd: string
  workdir: string
  branch: string | null
  transcript: string | null
  lastReplyAt: string | null
  recent: FeedLine[]
  lastMessage: string | null
  checkpoint: string | null
  /** The pull request description the last response's `PULL REQUEST: <path>` line names (BTN-205); absent or `null` — none. */
  pullRequest?: string | null
}

export interface LimitedSession extends HandoffSession {
  limit: { at: string; text: string }
  /** How long the cache stays warm after the last reply (`warmCacheMs`); absent — `WARM_CACHE_MS`, a subscription's. */
  warmMs?: number
}

export interface LimitHold {
  at: string
  account: string | null
  resetsAt: string | null
  lastReplyAt: string | null
  then: RelayAction
  acted: RelayAction | null
}

export interface AccountNow {
  id: string | null
  ready: boolean
}

export function holdOf(session: LimitedSession, account: string | null, fallbackReset: string | null): LimitHold {
  const resetsAt = resetTimeOf(session.limit.text, session.limit.at) ?? fallbackReset
  const hold: LimitHold = { at: session.limit.at, account, resetsAt: null, lastReplyAt: session.lastReplyAt, then: 'relay', acted: null }
  return withReset(hold, resetsAt, session.warmMs)
}

export function withReset(hold: LimitHold, resetsAt: string | null, warmMs = WARM_CACHE_MS): LimitHold {
  const { account, lastReplyAt } = hold
  const warmAtReset =
    account !== null && resetsAt !== null && lastReplyAt !== null && Date.parse(resetsAt) - Date.parse(lastReplyAt) < warmMs
  return { ...hold, resetsAt, then: warmAtReset ? 'resume' : 'relay' }
}

export function relayStep(hold: LimitHold, now: Date, account: AccountNow, warmMs = WARM_CACHE_MS): RelayStep {
  if (hold.acted !== null || !account.ready) return 'wait'
  const switched = hold.account !== null && account.id !== null && account.id !== hold.account
  const reset = hold.resetsAt !== null && now.getTime() >= Date.parse(hold.resetsAt)
  if (!switched && !reset) return 'wait'
  const warm =
    !switched &&
    hold.account !== null &&
    account.id === hold.account &&
    hold.lastReplyAt !== null &&
    now.getTime() - Date.parse(hold.lastReplyAt) < warmMs
  return warm ? 'resume' : 'relay'
}


export function handoffPrompt(
  task: string,
  session: HandoffSession,
  reason: HandoffReason,
  language: Language,
  main = 'main',
  pullRequests = false,
): string {
  const text = PROMPTS[language]
  const lines = [fill`${task}`, '', text.why[reason], text.workdir(session.workdir)]
  if (session.branch !== null) lines.push(text.branch(session.branch))
  lines.push(pullRequests ? text.pullRequest(main) : text.cleanup(main))
  if (session.transcript !== null) lines.push(text.transcript(session.transcript))
  const note = noteOf(session)
  if (note !== null) lines.push(text.note(note))
  lines.push(text.begin(main))
  if (note !== null) return lines.join('\n') + '\n'
  const steps = session.recent.filter((line) => line.kind === 'text' || line.kind === 'tool').slice(-HANDOFF_STEPS)
  if (steps.length > 0) lines.push('', text.recentSteps, ...steps.map((line) => fill`- ${line.text}`))
  if (session.lastMessage !== null) lines.push('', text.lastMessage, '', fill`${session.lastMessage}`)
  return lines.join('\n') + '\n'
}

/** The handoff note the prompt points the new session at, as an absolute path; null — the prompt carries the recent steps instead. */
export function noteOf(session: HandoffSession): string | null {
  return session.checkpoint === null ? null : notePath(session.workdir, session.checkpoint)
}

function notePath(workdir: string, note: string): string {
  if (/^([a-zA-Z]:)?[\\/]/.test(note)) return note
  return fill`${workdir.replace(/[\\/]+$/, '')}/${note.replace(/^\.[\\/]/, '')}`
}
