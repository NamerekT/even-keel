import { notice, type Notice } from '../notice/notice.js'
import type { TranscriptSummary } from '../sessions/transcript.js'
import { lastEvent } from '../codex/turns.js'

export interface TurnError {
  at: string
  text: string
}

/** The first line of the plain text the CLI exits with when nothing signs it in; a list of the ways in follows it. */
const SIGN_IN_REFUSAL = 'Copilot can be authenticated with GitHub using '

/** The first Error line the CLI exits with when it cannot fetch the model list from the Copilot API. */
const MODELS_REFUSAL = 'Error: Failed to load models'

/**
 * stdout also contains JSON events and warnings; a CLI refusal is the Error lines of the plain-text block after the
 * last event, which may go on with advice (EKR-113), and the sign-in refusal, which has no Error line of its own, is
 * told by its first line.
 */
export function outputError(output: string): string | undefined {
  if (lastEvent(output)?.exitCode === 0) return undefined
  const lines = output.trimEnd().split('\n').map((line) => line.trim())
  const signIn = lines.find((line) => line.startsWith(SIGN_IN_REFUSAL))
  if (signIn !== undefined) return signIn
  const errors = lines.slice(lines.findLastIndex((line) => line.startsWith('{')) + 1).filter((line) => line.startsWith('Error: '))
  return errors.length === 0 ? undefined : errors.join('\n')
}

/** The notice of a refusal the page can fix: a model the account cannot use, no sign-in, or no way to the Copilot API. */
export function refusalNotice(text: string): Notice | undefined {
  if (text.startsWith(SIGN_IN_REFUSAL)) return notice('copilot.notSignedIn', {})
  if (text.startsWith(MODELS_REFUSAL)) return notice('copilot.apiUnreachable', {})
  const model = /^Error: Model "([^"\r\n]+)" from --model flag is not available\.$/m.exec(text)?.[1]
  return model === undefined ? undefined : notice('copilot.modelUnavailable', { model })
}

/**
 * Why a turn did not start: a refusal the page can fix, a binary `spawn` cannot find (on Windows an npm wrapper on
 * the PATH it does not run), or `failure` with the turn's output or the spawn error.
 */
export function startFailure(failure: Notice, output: string, bin: string, spawnError?: NodeJS.ErrnoException): Notice {
  const refusal = refusalNotice(outputError(output) ?? '')
  if (refusal !== undefined) return refusal
  if (spawnError?.code === 'ENOENT') return notice('copilot.binaryMissing', { bin }, { cause: failure, detail: spawnError.message })
  return { ...failure, detail: output.trim().slice(-500) || spawnError?.message }
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
