import type { CacheWindow } from '../../../src/sessions/transcript.js'
import { formatClock, formatMoment } from '../format.js'
import { t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { cacheFreshness } from '../state.js'

export function CacheClock({ cache, bare = false }: { cache: CacheWindow; bare?: boolean }) {
  const now = useNow(1_000)
  const { left, level } = cacheFreshness(cache, now)
  const at = formatMoment(cache.until, now)
  const title = level === 'cold' ? t.cache.cold(at) : t.cache.warm(at, t.cache.ttl[cache.ttl])
  const value = level === 'cold' ? t.cache.coldValue : formatClock(left)

  return (
    <span className={`cache-clock cache-clock--${level}`} title={title}>
      <span className="cache-clock__dot" aria-hidden="true" />
      {bare ? value : t.cache.label(value)}
    </span>
  )
}
