import type { Mail } from '../../../src/sessions/mail.js'
import { formatMoment } from '../format.js'
import { t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'

/** How long a delivered message keeps its line: the feed shows it as the user's prompt from then on. */
const DELIVERED_SHOWN_MS = 10 * 60_000

interface Props {
  sessionId: string
  mail: Mail[]
  onReply: (text: string) => void
}

/** The fate of the messages sent to the session mid-turn (BTN-181): waiting for the hook, delivered, or back. */
export function ChatMail({ sessionId, mail, onReply }: Props) {
  const { send, sending } = useCommand()
  const now = new Date()
  const shown = mail.filter((each) => each.fate !== 'delivered' || now.getTime() - Date.parse(each.settledAt ?? each.postedAt) < DELIVERED_SHOWN_MS)
  if (shown.length === 0) return null
  return (
    <ul className="chat__mail">
      {shown.map((each) => (
        <li key={each.id} className={`chat__letter chat__letter--${each.fate}`}>
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
