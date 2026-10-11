import { useState } from 'react'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { SessionView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand, useHold } from '../live/useCommand.js'
import { askAnswers, AskPanel, NO_PICK, pickAnswer, type Pick } from './AskPanel.js'

/** How long the composer stays shut after a reply went out, unless the session moves on sooner. */
const SENT_HOLD_MS = 90_000

interface Props {
  project: string
  task: string
  session: SessionView
  onSent: (line: FeedLine) => void
}

/** The bottom of the chat window: the options of the open question or a free reply, with files; open only while the session waits. */
export function ChatComposer({ project, task, session, onSent }: Props) {
  const { send, sending, failure } = useCommand()
  const ask = session.ask
  const [picks, setPicks] = useState<Pick[]>(() => ask?.questions.map(() => NO_PICK) ?? [])
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const sent = useHold(`${session.sessionId}|${session.lamp}|${ask?.id ?? ''}`, SENT_HOLD_MS)
  const locked = lockReason(session)
  const disabled = locked !== null || sending || sent.on
  const left = ask === null ? 0 : ask.questions.filter((question, index) => pickAnswer(question, picks[index] ?? NO_PICK) === '').length
  const ready = ask === null ? text.trim() !== '' || files.length > 0 : left === 0

  const submit = async () => {
    const answers = ask === null ? {} : askAnswers(ask, picks)
    const body = { project, task, sessionId: session.sessionId, ask: ask?.id ?? null, answers, text, files: await Promise.all(files.map(encoded)) }
    if (!(await send('session/answer', body))) return
    sent.begin()
    onSent(sentLine(ask === null ? null : ask.id, answers, text, files))
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
      {ask !== null && <AskPanel ask={ask} picks={picks} disabled={disabled} onPick={(index, pick) => setPicks((now) => now.map((each, at) => (at === index ? pick : each)))} />}
      <div className="chat__row">
        <textarea
          className="chat__text"
          rows={ask === null ? 3 : 1}
          value={text}
          disabled={disabled}
          placeholder={t.session.chat.placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.form?.requestSubmit()
          }}
        />
        <div className="chat__buttons">
          <label className={`button chat__attach${disabled ? ' chat__attach--off' : ''}`}>
            {t.session.chat.attach}
            <input
              type="file"
              multiple
              disabled={disabled}
              onChange={(event) => {
                const chosen = [...(event.target.files ?? [])]
                setFiles((now) => [...now, ...chosen])
                event.target.value = ''
              }}
            />
          </label>
          <button type="submit" className="button button--primary" disabled={disabled || !ready} aria-busy={sending ? true : undefined}>
            {t.session.chat.send}
          </button>
        </div>
      </div>
      {files.length > 0 && (
        <ul className="chat__files">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="chat__file">
              {file.name}
              <button
                type="button"
                className="chat__unfile"
                aria-label={t.session.chat.removeFile(file.name)}
                disabled={disabled}
                onClick={() => setFiles((now) => now.filter((_, at) => at !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {failure !== null ? (
        <p className="notice notice--error">{say(failure)}</p>
      ) : (
        <p className="chat__hint">{sent.on ? t.session.chat.sent : (locked ?? (left > 0 ? t.session.chat.unanswered(left) : ''))}</p>
      )}
    </form>
  )
}

function lockReason(session: SessionView): string | null {
  if (session.lamp === 'working') return t.session.chat.working
  if (session.lamp === 'finished') return t.session.chat.finished
  if (session.lamp === 'limit') return t.session.chat.limit
  if (session.lamp === 'error') return t.session.chat.error
  if (session.waitingFor !== null && !session.asking) return t.session.chat.dialog(session.waitingFor)
  return null
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
  const lines = [...Object.entries(answers).map(([question, answer]) => `${question} → ${answer}`), text.trim(), ...files.map((file) => `📎 ${file.name}`)]
  return {
    at: new Date().toISOString(),
    kind: 'answer',
    text: lines.filter((line) => line !== '').join('\n'),
    ...(ask === null ? {} : { answers: { ask, answers } }),
  }
}
