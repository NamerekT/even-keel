import { useEffect, useState, type DragEvent } from 'react'
import { carriesFiles, takenFiles } from './chatFiles.js'

/**
 * Files dropped on an element: `over` while files are dragged above it, `onFiles` with them on a drop. While it is on,
 * a file dropped anywhere else on the page is refused rather than opened by the browser in place of the page.
 * Pointer drags (the chain's cards) fire no drag events, so they are not seen here.
 */
export function useFileDrop(on: boolean, onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false)

  useEffect(() => {
    if (!on) return
    const refuse = (event: globalThis.DragEvent) => {
      if (event.defaultPrevented || !carriesFiles([...(event.dataTransfer?.types ?? [])])) return
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'none'
    }
    const end = () => setOver(false)
    window.addEventListener('dragover', refuse)
    window.addEventListener('drop', refuse)
    window.addEventListener('dragend', end)
    return () => {
      window.removeEventListener('dragover', refuse)
      window.removeEventListener('drop', refuse)
      window.removeEventListener('dragend', end)
    }
  }, [on])

  const accept = (event: DragEvent<HTMLElement>) => {
    if (!on || !carriesFiles([...event.dataTransfer.types])) return false
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    return true
  }

  return {
    over: on && over,
    handlers: {
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (accept(event)) setOver(true)
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (accept(event)) setOver(true)
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!accept(event)) return
        setOver(false)
        const files = takenFiles(event.dataTransfer.items, null)
        if (files.length > 0) onFiles(files)
      },
    },
  }
}
