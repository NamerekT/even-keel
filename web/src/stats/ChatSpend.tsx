import type { StatsChatRow } from '../../../src/stats/model.js'
import { t } from '../i18n/index.js'
import { Tipped } from '../ui/Tipped.js'
import { formatShare, formatUsd } from './format.js'

/** The project chats of the period next to the tasks (BTN-1233): one entry per project, the project named when several. */
export function ChatSpend({ chats, several }: { chats: StatsChatRow[]; several: boolean }) {
  if (chats.length === 0) return null
  return (
    <div className="chat-spend">
      <Tipped className="chat-spend__label" tip={t.stats.chats.tip} align="start" inline focusable>
        {t.stats.chats.title}
      </Tipped>
      {chats.map((row) => (
        <span key={row.project} className="chat-spend__item">
          {several && <span className="chat-spend__project">{row.project}</span>}
          <Tipped tip={tipOf(row)} align="start" inline focusable>
            {t.stats.chats.count(row.chats)}
          </Tipped>
          <span className="chat-spend__cost">{formatUsd(row.cost)}</span>
        </span>
      ))}
    </div>
  )
}

function tipOf(row: StatsChatRow): string {
  const sessions = t.stats.chats.sessions(row.sessions)
  return row.limit === null ? sessions : `${sessions}, ${t.stats.chats.limit(formatShare(row.limit))}`
}
