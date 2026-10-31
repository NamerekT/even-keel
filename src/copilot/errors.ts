import { notice, type Notice } from '../notice/notice.js'
import type { TranscriptSummary } from '../sessions/transcript.js'
import { lastEvent } from '../codex/turns.js'

export interface TurnError {
  at: string
  text: string
}

/** The first line of the plain text the CLI exits with when nothing signs it in; a list of the ways in follows it. */
const SIGN_IN_REFUSAL = 'Copilot can be authenticated with GitHub using '

/**
 * stdout also contains JSON events and warnings; only a terminal plain-text Error is a CLI refusal, and the sign-in
 * refusal, which ends with a list instead, is told by its first line.
 */
export function outputError(output: string): string | undefined {
  if (lastEvent(output)?.exitCode === 0) return undefined
  const lines = output.trimEnd().split('\n').map((line) => line.trim())
  const signIn = lines.find((line) => line.startsWith(SIGN_IN_REFUSAL))
  if (signIn !== undefined) return signIn
  const last = lines.at(-1)
  return last?.startsWith('Error: ') ? last : undefined
}

/** The notice of a refusal the page can fix: a model the account cannot use, or no sign-in on the machine. */
export function refusalNotice(text: string): Notice | undefined {
  if (text.startsWith(SIGN_IN_REFUSAL)) return notice('copilot.notSignedIn', {})
  const model = /^Error: Model "([^"\r\n]+)" from --model flag is not available\.$/.exec(text)?.[1]
  return model === undefined ? undefined : notice('copilot.modelUnavailable', { model })
}

/** The last turn's refusal supplements a missing or metadata-only transcript, without changing the CLI's files. */
export function withTurnError(summary: TranscriptSummary, error: TurnError | undefined, feedSize = 30): TranscriptSummary {
  if (error === undefined || (summary.lastActivityAt !== null && Date.parse(summary.lastActivityAt) > Date.parse(error.at))) return summary
  const diagnostic = refusalNotice(error.text)
  return {
    ...summary,
    firstActivityAt: summary.firstActivityAt ?? error.at,
    lastActivityAt: error.at,
    apiError: { kind: 'error', ...error, ...(diagnostic === undefined ? {} : { notice: diagnostic }) },
    feed: [...summary.feed, { at: error.at, kind: 'error' as const, text: error.text, ...(diagnostic === undefined ? {} : { notice: diagnostic }) }].slice(-feedSize),
  }
}
