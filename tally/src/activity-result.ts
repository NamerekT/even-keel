import { flatten, type ContentBlock } from '../../src/sessions/entry.js'
import { cleanText } from './compact.js'
import { errorKindOf, resultText, type ErrorKind } from './parse.js'

export const EXCERPT_LIMIT = 300

/** A cut may split a surrogate pair, and Postgres refuses a lone surrogate in jsonb. */
export function excerpt(text: string): string {
  return cleanText(flatten(text, EXCERPT_LIMIT))
}
export const TIMEOUT = /timed out|no exit after/i
const BACKGROUND = /in background with ID: ([\w-]+)|moved to the background \(ID: ([\w-]+)\)/
const OUTPUT_FILE = /Output is being written to: (.+?\.output)\b/

export interface CallResult {
  isError: boolean
  kind: ErrorKind | null
  text: string
  taskId: string | null
  outputFile?: string
  outcome: 'ok' | 'fail' | 'killed' | 'timeout'
}

export function callResult(block: ContentBlock): CallResult {
  const text = resultText(block)
  const isError = block.is_error === true
  const background = BACKGROUND.exec(text)
  return {
    isError,
    kind: isError ? errorKindOf(text) : null,
    text: isError ? excerpt(text) : '',
    taskId: background?.[1] ?? background?.[2] ?? null,
    outputFile: OUTPUT_FILE.exec(text)?.[1],
    outcome: /^\[Request interrupted/.test(text) ? 'killed' : TIMEOUT.test(text) ? 'timeout' : isError ? 'fail' : 'ok',
  }
}
