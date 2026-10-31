import type { CSSProperties, ReactNode } from 'react'
import { LOADER_MS, useLoader, type LoaderPhase } from './loaderPhase.js'
import './loader.css'

/** How much room the loader takes: a box of its own, the rest of a flex column (a window), or most of the page. */
export type LoaderFit = 'block' | 'fill' | 'page'

// The boat of the logo (web/public/favicon.svg), moved 8 units right to sit in the middle of a 48-wide sea.
const SAIL = 'M24.6 4v11.2H33Z'
const JIB = 'M23 7v8.2H16.6Z'
const HULL = 'M12.5 16.6H36l-3.8 5H15.6Z'
const KEEL = 'M22.2 21.6h4.6L25.1 28h-1.6Z'
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
            <path className="ui-loader__sail" d={SAIL} />
            <path className="ui-loader__jib" d={JIB} />
            <path className="ui-loader__sail" d={HULL} />
            <path className="ui-loader__keel" d={KEEL} />
          </g>
        </svg>
        <svg className="ui-loader__sea" viewBox="0 0 48 34">
          <path className="ui-loader__wave" d={WAVE(21.6)} />
          <path className="ui-loader__wave ui-loader__wave--deep" d={WAVE(27)} />
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
