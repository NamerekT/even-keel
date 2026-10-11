import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { stillMotion } from './landing.js'
import { book, type Pace, typedAt, typingTime } from './typing.js'

/** Books a line of the given duration and returns when it may start; without a queue a line starts at once. */
const TypingQueue = createContext<((duration: number) => number) | null>(null)

/** Lines inside type in mount order, `count` at a time. */
export function Typists({ count, children }: { count: number; children: ReactNode }) {
  const free = useRef<number[]>([])
  const queue = useMemo(() => {
    free.current = Array.from({ length: Math.max(1, count) }, (_, index) => free.current[index] ?? 0)
    return (duration: number) => book(free.current, performance.now(), duration)
  }, [count])
  return <TypingQueue.Provider value={queue}>{children}</TypingQueue.Provider>
}

/**
 * A line typed part by part with a hold between parts. Typing runs once per mount — key the component to type
 * a new line; a changed number in the same line is taken over as it is. With `to` the line is a link; `delay` holds
 * the first character back by that many ms.
 */
export function Typed({
  parts,
  pace,
  className,
  to,
  delay = 0,
}: {
  parts: string[]
  pace: Pace
  className: string
  to?: string | null
  delay?: number
}) {
  const queue = useContext(TypingQueue)
  const latest = useRef(parts)
  latest.current = parts
  // The delay is read on every frame: a motion mark may set it a render after the line mounted.
  const latestDelay = useRef(delay)
  latestDelay.current = delay
  const startAt = useRef<{ queued: number; mounted: number } | null>(null)
  // -1 — waiting for its turn in the queue.
  const [shown, setShown] = useState(() => (stillMotion() ? Infinity : -1))

  useEffect(() => {
    if (stillMotion()) return
    startAt.current ??= { queued: queue?.(typingTime(latest.current, pace)) ?? 0, mounted: performance.now() }
    let frame = requestAnimationFrame(function step(now) {
      const { queued, mounted } = startAt.current!
      const elapsed = now - Math.max(queued, mounted + latestDelay.current)
      const count = elapsed < 0 ? -1 : typedAt(latest.current, elapsed, pace)
      const done = count >= latest.current.join('').length
      setShown(done ? Infinity : count)
      if (!done) frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  return <TypedLine text={parts.join('')} shown={shown} className={className} to={to} />
}

/** `shown` characters of `text` with the caret after them; -1 — none shown and no caret yet. */
export function TypedLine({ text, shown, className, to = null }: { text: string; shown: number; className: string; to?: string | null }) {
  const typed = Math.max(0, shown)
  const line = (
    <>
      <span className="typed__all">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, typed)}
        {typed < text.length && (
          <>
            {shown >= 0 && <span className="typed__caret" />}
            <span className="typed__rest">{text.slice(typed)}</span>
          </>
        )}
      </span>
    </>
  )
  return (
    <p className={className}>
      {to === null ? (
        line
      ) : (
        <Link to={to} className="typed__link">
          {line}
        </Link>
      )}
    </p>
  )
}
