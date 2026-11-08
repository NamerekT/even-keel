import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { dragShift, dropIndex, moveItem } from './drag.js'

interface Drag {
  pointer: number
  from: number
  startY: number
  dy: number
  mids: number[]
  step: number
}

/**
 * A vertical list reordered by a handle on each row: dragged with the pointer, or moved one place with the arrow keys
 * on a focused handle. The list element takes `listRef`, each row its `offsetOf` as a `translateY`, each handle
 * `handle(index)`; a dropped row slides from where it was let go into its place.
 */
export function useDragList<L extends HTMLElement>(items: readonly string[], disabled: boolean, onMove: (order: string[]) => void) {
  const listRef = useRef<L>(null)
  const refocus = useRef<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [landing, setLanding] = useState<{ item: string; offset: number } | null>(null)
  const target = drag === null ? null : dropIndex(drag.mids, drag.mids[drag.from]! + drag.dy)

  useEffect(() => {
    if (landing === null) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setLanding(null))
    })
    return () => cancelAnimationFrame(frame)
  }, [landing])

  useLayoutEffect(() => {
    if (refocus.current === null) return
    listRef.current?.querySelector<HTMLElement>(`[data-handle="${CSS.escape(refocus.current)}"]`)?.focus()
    refocus.current = null
  })

  const grab = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || disabled || listRef.current === null) return
    const rects = [...listRef.current.children].map((row) => row.getBoundingClientRect())
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      pointer: event.pointerId,
      from: index,
      startY: event.clientY,
      dy: 0,
      mids: rects.map((rect) => rect.top + rect.height / 2),
      step: rects.length > 1 ? rects[1]!.top - rects[0]!.top : rects[0]!.height,
    })
  }

  const follow = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag?.pointer === event.pointerId) setDrag({ ...drag, dy: event.clientY - drag.startY })
  }

  const drop = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag?.pointer !== event.pointerId) return
    setDrag(null)
    if (target === null || target === drag.from) return
    setLanding({ item: items[drag.from]!, offset: drag.dy - (target - drag.from) * drag.step })
    onMove(moveItem([...items], drag.from, target))
  }

  const nudge = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null
    if (to === null) return
    event.preventDefault()
    if (disabled || to < 0 || to >= items.length) return
    refocus.current = items[index]!
    onMove(moveItem([...items], index, to))
  }

  return {
    listRef,
    dragging: drag !== null,
    landing: landing !== null,
    isDragged: (index: number) => drag?.from === index,
    offsetOf: (index: number): number => {
      if (drag !== null) return drag.from === index ? drag.dy : dragShift(index, drag.from, target!, drag.step)
      return landing !== null && landing.item === items[index] ? landing.offset : 0
    },
    handle: (index: number) => ({
      'data-handle': items[index],
      onPointerDown: grab(index),
      onPointerMove: follow,
      onPointerUp: drop,
      onPointerCancel: () => setDrag(null),
      onKeyDown: nudge(index),
    }),
  }
}
