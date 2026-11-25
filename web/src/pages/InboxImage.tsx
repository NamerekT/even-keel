import { useEffect, useState, type ComponentProps } from 'react'

// A newly sent file may not be in the transcript yet. A cleaned-up worktree's file is gone for good.
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000, 32000, 60000]

/** The address of a file of the service that may not be there yet, asked again a few times after each failure. */
function useRetried(src: string): { src: string; onError: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const delay = RETRY_DELAYS[attempt]
    if (!failed || delay === undefined) return
    const timer = setTimeout(() => {
      setFailed(false)
      setAttempt(attempt + 1)
    }, delay)
    return () => clearTimeout(timer)
  }, [attempt, failed])
  return { src: attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}`, onError: () => setFailed(true) }
}

/** A picture of the service that may not be there yet: retried a few times before it stays broken. */
export function InboxImage({ src, ...props }: ComponentProps<'img'> & { src: string }) {
  return <img {...props} {...useRetried(src)} />
}

/** A video of the service that may not be there yet, as `InboxImage` (BTN-1704). */
export function InboxVideo({ src, ...props }: ComponentProps<'video'> & { src: string }) {
  return <video {...props} {...useRetried(src)} />
}
