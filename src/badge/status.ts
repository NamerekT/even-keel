/**
 * The agent's own status line for the README badge (BTN-932): the service asks for it in a hook's answer, the agent
 * writes `status: …` next to its next tool call, and the transcript's fold takes it (`docs/badge.md`).
 */

/** A new status is asked for once the last one, or the last request, is this old. */
export const STATUS_ASK_MS = 2 * 60_000
/** A status older than this gives way to the default action: the session stopped answering the requests. */
export const STATUS_FRESH_MS = 5 * 60_000
const LIMIT = 60
const MARK = '<even-keel-status-request>'
const LINE = /^[ \t]*status:[ \t]*(\S.*?)[ \t]*$/gim

export interface BadgeStatus {
  text: string
  /** When the session wrote it, ISO. */
  at: string
}

/** What a hook puts into the session's context; the mark is how the transcript knows the line was asked for. */
export function statusRequest(): string {
  return `${MARK}In your next message, next to your next tool call, add one line \`status: …\` saying what you are doing right now: in English, up to ${LIMIT} characters, no names of people or companies, no paths and no addresses. Do not call a tool for it and do not answer this request in any other way.</even-keel-status-request>`
}

/** Whether a hook's text holds the request. */
export function statusAsked(text: string): boolean {
  return text.includes(MARK)
}

/** The words of the text's last `status: …` line; `null` — it has none. */
export function statusLineIn(text: string): string | null {
  return [...text.matchAll(LINE)].at(-1)?.[1] ?? null
}

/** The text without its `status: …` lines, as the chat shows it. */
export function withoutStatusLine(text: string): string {
  return text
    .split('\n')
    .filter((line) => statusLineIn(line) === null)
    .join('\n')
    .trim()
}

/** The line as the badge may draw it: flat, printable ASCII (the badge's fonts hold nothing else), cut to 60; else `null`. */
export function statusTextOf(line: string): string | null {
  const flat = line.replace(/\s+/g, ' ').trim()
  if (flat === '' || !/^[\x20-\x7e]+$/.test(flat)) return null
  return flat.length > LIMIT ? `${flat.slice(0, LIMIT - 1).trimEnd()}…` : flat
}

/** When each session was last asked, in memory: a restart asks again no sooner than the status in the transcript allows. */
export class StatusAsks {
  private readonly askedAt = new Map<string, number>()

  /** Whether to ask the session now; a `true` counts as asked. */
  due(sessionId: string, status: BadgeStatus | null, now: number): boolean {
    const written = status === null ? Number.NaN : Date.parse(status.at)
    const last = Math.max(this.askedAt.get(sessionId) ?? -Infinity, Number.isNaN(written) ? -Infinity : written)
    if (now - last < STATUS_ASK_MS) return false
    this.askedAt.set(sessionId, now)
    return true
  }

  /** Forgets the sessions that are gone. */
  keep(live: Set<string>): void {
    for (const id of this.askedAt.keys()) if (!live.has(id)) this.askedAt.delete(id)
  }
}
