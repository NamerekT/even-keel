import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { taskRunText, type TaskRun } from '../../../src/sessions/runs.js'
import type { TaskMachine } from '../lanes.js'
import type { TaskLinks } from '../state.js'
import { hasLinks, Links } from '../ui/Links.js'
import { RunLabelTag } from '../ui/RunLabelTag.js'
import { MachineTag, type TagWait } from '../ui/MachineTag.js'

interface BlockTailProps {
  run: TaskRun | null
  /** The machines the task ran on (`ChainBlock.machines`); absent — one machine. */
  machines?: TaskMachine[] | undefined
  /** `machines` are the ones its run pins it to (`ChainBlock.pinned`, BTN-1623). */
  pinned?: boolean
  /** Why the pinned task waits for its machines, shown by their tag (BTN-1807). */
  wait?: TagWait | undefined
  links: TaskLinks
  onCard: (task: string) => void
  /** "To the backlog" or "To Todo", always at the end. */
  children?: ReactNode
}

/**
 * A chain row's line on a phone (BTN-1162): after the key, the run (provider and model), the lock above the key without
 * their figures and without a zero (BTN-1365), and the row's button. When the run would be cut, the lock and the key
 * fold away together first.
 */
export function BlockTail({ run, machines, pinned = false, wait, links, onCard, children }: BlockTailProps) {
  const box = useRef<HTMLDivElement>(null)
  const linksBox = useRef<HTMLSpanElement>(null)
  const linksWidth = useRef(0)
  const [folded, setFolded] = useState(false)
  const runText = run === null ? '' : taskRunText(run)
  const linked = hasLinks(links)

  useLayoutEffect(() => {
    const tail = box.current
    if (tail === null) return
    // Nothing to fold away: folding would free no room and only flip back and forth.
    if (!linked) {
      if (folded) setFolded(false)
      return
    }
    const measure = () => {
      const cut = isCut(tail)
      if (!folded) {
        if (!cut) return
        linksWidth.current = linksBox.current?.getBoundingClientRect().width ?? 0
        setFolded(true)
        return
      }
      if (!cut && freeWidth(tail) >= linksWidth.current + gapOf(tail)) setFolded(false)
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(tail)
    return () => watch.disconnect()
  }, [folded, runText, linked])

  return (
    <div ref={box} className={folded ? 'block__tail block__tail--folded' : 'block__tail'}>
      {machines !== undefined && <MachineTag machines={machines} pinned={pinned} wait={wait} />}
      {run !== null && <RunLabelTag run={run} />}
      {linked && (
        <span ref={linksBox} className="block__tail-links">
          <Links links={links} onCard={onCard} stack />
        </span>
      )}
      {children}
    </div>
  )
}

/** The model is cut by its ellipsis, or the tail runs out of its box. */
function isCut(tail: HTMLElement): boolean {
  const model = tail.querySelector<HTMLElement>('.run-label__model')
  return (model !== null && model.scrollWidth > model.clientWidth + 1) || tail.scrollWidth > tail.clientWidth + 1
}

/** The room left in the tail beside its shown parts. */
function freeWidth(tail: HTMLElement): number {
  const shown = [...tail.children].filter((child) => child.getBoundingClientRect().width > 0)
  const used = shown.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0) + gapOf(tail) * Math.max(0, shown.length - 1)
  return tail.clientWidth - used
}

function gapOf(tail: HTMLElement): number {
  return parseFloat(getComputedStyle(tail).columnGap) || 0
}
