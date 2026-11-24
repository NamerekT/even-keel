import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVisible } from '../layout/useVisible.js'
import { isClosedLamp, type ChainBlock } from '../state.js'
import { archiveView } from '../ui/archive.js'
import { stillMotion } from '../ui/landing.js'
import { motionOf, motionSpan, stageOf, type Frame, type Motion, type Stage } from '../ui/motion.js'

/** The last frame of each view of a chain the user saw; it outlives the page, so coming back from another page or view plays what changed. */
const seen = new Map<string, Frame<ChainBlock>>()

interface Play {
  motion: Motion<ChainBlock>
  /** `performance.now()` when its marks come off. */
  end: number
  view: string
}

/**
 * What changed in the chain since the user last saw it. The page shows new data at once, hidden or not;
 * the motion only marks the change, and only while the page is visible: a change made out of sight
 * plays when the user comes back, as one net change. A change that comes mid-motion plays alongside it.
 *
 * `view` names the project and its filter (a machine, the parents): each view keeps its own last frame,
 * so a switch of the view is no change of the chain, and a motion of the view left stops with it (BTN-1577).
 */
export function useChainMotion(
  view: string,
  chain: ChainBlock[],
  shown: ReadonlySet<string>,
  skip: string | null,
  grouped: ReadonlySet<string>,
  onPlay: (motion: Motion<ChainBlock>) => void,
): Stage<ChainBlock> {
  const visible = useVisible()
  const [plays, setPlays] = useState<Play[]>([])
  const frame = frameOf(chain, shown, grouped)
  const key = frameKey(frame)

  useLayoutEffect(() => {
    if (!visible) return
    const prev = seen.get(view)
    seen.set(view, frame)
    const found = prev === undefined ? null : motionOf(prev, frame, new Set(skip === null ? [] : [skip]))
    const motion = found !== null && stillMotion() ? { ...found, leaving: [] } : found
    if (motion !== null) onPlay(motion)
    setPlays((current) => {
      const kept = current.filter((play) => play.view === view)
      if (motion === null) return kept.length === current.length ? current : kept
      return [...kept, { motion, end: performance.now() + motionSpan(motion), view }]
    })
    // The key stands for the frame, which is a new object on every render.
  }, [view, key, visible])

  useEffect(() => {
    if (plays.length === 0) return
    const next = Math.min(...plays.map((play) => play.end))
    const timer = setTimeout(() => setPlays((current) => current.filter((play) => play.end > performance.now())), next - performance.now())
    return () => clearTimeout(timer)
  }, [plays])

  // The render that switches the view comes before the effect drops the motions of the view left.
  return useMemo(() => stageOf(plays.filter((play) => play.view === view).map((play) => play.motion)), [plays, view])
}

/** Whether this render is the first of a new `view`: what mounts in it is the view's, not a change of the chain. */
export function useSwitched(view: string): boolean {
  const last = useRef(view)
  const switched = last.current !== view
  useLayoutEffect(() => {
    last.current = view
  })
  return switched
}

function frameOf(chain: ChainBlock[], shown: ReadonlySet<string>, grouped: ReadonlySet<string>): Frame<ChainBlock> {
  const live = archiveView(chain, 0, '').visible
  return {
    order: live.map((block) => block.id),
    items: new Map(live.map((block) => [block.id, block])),
    shown,
    closed: new Set(chain.filter((block) => isClosedLamp(block.lamp)).map((block) => block.id)),
    current: chain.find((block) => block.current)?.id ?? null,
    running: new Set(chain.filter((block) => block.current).map((block) => block.id)),
    grouped,
  }
}

function frameKey(frame: Frame<ChainBlock>): string {
  const done = frame.order.filter((id) => frame.items.get(id)!.lamp === 'done')
  const lanes = [[...frame.running].join(','), [...frame.grouped].join(',')]
  return [frame.order.join(','), [...frame.shown].join(','), frame.current ?? '', done.join(','), frame.closed.size, ...lanes].join('|')
}
