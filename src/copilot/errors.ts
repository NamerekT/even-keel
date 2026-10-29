import { notice, type Notice } from '../notice/notice.js'
import type { TranscriptSummary } from '../sessions/transcript.js'
import { lastEvent } from '../codex/turns.js'

export interface TurnError {
  at: string
  text: string
}

/** stdout also contains JSON events and warnings; only a terminal plain-text Error is a CLI refusal. */
export function outputError(output: string): string | undefined {
  if (lastEvent(output)?.exitCode === 0) return undefined
  const last = output.trimEnd().split('\n').at(-1)?.trim()
  return last?.startsWith('Error: ') ? last : undefined
}

export function modelRefusal(text: string): Notice | undefined {
  const model = /^Error: Model "([^"\r\n]+)" from --model flag is not available\.$/.exec(text)?.[1]
  return model === undefined ? undefined : notice('copilot.modelUnavailable', { model })
}

/** The last turn's refusal supplements a missing or metadata-only transcript, without changing the CLI's files. */
export function withTurnError(summary: TranscriptSummary, error: TurnError | undefined, feedSize = 30): TranscriptSummary {
  if (error === undefined || (summary.lastActivityAt !== null && Date.parse(summary.lastActivityAt) > Date.parse(error.at))) return summary
  const diagnostic = modelRefusal(error.text)
  return {
    ...summary,
    firstActivityAt: summary.firstActivityAt ?? error.at,
    lastActivityAt: error.at,
    apiError: { kind: 'error', ...error, ...(diagnostic === undefined ? {} : { notice: diagnostic }) },
    feed: [...summary.feed, { at: error.at, kind: 'error' as const, text: error.text, ...(diagnostic === undefined ? {} : { notice: diagnostic }) }].slice(-feedSize),
  }
}
