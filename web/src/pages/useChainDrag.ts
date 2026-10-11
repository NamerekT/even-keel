import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { ChainBlock } from '../state.js'
import { moveItem } from '../ui/drag.js'
import { stillMotion } from '../ui/landing.js'
import { clampDrop, clampShift, dropBounds, nearestIndex, relatives, stackedTops, type Bounds, type Box, type Point } from '../ui/reorder.js'

const LONG_PRESS_MS = 350
const MOUSE_SLOP = 4
const TOUCH_SLOP = 8
const EDGE = 56
const EDGE_SPEED = 14
const SETTLE_MS = 200

interface Press {
  pointerId: number
  touch: boolean
  id: string
  start: Point
  timer: number | undefined
}

interface Active {
  pointerId: number
  id: string
  from: number
  order: string[]
  boxes: Box[]
  area: { width: number; height: number }
  bounds: Bounds
  grab: Point
  client: Point
}

export interface ChainDrag {
  id: string
  target: number
  offsets: Map<string, Point>
  blockers: Set<string>
  dependents: Set<string>
}

/** A card dropped back to its own place glides there from where it was let go. */
export interface Landing {
  id: string
  offset: Point
}

/** The order changed: where every card stood when the dragged one was let go, to glide them into the new layout. */
interface Reflow {
  id: string
  from: Map<string, Point>
}

interface Options {
  listRef: RefObject<HTMLElement | null>
  blocks: ChainBlock[]
  disabled: boolean
  onDrop: (order: string[]) => void
}

export function useChainDrag({ listRef, blocks, disabled, onDrop }: Options) {
  const [drag, setDrag] = useState<ChainDrag | null>(null)
  const [landing, setLanding] = useState<Landing | null>(null)
  const [settling, setSettling] = useState(false)
  const [reflow, setReflow] = useState<Reflow | null>(null)
  const press = useRef<Press | null>(null)
  const active = useRef<Active | null>(null)
  const swallowClick = useRef(false)
  const latest = useRef({ blocks, onDrop })
  latest.current = { blocks, onDrop }

  useEffect(() => {
    if (landing === null) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        setLanding(null)
        setSettling(true)
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [landing])

  useEffect(() => {
    if (!settling) return
    const timer = setTimeout(() => setSettling(false), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [settling])

  // A drop into or out of the first places changes card heights, so the new layout is measured rather than predicted.
  useLayoutEffect(() => {
    const list = listRef.current
    if (reflow === null || list === null || stillMotion()) return
    const items = [...list.querySelectorAll<HTMLElement>('[data-block]')]
    for (const item of items) item.style.transition = 'none'
    const moves = items.flatMap((item) => {
      const from = reflow.from.get(item.dataset.block!)
      if (from === undefined) return []
      const box = item.getBoundingClientRect()
      return [{ item, x: from.x - box.left, y: from.y - box.top }]
    })
    for (const { item, x, y } of moves) item.style.transform = `translate(${x}px, ${y}px)`
    const dragged = moves.find(({ item }) => item.dataset.block === reflow.id)?.item
    if (dragged !== undefined) dragged.style.zIndex = '2'
    void list.offsetHeight
    for (const { item } of moves) {
      item.style.transition = `transform ${SETTLE_MS}ms ease`
      item.style.transform = ''
    }
    const clear = () => {
      for (const item of items) item.style.transition = ''
      if (dragged !== undefined) dragged.style.zIndex = ''
    }
    const timer = setTimeout(clear, SETTLE_MS)
    return () => {
      clearTimeout(timer)
      clear()
    }
  }, [listRef, reflow])

  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    let scrollFrame = 0

    const listPoint = (client: Point): Point => {
      const rect = list.getBoundingClientRect()
      return { x: client.x - rect.left, y: client.y - rect.top }
    }

    const measure = (state: Active) => {
      const point = listPoint(state.client)
      const shift = { x: point.x - state.grab.x, y: point.y - state.grab.y }
      const { x: dx, y: dy } = clampShift(state.boxes[state.from]!, state.area, shift)
      const centers = state.boxes.map((box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 }))
      const center = { x: centers[state.from]!.x + dx, y: centers[state.from]!.y + dy }
      return { dx, dy, target: clampDrop(state.bounds, nearestIndex(centers, center), state.from) }
    }

    const render = (state: Active) => {
      const { dx, dy, target } = measure(state)
      const preview = moveItem(state.order, state.from, target)
      const tops = stackedTops(
        state.boxes,
        preview.map((id) => state.order.indexOf(id)),
      )
      const offsets = new Map<string, Point>()
      for (const [index, id] of state.order.entries()) {
        const slot = state.boxes[preview.indexOf(id)]!
        const own = state.boxes[index]!
        if (id !== state.id && tops[index] !== own.top) offsets.set(id, { x: slot.left - own.left, y: tops[index]! - own.top })
      }
      offsets.set(state.id, { x: dx, y: dy })
      const related = relatives(state.order, blockersOf(latest.current.blocks), state.id)
      setDrag({ id: state.id, target, offsets, blockers: new Set(related.blockers), dependents: new Set(related.dependents) })
    }

    const edgeScroll = () => {
      scrollFrame = 0
      const state = active.current
      if (state === null) return
      const { y } = state.client
      const step = y < EDGE ? -EDGE_SPEED : y > window.innerHeight - EDGE ? EDGE_SPEED : 0
      if (step === 0) return
      window.scrollBy(0, step)
      render(state)
      scrollFrame = requestAnimationFrame(edgeScroll)
    }

    const begin = (current: Press, client: Point) => {
      press.current = null
      const { blocks } = latest.current
      const open = blocks.filter((block) => block.open)
      const order = open.map((block) => block.id)
      const from = order.indexOf(current.id)
      if (from < 0) return
      const rect = list.getBoundingClientRect()
      const items = [...list.querySelectorAll<HTMLElement>('[data-block]')]
      const boxes = order.map((id) => {
        const box = items.find((item) => item.dataset.block === id)!.getBoundingClientRect()
        return { left: box.left - rect.left, top: box.top - rect.top, width: box.width, height: box.height }
      })
      const pinned = open[0]?.current ? 1 : 0
      const state: Active = {
        pointerId: current.pointerId,
        id: current.id,
        from,
        order,
        boxes,
        area: { width: rect.width, height: rect.height },
        bounds: dropBounds(order, new Map(open.map((block) => [block.id, block.after])), from, pinned),
        grab: listPoint(current.start),
        client,
      }
      active.current = state
      if (current.touch) navigator.vibrate?.(10)
      render(state)
    }

    const finish = (commit: boolean) => {
      const state = active.current
      active.current = null
      cancelAnimationFrame(scrollFrame)
      scrollFrame = 0
      if (state === null) return
      const { dx, dy, target } = measure(state)
      const to = commit ? target : state.from
      setDrag(null)
      if (to === state.from) setLanding({ id: state.id, offset: { x: dx, y: dy } })
      else setReflow({ id: state.id, from: positions(list) })
      swallowClick.current = true
      setTimeout(() => (swallowClick.current = false))
      if (to !== state.from) latest.current.onDrop(moveItem(state.order, state.from, to))
    }

    const cancelPress = () => {
      if (press.current !== null) clearTimeout(press.current.timer)
      press.current = null
    }

    const onMove = (event: PointerEvent) => {
      const client = { x: event.clientX, y: event.clientY }
      const state = active.current
      if (state !== null) {
        if (event.pointerId !== state.pointerId) return
        state.client = client
        render(state)
        if (scrollFrame === 0) scrollFrame = requestAnimationFrame(edgeScroll)
        return
      }
      const current = press.current
      if (current === null || event.pointerId !== current.pointerId) return
      const distance = Math.hypot(client.x - current.start.x, client.y - current.start.y)
      if (current.touch) {
        if (distance > TOUCH_SLOP) cancelPress()
      } else if (distance > MOUSE_SLOP) begin(current, client)
    }

    const onUp = (event: PointerEvent) => {
      if (active.current?.pointerId === event.pointerId) finish(true)
      else if (press.current?.pointerId === event.pointerId) cancelPress()
    }

    const onCancel = (event: PointerEvent) => {
      if (active.current?.pointerId === event.pointerId) finish(false)
      else if (press.current?.pointerId === event.pointerId) cancelPress()
    }

    const holdTouch = (event: TouchEvent) => {
      if (active.current !== null) event.preventDefault()
    }

    const holdMenu = (event: Event) => {
      if (active.current !== null || press.current?.touch) event.preventDefault()
    }

    const onClick = (event: MouseEvent) => {
      if (!swallowClick.current) return
      swallowClick.current = false
      event.preventDefault()
      event.stopPropagation()
    }

    const onDown = (event: PointerEvent) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('[data-movable]')
      if (item === null || active.current !== null) return
      const touch = event.pointerType === 'touch'
      if (!touch && event.button !== 0) return
      if (!touch) event.preventDefault()
      cancelPress()
      const current: Press = {
        pointerId: event.pointerId,
        touch,
        id: item.dataset.block!,
        start: { x: event.clientX, y: event.clientY },
        timer: undefined,
      }
      if (touch) current.timer = window.setTimeout(() => press.current === current && begin(current, current.start), LONG_PRESS_MS)
      press.current = current
    }

    list.addEventListener('pointerdown', onDown)
    list.addEventListener('touchmove', holdTouch, { passive: false })
    list.addEventListener('contextmenu', holdMenu)
    list.addEventListener('click', onClick, true)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      cancelPress()
      cancelAnimationFrame(scrollFrame)
      active.current = null
      list.removeEventListener('pointerdown', onDown)
      list.removeEventListener('touchmove', holdTouch)
      list.removeEventListener('contextmenu', holdMenu)
      list.removeEventListener('click', onClick, true)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [listRef])

  const movable = (block: ChainBlock) => !disabled && reorderable(block)

  return { drag, landing, settling, movable }
}

/** Movable apart from a command in flight: the drag hint keys off this so it does not blink out on every drop. */
export function reorderable(block: ChainBlock): boolean {
  return block.open && !block.current
}

function positions(list: HTMLElement): Map<string, Point> {
  const items = [...list.querySelectorAll<HTMLElement>('[data-block]')]
  return new Map(
    items.map((item) => {
      const box = item.getBoundingClientRect()
      return [item.dataset.block!, { x: box.left, y: box.top }]
    }),
  )
}

function blockersOf(blocks: ChainBlock[]): Map<string, string[]> {
  return new Map(blocks.map((block) => [block.id, block.blockedBy]))
}
