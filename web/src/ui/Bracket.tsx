import { useEffect, useLayoutEffect, useRef } from 'react'
import { bracketPath, type BracketRow } from './bracketPath.js'
import './bracket.css'

/**
 * The blockers' brackets of a `.chain__blocks` list (BTN-1714): the last item of the list, one SVG path over the whole
 * list drawn from its rows' layout, so the pieces never meet in seams. `blockers` picks the blocker rows among the rows
 * with `data-block`; the path is redrawn on each render and whenever the list or a row changes its size.
 */
export function Bracket({ blockers }: { blockers: string }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const observer = useRef<ResizeObserver | null>(null)
  const watched = useRef<Set<Element>>(new Set())

  const draw = () => {
    const svg = svgRef.current
    const list = svg?.closest('ol')
    if (!svg || !list) return
    const items = [...list.children].filter((each): each is HTMLElement => each instanceof HTMLElement && each.dataset.block !== undefined)
    const rows: BracketRow[] = items.map((each) => ({ left: each.offsetLeft, top: each.offsetTop, height: each.offsetHeight, blocker: each.matches(blockers) }))
    svg.setAttribute('width', String(list.offsetWidth))
    svg.setAttribute('height', String(list.offsetHeight))
    svg.firstElementChild?.setAttribute('d', bracketPath(rows))
    watch([list, ...items])
  }

  // Only a newly seen element is observed: observing one again would fire the observer anew and redraw in a loop.
  const watch = (elements: Element[]) => {
    const current = observer.current
    if (current === null) return
    const now = new Set(elements)
    for (const each of watched.current) if (!now.has(each)) current.unobserve(each)
    for (const each of now) if (!watched.current.has(each)) current.observe(each)
    watched.current = now
  }

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver(() => draw())
    draw()
    return () => {
      observer.current?.disconnect()
      observer.current = null
      watched.current = new Set()
    }
  }, [blockers])
  useLayoutEffect(draw)

  return (
    <li className="bracket" aria-hidden="true">
      <svg ref={svgRef} className="bracket__lines">
        <path />
      </svg>
    </li>
  )
}
