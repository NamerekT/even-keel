import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { stripFit, type StripFit, type StripLine } from './fieldStripFit.js'
import { Tipped } from './Tipped.js'
import './fieldStrip.css'

interface FieldStripProps {
  /** What the strip says; `null` keeps its room empty, so a line that comes later moves nothing. */
  line: StripLine | null
  /** The field: an input or a pick, as wide as the strip is to be. */
  children: ReactNode
}

/**
 * A field with a line glued under it: as wide as the field, tucked under its rounded bottom, sliding out from under it.
 * The text that does not fit drops to its short form, then is cut with the whole of it in a tip.
 */
export function FieldStrip({ line, children }: FieldStripProps) {
  return (
    <div className="field-strip">
      {children}
      <div className="field-strip__room" role={line?.tone === 'error' ? 'alert' : undefined}>
        {line !== null && <StripText key={line.tone} line={line} />}
      </div>
    </div>
  )
}

function StripText({ line }: { line: StripLine }) {
  const room = useRef<HTMLSpanElement>(null)
  const full = useRef<HTMLSpanElement>(null)
  const short = useRef<HTMLSpanElement>(null)
  const [fit, setFit] = useState<StripFit>('full')
  useLayoutEffect(() => {
    const box = room.current
    if (box === null) return
    const measure = () => setFit(stripFit(box.clientWidth, width(full.current), short.current === null ? null : width(short.current)))
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(box)
    return () => watch.disconnect()
  }, [line.text, line.short])
  const shown = fit === 'full' || line.short === undefined ? line.text : line.short
  return (
    <Tipped tip={line.text} off={fit !== 'cut'} focusable={fit === 'cut'} align="start" className={`field-strip__line field-strip__line--${line.tone}`}>
      {line.tone === 'ok' && <span className="field-strip__mark" aria-hidden="true">✓</span>}
      <span ref={room} className="field-strip__text">
        {shown}
      </span>
      <span ref={full} className="field-strip__measure" aria-hidden="true">
        {line.text}
      </span>
      {line.short !== undefined && (
        <span ref={short} className="field-strip__measure" aria-hidden="true">
          {line.short}
        </span>
      )}
    </Tipped>
  )
}

function width(element: HTMLElement | null): number {
  return element === null ? 0 : element.getBoundingClientRect().width
}
