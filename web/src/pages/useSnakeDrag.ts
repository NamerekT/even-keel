import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ChainBlock } from '../state.js'
import { moveItem } from '../ui/drag.js'
import { clampDrop, dropBounds, nearestIndex, relatives, type Bounds, type Point } from '../ui/reorder.js'
import type { Box } from '../ui/snake.js'

const LONG_PRESS_MS = 350
const MOUSE_SLOP = 4
const TOUCH_SLOP = 8
const EDGE = 56
const EDGE_SPEED = 14

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
  bounds: Bounds
  grab: Point
  client: Point
}

export interface SnakeDrag {
  id: string
  target: number
  offsets: Map<string, Point>
  blockers: Set<string>
  dependents: Set<string>
}

export interface Landing {
  id: string
  offset: Point
}

interface Options {
  listRef: RefObject<HTMLOListElement | null>
  blocks: ChainBlock[]
  disabled: boolean
  onDrop: (order: string[]) => void
}

export function useSnakeDrag({ listRef, blocks, disabled, onDrop }: Options) {
  const [drag, setDrag] = useState<SnakeDrag | null>(null)
  const [landing, setLanding] = useState<Landing | null>(null)
  const press = useRef<Press | null>(null)
  const active = useRef<Active | null>(null)
  const swallowClick = useRef(false)
  const latest = useRef({ blocks, onDrop })
  latest.current = { blocks, onDrop }

  useEffect(() => {
    if (landing === null) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setLanding(null))
    })
    return () => cancelAnimationFrame(frame)
  }, [landing])

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
      const dx = point.x - state.grab.x
      const dy = point.y - state.grab.y
      const centers = state.boxes.map((box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 }))
      const center = { x: centers[state.from]!.x + dx, y: centers[state.from]!.y + dy }
      return { dx, dy, target: clampDrop(state.bounds, nearestIndex(centers, center), state.from) }
    }

    const render = (state: Active) => {
      const { dx, dy, target } = measure(state)
      const preview = moveItem(state.order, state.from, target)
      const offsets = new Map<string, Point>()
      for (const [index, id] of state.order.entries()) {
        const slot = state.boxes[preview.indexOf(id)]!
        const own = state.boxes[index]!
        if (id !== state.id && slot !== own) offsets.set(id, { x: slot.left - own.left, y: slot.top - own.top })
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
        bounds: dropBounds(order, blockersOf(blocks), from, pinned),
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
      const home = state.boxes[state.from]!
      const slot = state.boxes[to]!
      setDrag(null)
      setLanding({ id: state.id, offset: { x: home.left + dx - slot.left, y: home.top + dy - slot.top } })
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

  const movable = (block: ChainBlock) => !disabled && block.open && !block.current

  return { drag, landing, movable }
}

function blockersOf(blocks: ChainBlock[]): Map<string, string[]> {
  return new Map(blocks.map((block) => [block.id, block.blockedBy]))
}
