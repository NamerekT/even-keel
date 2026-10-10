import { useEffect, useRef } from 'react'
import { stillMotion } from '../ui/landing.js'

const SEA = 80
const CHOP = 30
const BOAT = 120
const SWELL = { height: 24, half: 55, from: 300, to: -70 }
const CYCLE_MS = 9000
/** The part of the cycle the swell takes to cross; the rest is calm water. */
const CROSSING = 0.6
const STEPS = 90

const chop = (() => {
  let line = `M ${-CHOP} ${SEA}`
  for (let x = -CHOP; x < 240 + CHOP; x += CHOP) line += ` q ${CHOP / 4} -4 ${CHOP / 2} 0 t ${CHOP / 2} 0`
  return line
})()

/** The swell's rise above the sea `offset` units from its crest. */
function rise(offset: number): number {
  return Math.abs(offset) >= SWELL.half ? 0 : (SWELL.height * (1 + Math.cos((Math.PI * offset) / SWELL.half))) / 2
}

function slope(offset: number): number {
  if (Math.abs(offset) >= SWELL.half) return 0
  return ((-SWELL.height * Math.PI) / (2 * SWELL.half)) * Math.sin((Math.PI * offset) / SWELL.half)
}

const swell = (() => {
  const points: string[] = []
  for (let x = -SWELL.half; x <= SWELL.half; x += 5) points.push(`${x} ${(SEA - rise(x)).toFixed(2)}`)
  const crest = `M ${points.join(' L ')}`
  return { crest, body: `${crest} L ${SWELL.half} 120 L ${-SWELL.half} 120 Z` }
})()

function crestAt(progress: number): number {
  return SWELL.from + (SWELL.to - SWELL.from) * Math.min(1, progress / CROSSING)
}

const frames = Array.from({ length: STEPS + 1 }, (_, index) => {
  const progress = index / STEPS
  const offset = BOAT - crestAt(progress)
  const angle = (-Math.atan(slope(offset)) * 180 * 0.5) / Math.PI
  return {
    offset: progress,
    swell: `translateX(${crestAt(progress).toFixed(2)}px)`,
    boat: `translateY(${(-rise(offset)).toFixed(2)}px) rotate(${angle.toFixed(2)}deg)`,
  }
})

/** A sailboat on a choppy sea that now and then rides over a swell. */
export function Voyage() {
  const swellRef = useRef<SVGGElement>(null)
  const boatRef = useRef<SVGGElement>(null)

  useEffect(() => {
    if (stillMotion()) return
    const timing = { duration: CYCLE_MS, iterations: Infinity }
    const running = [
      swellRef.current?.animate(frames.map(({ offset, swell }) => ({ offset, transform: swell })), timing),
      boatRef.current?.animate(frames.map(({ offset, boat }) => ({ offset, transform: boat })), timing),
    ]
    return () => running.forEach((animation) => animation?.cancel())
  }, [])

  return (
    <svg className="voyage" viewBox="0 0 240 120" aria-hidden="true">
      <path className="voyage__cloud" d="M 0 24 a 8 8 0 0 1 12 -7 a 10 10 0 0 1 18 2 a 7 7 0 0 1 4 13 H 2 a 6 6 0 0 1 -2 -8 Z" />
      <g className="voyage__chop">
        <path className="voyage__water" d={`${chop} V 120 H ${-CHOP} Z`} />
        <path className="voyage__line" d={chop} />
      </g>
      <g ref={swellRef} className="voyage__swell" style={{ transform: `translateX(${SWELL.from}px)` }}>
        <path className="voyage__water" d={swell.body} />
        <path className="voyage__line" d={swell.crest} />
      </g>
      <g ref={boatRef} className="voyage__boat">
        <g className="voyage__bob">
          <path className="voyage__sail" d="M 122 32 L 122 72 L 145 72 Z" />
          <path className="voyage__sail" d="M 118 38 L 118 72 L 99 72 Z" />
          <path className="voyage__line" d="M 120 76 V 29" />
          <path className="voyage__flag" d="M 120 29 L 129 32 L 120 35 Z" />
          <path className="voyage__hull" d="M 97 76 L 143 76 L 136 85 L 104 85 Z" />
        </g>
      </g>
    </svg>
  )
}
