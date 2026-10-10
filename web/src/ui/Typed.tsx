import { useEffect, useRef, useState } from 'react'
import { stillMotion } from './landing.js'
import { type Pace, typedAt } from './typing.js'

/**
 * A line typed part by part with a hold between parts. Typing runs once per mount — key the component to type
 * a new line; a changed number in the same line is taken over as it is.
 */
export function Typed({ parts, pace, className }: { parts: string[]; pace: Pace; className: string }) {
  const latest = useRef(parts)
  latest.current = parts
  const [shown, setShown] = useState(() => (stillMotion() ? Infinity : 0))

  useEffect(() => {
    if (stillMotion()) return
    const start = performance.now()
    let frame = requestAnimationFrame(function step(now) {
      const count = typedAt(latest.current, now - start, pace)
      const done = count >= latest.current.join('').length
      setShown(done ? Infinity : count)
      if (!done) frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const text = parts.join('')
  return (
    <p className={className}>
      <span className="typed__all">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, shown)}
        {shown < text.length && (
          <>
            <span className="typed__caret" />
            <span className="typed__rest">{text.slice(shown)}</span>
          </>
        )}
      </span>
    </p>
  )
}
