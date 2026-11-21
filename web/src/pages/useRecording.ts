import { useEffect, useRef, useState } from 'react'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import { useLive } from '../live/context.js'
import { base64Of, fallbackUntil, MAX_RECORDING_MS, recorderOf, recordingType } from './recording.js'

export type RecordingPhase = 'idle' | 'recording' | 'transcribing'

const RECORDER = typeof window === 'undefined' ? null : recorderOf(window)
const TICK_MS = 250

/** Until when the browser's recognition stands in for the model after a refusal; shared by every chat field. */
let browserUntil = 0

/** Whether a press records for the service now: it transcribes, the browser records, and no refusal holds it back. */
export const recordsNow = (dictation: boolean): boolean => dictation && RECORDER !== null && Date.now() >= browserUntil

export const canRecord = RECORDER !== null

/** Why the browser's microphone gave nothing, by the error of `getUserMedia`. */
const microphoneProblem = (error: unknown): 'blocked' | 'noMicrophone' | 'failed' => {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'blocked'
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') return 'noMicrophone'
  return 'failed'
}

interface Recording {
  phase: RecordingPhase
  elapsed: number
  /** The service's refusal of the last recording, or the microphone's own problem. */
  refusal: Notice | 'blocked' | 'noMicrophone' | 'failed' | null
  start(): void
  stop(): void
}

/**
 * The chat microphone's recording for the service (BTN-1391): a press records, the second one (or two minutes, or
 * sending) stops and sends the sound to `dictation/transcribe`; the text comes once, after the stop.
 */
export function useRecording(write: (said: string) => void, sending: boolean): Recording {
  const { query } = useLive()
  const [phase, setPhase] = useState<RecordingPhase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [refusal, setRefusal] = useState<Recording['refusal']>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const keep = useRef(true)
  const said = useRef(write)
  said.current = write

  const stop = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }

  useEffect(() => {
    if (sending) stop()
  }, [sending])

  // A field that goes away drops its recording: there is no field left for the text. Set again on mount: React's
  // strict mode runs the cleanup once before the field is really gone.
  useEffect(() => {
    keep.current = true
    return () => {
      keep.current = false
      stop()
    }
  }, [])

  const transcribe = async (blob: Blob) => {
    setPhase('transcribing')
    try {
      const answer = await query<{ text: string }>('dictation/transcribe', { audio: await base64Of(blob), type: blob.type })
      if (answer.text !== '') said.current(answer.text)
    } catch (reason) {
      const notice = noticeOf(reason)
      browserUntil = fallbackUntil(notice.code, Date.now()) ?? browserUntil
      if (keep.current) setRefusal(notice)
    } finally {
      if (keep.current) setPhase('idle')
    }
  }

  const start = async () => {
    if (RECORDER === null) return
    setRefusal(null)
    setPhase('recording')
    setElapsed(0)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      setPhase('idle')
      setRefusal(microphoneProblem(error))
      return
    }
    const type = recordingType((each) => RECORDER.isTypeSupported(each))
    const next = new RECORDER(stream, type === '' ? undefined : { mimeType: type })
    const chunks: Blob[] = []
    const began = Date.now()
    const tick = setInterval(() => {
      const ms = Date.now() - began
      setElapsed(ms)
      if (ms >= MAX_RECORDING_MS) stop()
    }, TICK_MS)
    next.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    next.onstop = () => {
      clearInterval(tick)
      for (const track of stream.getTracks()) track.stop()
      if (recorder.current === next) recorder.current = null
      if (!keep.current) return
      const blob = new Blob(chunks, { type: next.mimeType || type || chunks[0]?.type || '' })
      if (blob.size === 0) {
        setPhase('idle')
        return
      }
      void transcribe(blob)
    }
    if (!keep.current) {
      clearInterval(tick)
      for (const track of stream.getTracks()) track.stop()
      return
    }
    recorder.current = next
    try {
      next.start()
    } catch {
      clearInterval(tick)
      for (const track of stream.getTracks()) track.stop()
      recorder.current = null
      setPhase('idle')
      setRefusal('failed')
    }
  }

  return { phase, elapsed, refusal, start: () => void start(), stop }
}
