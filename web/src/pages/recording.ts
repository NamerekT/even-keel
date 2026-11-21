/**
 * The chat microphone's recording for the service's transcription (BTN-1391): the sound goes to LiteLLM through the
 * service and the language is heard there. Only the pure parts are here; `DictateButton` drives the recorder.
 */

/** A recording stops by itself at two minutes: one request of the model's daily quota, a body of a few hundred KB. */
export const MAX_RECORDING_MS = 2 * 60_000

interface RecorderScope {
  isSecureContext?: boolean
  MediaRecorder?: unknown
  navigator?: { mediaDevices?: { getUserMedia?: unknown } }
}

/** The browser's recorder, or `null` where there is none or the page is not on HTTPS, which gives no microphone. */
export function recorderOf(scope: RecorderScope): typeof MediaRecorder | null {
  if (scope.isSecureContext !== true || typeof scope.navigator?.mediaDevices?.getUserMedia !== 'function') return null
  return typeof scope.MediaRecorder === 'function' ? (scope.MediaRecorder as typeof MediaRecorder) : null
}

/** Chrome and Firefox record opus in WebM, Safari AAC in MP4; both reach Gemini as they are. */
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

/** The first type the browser records in; `''` — its own default. */
export function recordingType(supported: (type: string) => boolean): string {
  return TYPES.find(supported) ?? ''
}

/** `m:ss` of a recording's length. */
export function clockOf(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const QUOTA_PAUSE_MS = 60 * 60_000
const FAILURE_PAUSE_MS = 5 * 60_000

/**
 * Until when the microphone uses the browser's recognition after the service refused a recording, by the refusal's
 * code; `null` — the model stays: the recording itself was empty or too long.
 */
export function fallbackUntil(code: string, now: number): number | null {
  if (code === 'dictation.empty' || code === 'dictation.tooLong') return null
  return now + (code === 'dictation.quota' ? QUOTA_PAUSE_MS : FAILURE_PAUSE_MS)
}

/** The recording's bytes in base64, as `dictation/transcribe` takes them. */
export async function base64Of(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('cannot read the recording'))
    reader.readAsDataURL(blob)
  })
  return url.slice(url.indexOf(',') + 1)
}
