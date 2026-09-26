import type { CardLamp } from '../state.js'

const LAMP_LABELS: Record<CardLamp, string> = {
  working: 'в работе',
  waiting: 'ждёт ответа',
  error: 'ошибка',
  limit: 'упёрлась в лимит',
  finished: 'сессия завершена',
  idle: 'сессии нет',
}

export function Lamp({ lamp }: { lamp: CardLamp }) {
  return <span className={`lamp lamp--${lamp}`} role="img" aria-label={LAMP_LABELS[lamp]} title={LAMP_LABELS[lamp]} />
}
