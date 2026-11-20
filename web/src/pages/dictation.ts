/**
 * Dictation into a chat field through the browser's own speech recognition (Web Speech API, BTN-1343). The DOM
 * library of TypeScript has no `SpeechRecognition` yet, so the few members the field uses are typed here.
 */

export interface SpeechAlternative {
  transcript: string
}

export interface SpeechResultLike {
  readonly length: number
  readonly [index: number]: SpeechAlternative
}

export interface SpeechResultsLike {
  readonly length: number
  readonly [index: number]: SpeechResultLike
}

export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { results: SpeechResultsLike }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

interface SpeechScope {
  isSecureContext?: boolean
  SpeechRecognition?: unknown
  webkitSpeechRecognition?: unknown
}

/**
 * The browser's recognizer, or `null` where the field shows no microphone: a browser without the API (Firefox) or a
 * page over plain HTTP, where the browser gives no microphone anyway.
 */
export function speechRecognitionOf(scope: SpeechScope): SpeechRecognitionConstructor | null {
  if (scope.isSecureContext !== true) return null
  const found = scope.SpeechRecognition ?? scope.webkitSpeechRecognition
  return typeof found === 'function' ? (found as SpeechRecognitionConstructor) : null
}

/** What was said so far: the best guess of every result, final and interim alike, in order. */
export function saidText(results: SpeechResultsLike): string {
  const parts: string[] = []
  for (let index = 0; index < results.length; index++) {
    const said = results[index]?.[0]?.transcript.trim()
    if (said) parts.push(said)
  }
  return parts.join(' ')
}

/** The field while dictating: the text it had before the press, then what was said, a space between them. */
export function dictatedText(before: string, said: string): string {
  if (said === '') return before
  if (before === '' || /\s$/.test(before)) return before + said
  return `${before} ${said}`
}

export type DictationProblem = 'blocked' | 'noMicrophone' | 'network' | 'silence' | 'failed'

/** Why dictation stopped, by the recognizer's error code; `null` for a stop the page asked for itself. */
export function dictationProblem(error: string): DictationProblem | null {
  switch (error) {
    case 'aborted':
      return null
    case 'not-allowed':
    case 'service-not-allowed':
      return 'blocked'
    case 'audio-capture':
      return 'noMicrophone'
    case 'network':
      return 'network'
    case 'no-speech':
      return 'silence'
    default:
      return 'failed'
  }
}
