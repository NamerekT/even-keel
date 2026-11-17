import type { CSSProperties, ReactNode } from 'react'
import { LOADER_MS, useLoader, type LoaderPhase } from './loaderPhase.js'
import './loader.css'

/** How much room the loader takes: a box of its own, the rest of a flex column (a window), most of the page, or a small window of a field's list. */
export type LoaderFit = 'block' | 'fill' | 'page' | 'menu'

// The boat of the logo (web/public/favicon.svg), moved 8 units right to sit in the middle of a 48-wide sea.
const MAST = 'M23.4 3h1.3v15h-1.3Z'
const SAIL = 'M23 4.5V16.4H14.6Z'
const JIB = 'M25.1 6.5V16.4H33.4Z'
const HULL = 'M11.8 17.8H36.2Q35 23.6 30.5 24H17.5Q13 23.6 11.8 17.8Z'
const KEEL = 'M22.4 23.8h3.3L25.1 28.4h-2.1Z'
const WATERLINE = 24
// Two waves a period (16 units) wider than the sea on the left, so sliding them one period left loops without a seam.
const WAVE = (y: number) => `M-16 ${y}q4-2.4 8 0${'t8 0'.repeat(9)}`

/** The page's loader: the logo's boat rocking on a running sea, with what is loading under it. */
export function Loader({ phase, label, fit = 'block' }: { phase: Exclude<LoaderPhase, 'done'>; label: string; fit?: LoaderFit }) {
  const style = { '--loader-in': `${LOADER_MS.in}ms`, '--loader-out': `${LOADER_MS.out}ms` } as CSSProperties
  const motion = phase === 'in' ? ' ui-loader--in' : phase === 'out' ? ' ui-loader--out' : ''
  return (
    <div className={`ui-loader ui-loader--${fit}${motion}`} role="status" style={style}>
      <div className="ui-loader__scene" aria-hidden="true">
        <svg className="ui-loader__boat" viewBox="0 0 48 34">
          <g className="ui-loader__hull">
            <path className="ui-loader__sail" d={MAST} />
            <path className="ui-loader__sail" d={SAIL} />
            <path className="ui-loader__jib" d={JIB} />
            <path className="ui-loader__sail" d={HULL} />
            <path className="ui-loader__keel" d={KEEL} />
          </g>
        </svg>
        <svg className="ui-loader__sea" viewBox="0 0 48 34">
          <path className="ui-loader__wave" d={WAVE(WATERLINE)} />
          <path className="ui-loader__wave ui-loader__wave--deep" d={WAVE(WATERLINE + 3.4)} />
        </svg>
      </div>
      <p className="ui-loader__label">{label}</p>
    </div>
  )
}

/** The loader while `busy`, then `children`: the content waits for the loader's exit, so the two never overlap. */
export function Loading({ busy, label, fit, children }: { busy: boolean; label: string; fit?: LoaderFit; children?: ReactNode }) {
  const phase = useLoader(busy)
  return phase === 'done' ? <>{children}</> : <Loader phase={phase} label={label} fit={fit} />
}
