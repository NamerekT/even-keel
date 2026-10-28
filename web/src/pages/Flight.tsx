import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/** `.backlog__row--leaving` in backlog.css: the row slides out of the backlog before the copy sets off. */
const LEAVE_MS = 160
const FLIGHT_MS = 320

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
  const track = useRef<HTMLDivElement>(null)
  const land = useRef(onLand)
  land.current = onLand

  useEffect(() => {
    const node = ref.current
    const shell = track.current
    const target = document.querySelector(`[data-block="${CSS.escape(task)}"]`)
    if (node === null || shell === null || target === null) return land.current()
    const fromX = document.querySelector('.project__side')?.getBoundingClientRect().left ?? window.innerWidth
    let box = target.getBoundingClientRect()
    const place = () => {
      shell.style.transform = `translate(${box.left}px, ${box.top}px)`
      node.style.width = `${box.width}px`
      node.style.height = `${box.height}px`
    }
    place()
    // The browser runs the horizontal motion; React work cannot hold up its frames.
    const delay = Math.max(0, since + LEAVE_MS - performance.now())
    const slide = node.animate([
      { transform: `translateX(${fromX - box.left}px)` },
      { transform: 'translateX(0)' },
    ], { duration: FLIGHT_MS, delay, easing: 'cubic-bezier(0.333333, 1, 0.666667, 1)', fill: 'both' })
    const fade = node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FLIGHT_MS / 2, delay, fill: 'both' })
    slide.onfinish = () => land.current()
    let frame = requestAnimationFrame(function step() {
      if (!target.isConnected) return land.current()
      const to = target.getBoundingClientRect()
      if (to.left !== box.left || to.top !== box.top || to.width !== box.width || to.height !== box.height) {
        box = to
        place()
      }
      frame = requestAnimationFrame(step)
    })
    return () => {
      cancelAnimationFrame(frame)
      slide.cancel()
      fade.cancel()
    }
  }, [task, since])

  return createPortal(
    <div ref={track} className="flight-track" aria-hidden="true">
      <div ref={ref} className="flight" style={{ opacity: 0 }}>
        <span className="flight__key">{task}</span>
        <span className="flight__title">{title}</span>
      </div>
    </div>,
    document.body,
  )
}
