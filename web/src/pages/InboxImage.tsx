import { useEffect, useState, type ComponentProps } from 'react'

// A newly sent file may not be in the transcript yet. A cleaned-up worktree's file is gone for good.
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000, 32000, 60000]

export function InboxImage({ src, ...props }: ComponentProps<'img'> & { src: string }) {
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

  return <img {...props} src={attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}`} onError={() => setFailed(true)} />
}
