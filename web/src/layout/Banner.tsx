import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface Content {
  children?: ReactNode
  tone?: string
  role?: 'alert' | 'status'
}

/** An empty Banner folds away, keeping its last content only until the exit finishes. */
export function Banner({ children, tone, role = 'alert' }: Content) {
  const ref = useRef<HTMLDivElement>(null)
  const shown = children != null
  const [last, setLast] = useState<Content | null>(null)
  if (shown && (last?.children !== children || last.tone !== tone || last.role !== role)) {
    setLast({ children, tone, role })
  }

  useLayoutEffect(() => {
    if (shown) return
    let cancelled = false
    const animations = ref.current!.getAnimations({ subtree: true })
    if (animations.length === 0) setLast(null)
    else void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (!cancelled) setLast(null)
    })
    return () => { cancelled = true }
  }, [shown])

  const content = shown ? { children, tone, role } : last
  return (
    <div ref={ref} className={`banner-slot${shown ? ' banner-slot--shown' : ''}`} inert={!shown} aria-hidden={!shown || undefined}>
      <div className="banner-slot__clip">
        {content !== null && (
          <div className={`banner${content.tone === undefined ? '' : ` banner--${content.tone}`}`} role={content.role}>
            {content.children}
          </div>
        )}
      </div>
    </div>
  )
}
