import type { BlockLamp, CardLamp } from '../state.js'

export const LAMP_LABELS: Record<CardLamp | BlockLamp, string> = {
  done: 'готово',
  working: 'в работе',
  waiting: 'ждёт ответа',
  stopped: 'сессия остановилась, задача открыта',
  error: 'ошибка',
  limit: 'упёрлась в лимит',
  finished: 'сессия завершена',
  idle: 'сессии нет',
  ahead: 'впереди',
  canceled: 'отменена',
}

export function Lamp({ lamp }: { lamp: CardLamp | BlockLamp }) {
  return <span className={`lamp lamp--${lamp}`} role="img" aria-label={LAMP_LABELS[lamp]} title={LAMP_LABELS[lamp]} />
}
