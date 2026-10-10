import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n/index.js'

/** The bottom of the page is a construction site: a barrier comes down once the reader scrolls this far. */
export function Basement() {
  const ref = useRef<HTMLDivElement>(null)
  const [down, setDown] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (node === null || down) return
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && setDown(true), { threshold: 1 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [down])

  const { sign, tape } = t.stats.basement
  return (
    <div ref={ref} className={down ? 'stats-basement stats-basement--down' : 'stats-basement'}>
      <div className="stats-basement__barrier" aria-hidden="true">
        <span className="stats-basement__post" />
        <span className="stats-basement__boom" />
      </div>
      <p className="stats-basement__sign">
        <strong>{sign[0]}</strong> {sign[1]}
      </p>
      <span className="stats-basement__tape" aria-hidden="true">
        {Array.from({ length: 12 }, () => tape).join(' · ')}
      </span>
    </div>
  )
}
