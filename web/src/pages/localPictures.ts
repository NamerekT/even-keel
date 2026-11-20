import { useEffect, useMemo, useRef } from 'react'
import { isSentPicture } from './transcriptMedia.js'

/** The pictures of messages sent from a chat window, as the browser holds them (BTN-1360). */
export interface LocalPictures {
  /** The object URL of a picture sent under `name`. */
  get: (name: string) => string | undefined
  /** Keeps the pictures among `files`; gives what drops them again, for a send that failed. */
  add: (files: File[]) => () => void
}

/**
 * Object URLs of the pictures the user sends, so a bubble shows them before the service can give them back. They live
 * while the window shows the session and are revoked when it closes or turns to another session. A new project chat's
 * first session (`''` before it) is the same conversation: its start may take minutes after the message went out (BTN-1387).
 */
export function useLocalPictures(sessionId: string): LocalPictures {
  const urls = useRef(new Map<string, string>())
  const shown = useRef(sessionId)
  useEffect(() => {
    if (shown.current !== '' && shown.current !== sessionId) revokeAll(urls.current)
    shown.current = sessionId
  }, [sessionId])
  useEffect(() => {
    const held = urls.current
    return () => revokeAll(held)
  }, [])
  return useMemo(
    () => ({
      get: (name) => urls.current.get(name),
      add: (files) => {
        const added = files.filter((file) => isSentPicture(file.name)).map((file) => {
          const url = URL.createObjectURL(file)
          const before = urls.current.get(file.name)
          if (before !== undefined) URL.revokeObjectURL(before)
          urls.current.set(file.name, url)
          return [file.name, url] as const
        })
        return () => {
          for (const [name, url] of added) {
            if (urls.current.get(name) === url) urls.current.delete(name)
            URL.revokeObjectURL(url)
          }
        }
      },
    }),
    [],
  )
}

function revokeAll(held: Map<string, string>): void {
  for (const url of held.values()) URL.revokeObjectURL(url)
  held.clear()
}
