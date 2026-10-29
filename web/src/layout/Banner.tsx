import { useState, type ReactNode } from 'react'
import { FoldBody } from '../ui/Fold.js'

interface Content {
  children?: ReactNode
  tone?: string
  role?: 'alert' | 'status'
}

/** An empty Banner retains its content only until the shared fold finishes closing. */
export function Banner({ children, tone, role = 'alert' }: Content) {
  const shown = children != null
  const [last, setLast] = useState<Content | null>(null)
  if (shown && (last?.children !== children || last.tone !== tone || last.role !== role)) {
    setLast({ children, tone, role })
  }
  const content = shown ? { children, tone, role } : last
  return (
    <FoldBody open={shown} className="banner-slot">
      {content !== null && (
        <div className={`banner${content.tone === undefined ? '' : ` banner--${content.tone}`}`} role={content.role}>
          {content.children}
        </div>
      )}
    </FoldBody>
  )
}
