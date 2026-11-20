import { useEffect, useRef, useState } from 'react'
import { language, t } from '../i18n/index.js'
import { useCoarsePointer } from '../layout/useCoarsePointer.js'
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

interface Props {
  text: string
  onText: (text: string) => void
  sending: boolean
}

const RECOGNIZER = typeof window === 'undefined' ? null : speechRecognitionOf(window)

/**
 * The microphone of a chat field (BTN-1343): a press starts the browser's recognition, what is heard goes into the
 * field as it comes, a second press, a pause, typing or sending stops it. No button where the browser has no
 * recognition or the page is not on HTTPS.
 */
export function DictateButton({ text, onText, sending }: Props) {
  const coarse = useCoarsePointer()
  const [listening, setListening] = useState(false)
  const [problem, setProblem] = useState<DictationProblem | null>(null)
  const recognizer = useRef<SpeechRecognitionLike | null>(null)
  const written = useRef(text)
  const write = useRef(onText)
  write.current = onText

  // Typing over the field while it listens hands it back to the keyboard: the next result would overwrite the edit.
  useEffect(() => {
    if (listening && text !== written.current) recognizer.current?.abort()
  }, [listening, text])

  useEffect(() => {
    if (sending) recognizer.current?.abort()
  }, [sending])

  useEffect(() => () => recognizer.current?.abort(), [])

  if (RECOGNIZER === null) return null

  const start = () => {
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

  const tip = listening ? t.session.chat.dictate.stop : problem === null ? t.session.chat.dictate.start : t.session.chat.dictate[problem]
  return (
    <Tipped inline tip={tip}>
      <button
        type="button"
        className={`chat__icon chat__dictate${problem === null ? '' : ' chat__dictate--problem'}`}
        aria-label={listening ? t.session.chat.dictate.stop : t.session.chat.dictate.start}
        aria-pressed={listening}
        disabled={sending}
        onClick={() => {
          if (listening) recognizer.current?.stop()
          else start()
        }}
      >
        <MicIcon />
      </button>
    </Tipped>
  )
}
