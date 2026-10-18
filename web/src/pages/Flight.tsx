import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/** `.backlog__row--leaving` in backlog.css: the row slides out of the backlog before the copy sets off. */
const LEAVE_MS = 280
const FLIGHT_MS = 560

interface Props {
  task: string
  title: string
  /** `performance.now()` of the press. */
  since: number
  onLand: () => void
}

/**
 * A copy of a backlog row entering the chain once the row has left the backlog: it starts behind the side column
 * at the height of the task's block and slides straight left onto it, following the block while the page scrolls.
 * It fades in on the way, so it does not show up out of nowhere when the side column is closed or changes meanwhile.
 */
export function Flight({ task, title, since, onLand }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const land = useRef(onLand)
  land.current = onLand

  useEffect(() => {
    let started: number | null = null
    let fromX = 0
    let frame = requestAnimationFrame(function step(now: number) {
      const node = ref.current
      const target = document.querySelector(`[data-block="${CSS.escape(task)}"]`)
      if (node === null || target === null) return land.current()
      if (now < since + LEAVE_MS) {
        frame = requestAnimationFrame(step)
        return
      }
      if (started === null) {
        started = now
        fromX = document.querySelector('.project__side')?.getBoundingClientRect().left ?? window.innerWidth
      }
      const progress = Math.min(1, (now - started) / FLIGHT_MS)
      if (progress >= 1) return land.current()
      const to = target.getBoundingClientRect()
      const eased = 1 - (1 - progress) ** 3
      node.style.transform = `translate(${fromX + (to.left - fromX) * eased}px, ${to.top}px)`
      node.style.width = `${to.width}px`
      node.style.height = `${to.height}px`
      node.style.opacity = String(Math.min(1, progress * 2))
      frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [task, since])

  return createPortal(
    <div ref={ref} className="flight" style={{ opacity: 0 }} aria-hidden="true">
      <span className="flight__key">{task}</span>
      <span className="flight__title">{title}</span>
    </div>,
    document.body,
  )
}
