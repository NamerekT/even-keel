import { useEffect, useLayoutEffect, useState } from 'react'
import { useVisible } from '../layout/useVisible.js'
import type { ChainBlock } from '../state.js'
import { archiveView } from '../ui/archive.js'
import { stillMotion } from '../ui/landing.js'
import { motionOf, motionSpan, type Frame, type Motion } from '../ui/motion.js'

/** The last frame of each project's chain the user saw; it outlives the page, so coming back from another page plays what changed. */
const seen = new Map<string, Frame<ChainBlock>>()

/**
 * What changed in the chain since the user last saw it. The page shows new data at once, hidden or not;
 * the motion only marks the change, and only while the page is visible: a change made out of sight
 * plays when the user comes back, as one net change.
 */
export function useChainMotion(project: string, chain: ChainBlock[], shown: ReadonlySet<string>, skip: string | null): Motion<ChainBlock> | null {
  const visible = useVisible()
  const [motion, setMotion] = useState<Motion<ChainBlock> | null>(null)
  const frame = frameOf(chain, shown)
  const key = frameKey(frame)

  useLayoutEffect(() => {
    if (!visible) return
    const prev = seen.get(project)
    seen.set(project, frame)
    if (prev === undefined) return
    const found = motionOf(prev, frame, new Set(skip === null ? [] : [skip]))
    if (found !== null) setMotion(stillMotion() ? { ...found, leaving: [] } : found)
    // The key stands for the frame, which is a new object on every render.
  }, [project, key, visible])

  useEffect(() => {
    if (motion === null) return
    const timer = setTimeout(() => setMotion(null), motionSpan(motion))
    return () => clearTimeout(timer)
  }, [motion])

  return motion
}

function frameOf(chain: ChainBlock[], shown: ReadonlySet<string>): Frame<ChainBlock> {
  const live = archiveView(chain, 0, '').visible
  return {
    order: live.map((block) => block.id),
    items: new Map(live.map((block) => [block.id, block])),
    shown,
    closed: new Set(chain.filter((block) => block.lamp === 'done' || block.lamp === 'canceled').map((block) => block.id)),
    current: chain.find((block) => block.current)?.id ?? null,
  }
}

function frameKey(frame: Frame<ChainBlock>): string {
  const done = frame.order.filter((id) => frame.items.get(id)!.lamp === 'done')
  return [frame.order.join(','), [...frame.shown].join(','), frame.current ?? '', done.join(','), frame.closed.size].join('|')
}
