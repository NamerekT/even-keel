import { useEffect, useRef, useState } from 'react'
import { language, say, t } from '../i18n/index.js'
import { useCoarsePointer } from '../layout/useCoarsePointer.js'
import { useLive } from '../live/context.js'
import { MicIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import {
  dictatedText,
  dictationProblem,
  saidText,
  speechRecognitionOf,
  type DictationProblem,
  type SpeechRecognitionLike,
} from './dictation.js'
import { clockOf } from './recording.js'
import { canRecord, recordsNow, useRecording } from './useRecording.js'

interface Props {
  text: string
  onText: (text: string) => void
  sending: boolean
}

const RECOGNIZER = typeof window === 'undefined' ? null : speechRecognitionOf(window)

/**
 * The microphone of a chat field. With LiteLLM set (BTN-1391) a press records, the second one stops and the service
 * transcribes the sound in whatever language it was spoken; the text comes after the stop. Otherwise, and for a while
 * after the model refused, it is the browser's recognition (BTN-1343): what is heard goes into the field as it comes,
 * in the interface's language, and a second press, a pause, typing or sending stops it. No button where the page can
 * do neither, or is not on HTTPS.
 */
export function DictateButton({ text, onText, sending }: Props) {
  const coarse = useCoarsePointer()
  const { state } = useLive()
  const [listening, setListening] = useState(false)
  const [problem, setProblem] = useState<DictationProblem | null>(null)
  const recognizer = useRef<SpeechRecognitionLike | null>(null)
  const written = useRef(text)
  const current = useRef(text)
  current.current = text
  const write = useRef(onText)
  write.current = onText
  const recording = useRecording((said) => write.current(dictatedText(current.current, said)), sending)

  // Typing over the field while it listens hands it back to the keyboard: the next result would overwrite the edit.
  useEffect(() => {
    if (listening && text !== written.current) recognizer.current?.abort()
  }, [listening, text])

  useEffect(() => {
    if (sending) recognizer.current?.abort()
  }, [sending])

  useEffect(() => () => recognizer.current?.abort(), [])

  if (RECOGNIZER === null && !(canRecord && state?.dictation === true)) return null

  const listen = () => {
    if (RECOGNIZER === null) return
    const before = text
    const next = new RECOGNIZER()
    next.lang = language
    // Chrome on Android repeats earlier phrases in a continuous session, so a phone stops at the first pause.
    next.continuous = !coarse
    next.interimResults = true
    next.onresult = (event) => {
      written.current = dictatedText(before, saidText(event.results))
      write.current(written.current)
    }
    next.onerror = (event) => setProblem(dictationProblem(event.error))
    next.onend = () => {
      if (recognizer.current === next) recognizer.current = null
      setListening(false)
    }
    written.current = before
    recognizer.current = next
    setProblem(null)
    setListening(true)
    try {
      next.start()
    } catch {
      recognizer.current = null
      setListening(false)
      setProblem('failed')
    }
  }

  const start = () => {
    setProblem(null)
    if (recordsNow(state?.dictation === true) || RECOGNIZER === null) recording.start()
    else listen()
  }

  const { phase, refusal } = recording
  const recordingNow = phase === 'recording'
  const waiting = phase === 'transcribing'
  const active = listening || recordingNow
  const shown = problem ?? refusal
  const failure = shown === null ? null : typeof shown === 'string' ? t.session.chat.dictate[shown] : say(shown)
  const label = recordingNow ? t.session.chat.dictate.recording(clockOf(recording.elapsed)) : active ? t.session.chat.dictate.stop : waiting ? t.session.chat.dictate.transcribing : t.session.chat.dictate.start
  const tip = active || waiting || failure === null ? label : failure
  const modifiers = [failure !== null && !active && !waiting && 'chat__dictate--problem', recordingNow && 'chat__dictate--recording', waiting && 'chat__dictate--waiting']
  return (
    <Tipped inline tip={tip}>
      <button
        type="button"
        className={['chat__icon', 'chat__dictate', ...modifiers.filter(Boolean)].join(' ')}
        aria-label={label}
        aria-pressed={active}
        aria-busy={waiting}
        disabled={(sending && !recordingNow) || waiting}
        onClick={() => {
          if (recordingNow) recording.stop()
          else if (listening) recognizer.current?.stop()
          else start()
        }}
      >
        {waiting ? <span className="chat__dictate-spinner" aria-hidden="true" /> : <MicIcon />}
        {recordingNow && <span className="chat__dictate-clock">{clockOf(recording.elapsed)}</span>}
      </button>
    </Tipped>
  )
}
