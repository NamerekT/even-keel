import { useEffect, useState } from 'react'
import { t } from '../i18n/index.js'
import { stillMotion } from '../ui/landing.js'
import { longestRun, type Meme, momentsOf, pickMeme, type Scene } from '../ui/memes.js'
import { VOYAGE_TICK_MS, voyageFrame } from '../ui/voyage.js'

/** Holds the side column while no panel is open, so the chain keeps its width. */
export function IdlePanel({ scene }: { scene: Scene }) {
  const moments = momentsOf(scene)
  const draw = () => pickMeme(moments, t.project.idle.memes.length, Math.random)
  const [meme, setMeme] = useState<Meme>(draw)
  const [tick, setTick] = useState(0)

  // A moment's line goes once the moment is over.
  const gone = 'moment' in meme && !moments.includes(meme.moment)
  useEffect(() => {
    if (gone) setMeme(draw())
  }, [gone])

  useEffect(() => {
    if (stillMotion()) return
    const timer = setInterval(() => setTick((current) => current + 1), VOYAGE_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const drive = 'drive' in meme
  return (
    <aside className="idle">
      <pre className="idle__voyage" aria-hidden="true">
        {voyageFrame(tick, drive)}
      </pre>
      <p className="idle__meme">{memeText(meme, scene)}</p>
      <p className="idle__hint">{t.project.idle.hint}</p>
    </aside>
  )
}

function memeText(meme: Meme, scene: Scene): string {
  const { idle } = t.project
  if ('drive' in meme) return idle.drive
  if ('line' in meme) return idle.memes[meme.line]!
  const line = idle.moments[meme.moment]
  return typeof line === 'function' ? line(longestRun(scene.blocks)) : line
}
