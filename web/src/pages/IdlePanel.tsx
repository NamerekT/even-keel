import { useEffect, useState } from 'react'
import { t } from '../i18n/index.js'
import { stillMotion } from '../ui/landing.js'
import { VOYAGE_TICK_MS, voyageFrame } from '../ui/voyage.js'

/** Holds the side column while no panel is open, so the chain keeps its width. */
export function IdlePanel() {
  const [meme] = useState(() => t.project.idle.memes[Math.floor(Math.random() * t.project.idle.memes.length)])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (stillMotion()) return
    const timer = setInterval(() => setTick((current) => current + 1), VOYAGE_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <aside className="idle">
      <pre className="idle__voyage" aria-hidden="true">
        {voyageFrame(tick)}
      </pre>
      <p className="idle__meme">{meme}</p>
      <p className="idle__hint">{t.project.idle.hint}</p>
    </aside>
  )
}
