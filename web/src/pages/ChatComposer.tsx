import { useImperativeHandle, useState, type Ref } from 'react'
import type { SessionMail } from '../../../src/sessions/mail.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { SessionView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand, useHold } from '../live/useCommand.js'
import { PlusIcon, SendIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { askAnswers, AskPanel, NO_PICK, pickAnswer, type Pick } from './AskPanel.js'
import { takenFiles } from './chatFiles.js'
import { holdKey, shownAsk } from './composerHold.js'
import { ChatMail } from './ChatMail.js'

/** How long the composer stays shut after a reply went out, unless the session moves on sooner. */
const SENT_HOLD_MS = 90_000

/** What the chat window hands the composer: files dropped anywhere on it. */
export interface ComposerHandle {
  attach: (files: File[]) => void
}

interface Props {
  project: string
  task: string
  session: SessionView
  aside: boolean
  /** The session's mailbox; `listens` — its hooks take a message mid-turn. */
  mail: SessionMail | undefined
  onSent: (line: FeedLine) => void
  handle?: Ref<ComposerHandle>
}

/**
 * The bottom of the chat window: the options of the open question or a free reply, with files. A reply can be typed
 * at any time and is sent while the session waits, or mid-turn into its mailbox when its hooks listen; the draft
 * outlives a new question.
 */
export function ChatComposer({ project, task, session, aside, mail, onSent, handle }: Props) {
  const { send, sending, failure } = useCommand()
  const [answered, setAnswered] = useState<string | null>(null)
  const ask = shownAsk(session.ask, answered)
  const [asked, setAsked] = useState(ask?.id ?? null)
  const [picks, setPicks] = useState<Pick[]>(() => ask?.questions.map(() => NO_PICK) ?? [])
  if ((ask?.id ?? null) !== asked) {
    setAsked(ask?.id ?? null)
    setPicks(ask?.questions.map(() => NO_PICK) ?? [])
  }
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  // Files come in the same states as through the "+" button: any time but while a reply is being sent.
  const attach = (more: File[]) => {
    if (!sending) setFiles((now) => [...now, ...more])
  }
  useImperativeHandle(handle, () => ({ attach }))
  const sent = useHold(holdKey(session), SENT_HOLD_MS)
  // A message to a working session waits in its mailbox: the list below tells its fate, so nothing is held or echoed.
  const mailing = session.lamp === 'working' && mail?.listens === true
  const locked = mailing ? (aside ? t.session.chat.aside : null) : lockReason(session, aside)
  const disabled = locked !== null || sending || sent.on
  const left = ask === null ? 0 : ask.questions.filter((question, index) => pickAnswer(question, picks[index] ?? NO_PICK) === '').length
  // A question may be skipped: any answer, words or file is a reply.
  const ready = text.trim() !== '' || files.length > 0 || (ask !== null && left < ask.questions.length)

  const submit = async () => {
    const answers = ask === null ? {} : askAnswers(ask, picks)
    const body = { project, task, sessionId: session.sessionId, ask: ask?.id ?? null, answers, text, files: await Promise.all(files.map(encoded)) }
    if (!(await send('session/answer', body))) return
    if (ask !== null) setAnswered(ask.id)
    if (!mailing) {
      sent.begin()
      onSent(sentLine(ask === null ? null : ask.id, answers, text, files))
    }
    setText('')
    setFiles([])
  }

  return (
    <form
      className="chat"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready && !disabled) void submit()
      }}
    >
      {ask !== null && <AskPanel ask={ask} picks={picks} disabled={disabled} ready={ready} onPick={(index, pick) => setPicks((now) => now.map((each, at) => (at === index ? pick : each)))} />}
      {ask?.unsaved && <p className="chat__hint">{t.session.chat.unsaved}</p>}
      {mail !== undefined && <ChatMail sessionId={session.sessionId} mail={mail.mail} onReply={setText} />}
      <div className="chat__box">
        {files.length > 0 && (
          <ul className="chat__files">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="chat__file">
                {file.name}
                <button
                  type="button"
                  className="chat__unfile"
                  aria-label={t.session.chat.removeFile(file.name)}
                  disabled={sending}
                  onClick={() => setFiles((now) => now.filter((_, at) => at !== index))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="chat__row">
          <Tipped inline align="start" tip={t.session.chat.attach}>
            <label className={`chat__icon chat__attach${sending ? ' chat__attach--off' : ''}`}>
              <PlusIcon />
              <input
                type="file"
                multiple
                disabled={sending}
                aria-label={t.session.chat.attach}
                onChange={(event) => {
                  attach([...(event.target.files ?? [])])
                  event.target.value = ''
                }}
              />
            </label>
          </Tipped>
          <textarea
            className="chat__text"
            rows={ask === null ? 2 : 1}
            value={text}
            disabled={sending}
            placeholder={t.session.chat.placeholder}
            onChange={(event) => setText(event.target.value)}
            onPaste={(event) => {
              // Text goes into the field as usual; a picture or files copied in Explorer go into the list.
              const pasted = takenFiles(event.clipboardData.items, new Date())
              if (pasted.length > 0) attach(pasted)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.form?.requestSubmit()
            }}
          />
          <button
            type="submit"
            className="chat__icon chat__send"
            disabled={disabled || !ready}
            aria-busy={sending ? true : undefined}
            aria-label={t.session.chat.send}
          >
            <SendIcon />
          </button>
        </div>
      </div>
      {failure !== null ? (
        <p className="notice notice--error">{say(failure)}</p>
      ) : (
        <p className="chat__hint">
          {sent.on ? t.session.chat.sent : (locked ?? (left > 0 ? t.session.chat.unanswered(left) : mailing ? t.session.chat.mailbox : ''))}
        </p>
      )}
    </form>
  )
}

function lockReason(session: SessionView, aside: boolean): string | null {
  if (session.lamp === 'working') return t.session.chat.working
  if (session.lamp === 'finished') return t.session.chat.finished
  if (session.lamp === 'limit') return t.session.chat.limit
  if (session.lamp === 'error') return t.session.chat.error
  if (session.waitingFor !== null && !session.asking) return t.session.chat.dialog(session.waitingFor)
  return aside ? t.session.chat.aside : null
}

async function encoded(file: File): Promise<{ name: string; data: string }> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error(`cannot read ${file.name}`))
    reader.readAsDataURL(file)
  })
  return { name: file.name, data: url.slice(url.indexOf(',') + 1) }
}

/** The reply as the transcript will show it, put into the feed before the session reads it. */
function sentLine(ask: string | null, answers: Record<string, string>, text: string, files: File[]): FeedLine {
  const given = Object.fromEntries(Object.entries(answers).filter(([, answer]) => answer.trim() !== ''))
  return {
    at: new Date().toISOString(),
    kind: ask === null ? 'prompt' : 'answer',
    text: text.trim(),
    ...(ask === null ? {} : { answers: { ask, answers: given } }),
    ...(files.length === 0 ? {} : { files: files.map((file) => file.name) }),
  }
}
