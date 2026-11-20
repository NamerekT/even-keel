import { useEffect, useState, type ComponentProps } from 'react'

// A newly sent file may not be in the transcript yet. A cleaned-up worktree's file is gone for good.
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000, 32000, 60000]

/** `fallback` — the picture as the browser holds it (the file the user chose): shown instead of retrying the service. */
export function InboxImage({ src, fallback, ...props }: ComponentProps<'img'> & { src: string; fallback?: string }) {
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const delay = RETRY_DELAYS[attempt]
    if (!failed || delay === undefined || fallback !== undefined) return
    const timer = setTimeout(() => {
      setFailed(false)
      setAttempt(attempt + 1)
    }, delay)
    return () => clearTimeout(timer)
  }, [attempt, failed, fallback])

  if (failed && fallback !== undefined) return <img {...props} src={fallback} />
  return <img {...props} src={attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}`} onError={() => setFailed(true)} />
}
