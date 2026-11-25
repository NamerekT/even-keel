import { useLayoutEffect, useRef, useState } from 'react'
import { Tipped } from './Tipped.js'
import { wholeParts } from './wholeParts.js'
import './wholeText.css'

/**
 * A value that never breaks inside a word (BTN-1564): an e-mail stands whole, a path wraps only after its separators.
 * A piece wider than its box is cut with an ellipsis, and only then the whole value is in a tip.
 */
export function WholeText({ text, path = false, className }: { text: string; path?: boolean; className?: string }) {
  const box = useRef<HTMLElement>(null)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const element = box.current
    if (element === null) return
    const measure = () => setCut([...element.children].some((part) => part.scrollWidth > part.clientWidth + 1))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])
  return (
    <Tipped tip={text} off={!cut} focusable={cut} inline className={className === undefined ? 'whole-text' : `whole-text ${className}`}>
      <bdi ref={box} dir="ltr" className="whole-text__value">
        {wholeParts(text, path).map((part, index) => (
          <span key={index} className="whole-text__part">
            {part}
          </span>
        ))}
      </bdi>
    </Tipped>
  )
}
