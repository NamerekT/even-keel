import type { CacheWindow } from '../../../src/sessions/transcript.js'
import { formatClock, formatMoment } from '../format.js'
import { useNow } from '../layout/useNow.js'
import { cacheFreshness } from '../state.js'

export const TTL_LABELS: Record<CacheWindow['ttl'], string> = { '5m': '5 мин', '1h': '1 ч' }

export function CacheClock({ cache, bare = false }: { cache: CacheWindow; bare?: boolean }) {
  const now = useNow(1_000)
  const { left, level } = cacheFreshness(cache, now)
  const ttl = TTL_LABELS[cache.ttl]
  const title =
    level === 'cold'
      ? `Кэш промпта остыл в ${formatMoment(cache.until, now)}: следующий ход перечитает весь контекст по цене записи`
      : `Кэш промпта тёплый до ${formatMoment(cache.until, now)}. Срок жизни — ${ttl}, каждый запрос сессии продлевает его заново`
  const value = level === 'cold' ? 'остыл' : formatClock(left)

  return (
    <span className={`cache-clock cache-clock--${level}`} title={title}>
      <span className="cache-clock__dot" aria-hidden="true" />
      {bare ? value : `кэш ${value}`}
    </span>
  )
}
