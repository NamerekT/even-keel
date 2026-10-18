import { useEffect, useReducer } from 'react'
import type { Mail } from '../../../src/sessions/mail.js'
import { formatMoment } from '../format.js'
import { t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { letterPhase, nextLetterChange } from './letterPhase.js'

interface Props {
  sessionId: string
  mail: Mail[]
  onReply: (text: string) => void
}

/** The fate of the messages sent to the session mid-turn (BTN-181): waiting for the hook, delivered, or back. */
export function ChatMail({ sessionId, mail, onReply }: Props) {
  const { send, sending } = useCommand()
  // A delivered line fades on its own clock, not only when the state changes.
  const [, tick] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    const wait = nextLetterChange(mail, Date.now())
    if (wait === null) return
    const timer = window.setTimeout(tick, wait)
    return () => window.clearTimeout(timer)
  })
  const now = new Date()
  const shown = mail.map((each) => ({ each, phase: letterPhase(each, now.getTime()) })).filter(({ phase }) => phase !== 'gone')
  if (shown.length === 0) return null
  return (
    <ul className="chat__mail">
      {shown.map(({ each, phase }) => (
        <li key={each.id} className={`chat__letter chat__letter--${each.fate}${phase === 'leaving' ? ' chat__letter--leaving' : ''}`}>
          <span className="chat__letter-text">{each.text}</span>
          {each.fate === 'returned' ? (
            <>
              <span className="chat__letter-fate">{t.session.chat.mail.returned}</span>
              <span className="chat__letter-actions">
                <button type="button" className="button button--small" onClick={() => onReply(each.text)}>
                  {t.session.chat.mail.reply}
                </button>
                <button type="button" className="button button--small" disabled={sending} onClick={() => void send('session/mail/dismiss', { sessionId })}>
                  {t.session.chat.mail.dismiss}
                </button>
              </span>
            </>
          ) : (
            <span className="chat__letter-fate">
              {each.fate === 'waiting'
                ? t.session.chat.mail.waiting
                : t.session.chat.mail.delivered(formatMoment(each.settledAt ?? each.postedAt, now), t.session.chat.mail.events[each.event ?? 'resume'])}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
