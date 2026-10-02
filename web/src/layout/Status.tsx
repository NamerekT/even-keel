import { Link } from 'react-router'
import type { HulyHealth, HulyLinkState } from '../../../src/huly/health.js'
import type { HulyTask } from '../../../src/huly/model.js'
import type { SessionView } from '../../../src/state.js'
import { formatAgo } from '../format.js'
import type { Link as LinkState } from '../live/connection.js'
import { taskProject, waitingSessions } from '../state.js'

const SERVER_LABELS: Record<LinkState, string> = {
  connecting: 'Подключение',
  live: 'На связи',
  stale: 'Нет связи',
}

const HULY_LABELS: Record<HulyLinkState, string> = {
  off: 'выключен',
  connecting: 'подключение',
  live: 'на связи',
  down: 'устарело',
}

const HULY_DOTS: Record<HulyLinkState, LinkState | 'off'> = {
  off: 'off',
  connecting: 'connecting',
  live: 'live',
  down: 'stale',
}

export function Waiting({ sessions, tasks }: { sessions: SessionView[]; tasks: HulyTask[] }) {
  const waiting = waitingSessions(sessions, tasks)
  const first = waiting[0]
  if (first === undefined) return null

  return (
    <Link
      to={`/p/${taskProject(first.task)}#${first.task}`}
      className="waiting"
      title={`Ждут ответа: ${waiting.map((view) => view.task).join(', ')}`}
    >
      <span className="waiting__count">{waiting.length}</span>
      <span className="waiting__label">
        ждут<span className="waiting__tail"> ответа</span>
      </span>
    </Link>
  )
}

export function HulyState({ health, now }: { health: HulyHealth; now: Date }) {
  const ago = health.lastOkAt === null || health.state === 'live' ? null : formatAgo(health.lastOkAt, now)
  const title = [
    `Huly: ${HULY_LABELS[health.state]}`,
    ago === null ? null : `последний успешный опрос ${ago}`,
    health.error,
  ]
    .filter((line) => line !== null)
    .join('\n')

  return (
    <span className={`link-state link-state--${HULY_DOTS[health.state]}`} role="status" title={title}>
      <span className="link-state__dot" aria-hidden="true" />
      Huly
      {health.state !== 'live' && <strong className="link-state__flag">{HULY_LABELS[health.state]}</strong>}
      {ago !== null && <span className="link-state__ago">{ago}</span>}
    </span>
  )
}

export function ServerState({ link }: { link: LinkState }) {
  return (
    <span className={`link-state link-state--${link}`} role="status" title={`Сервер Baton: ${SERVER_LABELS[link]}`}>
      <span className="link-state__dot" aria-hidden="true" />
      <span className="link-state__server">{SERVER_LABELS[link]}</span>
    </span>
  )
}
