import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Box } from '../ui/reorder.js'

const FLIGHT_MS = 560

interface Props {
  task: string
  title: string
  from: Box
  onLand: () => void
}

/** A copy of a backlog row on its way to the task's block in the chain; it follows the block while the page scrolls. */
export function Flight({ task, title, from, onLand }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const land = useRef(onLand)
  land.current = onLand

  useEffect(() => {
    const started = performance.now()
    let frame = requestAnimationFrame(function step(now: number) {
      const node = ref.current
      const target = document.querySelector(`[data-block="${CSS.escape(task)}"]`)
      const progress = Math.min(1, (now - started) / FLIGHT_MS)
      if (node === null || target === null || progress >= 1) return land.current()
      const to = target.getBoundingClientRect()
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (2 - 2 * progress) ** 3 / 2
      const between = (start: number, end: number) => start + (end - start) * eased
      node.style.transform = `translate(${between(from.left, to.left)}px, ${between(from.top, to.top)}px)`
      node.style.width = `${between(from.width, to.width)}px`
      node.style.height = `${between(from.height, to.height)}px`
      frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [task, from])

  return createPortal(
    <div
      ref={ref}
      className="flight"
      style={{ transform: `translate(${from.left}px, ${from.top}px)`, width: from.width, height: from.height }}
      aria-hidden="true"
    >
      <span className="flight__key">{task}</span>
      <span className="flight__title">{title}</span>
    </div>,
    document.body,
  )
}
