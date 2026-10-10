import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n/index.js'
import { stillMotion } from '../ui/landing.js'
import { longestRun, type Meme, momentsOf, pickMeme, type Scene } from '../ui/memes.js'
import { TypedLine } from '../ui/Typed.js'
import { shownAt, typingTime } from '../ui/typing.js'
import { VOYAGE_TICK_MS, voyageFrame } from '../ui/voyage.js'

const IDLE_PACE = { charMs: 40, pauseMs: 1500 }
/** How long a general line stays typed before it is erased for the next one. */
const HOLD_MS = 7000

/** Holds the side column while no panel is open, so the chain keeps its width. */
export function IdlePanel({ scene }: { scene: Scene }) {
  const moments = momentsOf(scene)
  const cue = moments.join()
  const draw = (previous?: Meme) => pickMeme(moments, t.project.idle.memes.length, Math.random, previous)
  const [meme, setMeme] = useState<Meme>(() => draw())
  const parts = memeParts(meme, scene)
  const [shown, setShown] = useState(() => (stillMotion() ? Infinity : 0))
  const [tick, setTick] = useState(0)
  // When the line started, when it starts being erased (ms after the start), and the moments it was drawn on.
  const line = useRef({ start: performance.now(), eraseAt: null as number | null, cue })
  const latest = useRef({ meme, parts, cue, draw })
  latest.current = { meme, parts, cue, draw }

  // A general line goes on its own; the drive and a moment's line stay until the moments change.
  useEffect(() => {
    if ('line' in meme || line.current.cue === cue) return
    if (stillMotion()) {
      line.current = { start: performance.now(), eraseAt: null, cue }
      setMeme(draw(meme))
      return
    }
    line.current.eraseAt ??= Math.max(performance.now() - line.current.start, typingTime(parts, IDLE_PACE))
  }, [cue])

  useEffect(() => {
    if (stillMotion()) return
    let frame = requestAnimationFrame(function step(now) {
      const { meme, parts, cue, draw } = latest.current
      const elapsed = now - line.current.start
      const eraseAt = 'line' in meme ? typingTime(parts, IDLE_PACE) + HOLD_MS : line.current.eraseAt
      const count = shownAt(parts, elapsed, IDLE_PACE, eraseAt)
      if (eraseAt !== null && elapsed > eraseAt && count === 0) {
        line.current = { start: now, eraseAt: null, cue }
        setMeme(draw(meme))
      }
      setShown(count)
      frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (stillMotion()) return
    const timer = setInterval(() => setTick((current) => current + 1), VOYAGE_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <aside className="idle">
      <pre className="idle__voyage" aria-hidden="true">
        {voyageFrame(tick, 'drive' in meme)}
      </pre>
      <TypedLine text={parts.join('')} shown={shown} className="idle__meme" />
      <p className="idle__hint">{t.project.idle.hint}</p>
    </aside>
  )
}

function memeParts(meme: Meme, scene: Scene): string[] {
  const { idle } = t.project
  if ('drive' in meme) return idle.drive
  if ('line' in meme) return idle.memes[meme.line]!
  const line = idle.moments[meme.moment]
  return typeof line === 'function' ? line(longestRun(scene.blocks)) : line
}
