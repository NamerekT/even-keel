import type { CacheWindow } from '../../../src/sessions/transcript.js'
import { formatClock } from '../format.js'
import { t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { cacheFreshness } from '../state.js'

/** The cache's countdown with its tone; no `title` of its own — the fact around it carries the only tip (EKR-145). */
export function CacheClock({ cache, bare = false }: { cache: CacheWindow; bare?: boolean }) {
  const now = useNow(1_000)
  const { left, level } = cacheFreshness(cache, now)
  const value = level === 'cold' ? t.cache.coldValue : formatClock(left)

  return (
    <span className={`cache-clock cache-clock--${level}`}>
      <span className="cache-clock__dot" aria-hidden="true" />
      {bare ? value : t.cache.label(value)}
    </span>
  )
}
