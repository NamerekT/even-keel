import { useRef, useState } from 'react'
import { notice, noticeOf, type Notice } from '../../../src/notice/notice.js'
import { t } from '../i18n/index.js'
import type { AttachedFile } from '../live/connection.js'
import { fileMarkdown, inserted, settled, uploadMark } from './descriptionUpload.js'

interface Deps {
  text: string
  limit: number
  onText: (text: string) => void
  onUpload: (file: File) => Promise<AttachedFile>
  field: { current: HTMLTextAreaElement | null }
}

/**
 * Files pasted or dropped into the description (BTN-773): each stands as a mark while it uploads, then becomes its
 * Markdown; a refusal takes the mark out and is shown under the editor. `write` is every change of the text, so a mark
 * settled after the user typed on lands in what they typed.
 */
export function useUploads({ text, limit, onText, onUpload, field }: Deps) {
  const [pending, setPending] = useState(0)
  const [failure, setFailure] = useState<Notice | null>(null)
  const latest = useRef(text)
  latest.current = text
  const counter = useRef(0)

  const write = (next: string) => {
    latest.current = next
    onText(next)
  }

  /** `at` — the Markdown field, its selection is where the marks go; `null` — at the end. */
  const start = (files: File[], at: HTMLTextAreaElement | null) => {
    setFailure(null)
    let from = at?.selectionStart ?? null
    let to = at?.selectionEnd ?? null
    for (const file of files) {
      // A refusal at the service could come after the browser sent megabytes, or as a reset connection with no answer.
      if (file.size > limit) {
        setFailure(notice('builtin.fileTooLarge', { name: file.name, limit }))
        continue
      }
      const mark = uploadMark(t.card.edit.describe.uploading(file.name), ++counter.current)
      const placed = inserted(latest.current, from, to, from === null ? mark : `${mark} `)
      write(placed.text)
      from = to = from === null ? null : placed.end
      setPending((count) => count + 1)
      onUpload(file)
        .then(
          (done) => write(settled(latest.current, mark, fileMarkdown(done.name, done.type, done.url))),
          (reason: unknown) => {
            write(settled(latest.current, mark, ''))
            setFailure(noticeOf(reason))
          },
        )
        .finally(() => setPending((count) => count - 1))
    }
    if (from !== null) requestAnimationFrame(() => field.current?.setSelectionRange(from, from))
  }

  return { pending, failure, write, start }
}
