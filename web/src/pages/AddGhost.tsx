import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { noticeOf } from '../../../src/notice/notice.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { draftKey, type AddPlace } from '../ui/addGhost.js'
import { FieldStrip } from '../ui/FieldStrip.js'
import type { StripLine } from '../ui/fieldStripFit.js'
import { PlusIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import './addGhost.css'

/** The titles left in a ghost by Escape, by `draftKey`: this tab's memory only, gone on a reload. */
const drafts = new Map<string, string>()
/** When a ghost open at its unmount went away: one remounted at once (its group changed) opens again. */
const left = new Map<string, number>()
const REMOUNT_MS = 1_000

interface Props {
  project: string
  place: AddPlace
  label: string
  /** The closed ghost's tip; `null` — none. */
  tip?: string | null
  onCard: (task: string) => void
}

/**
 * A dashed row that turns into a title field in its place (BTN-770): Enter makes a task of the built-in tracker and keeps the
 * field for the next one, Ctrl+Enter opens the new task's card, Escape closes it keeping the text as a draft.
 */
export function AddGhost({ project, place, label, tip = null, onCard }: Props) {
  const key = draftKey(project, place)
  const { query } = useLive()
  const [open, setOpen] = useState(() => Date.now() - (left.get(key) ?? 0) < REMOUNT_MS)
  const [text, setText] = useState(() => drafts.get(key) ?? '')
  const [line, setLine] = useState<StripLine | null>(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const shown = useRef({ open, key })
  shown.current = { open, key }
  useEffect(
    () => () => {
      if (shown.current.open) left.set(shown.current.key, Date.now())
    },
    [],
  )

  const close = () => {
    if (text.trim() === '') drafts.delete(key)
    else drafts.set(key, text)
    setOpen(false)
    setLine(null)
  }
  const create = async (card: boolean) => {
    const title = text.trim()
    if (title === '') return setLine({ tone: 'plain', text: t.chain.add.empty })
    // A second Enter before the answer makes no second task.
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setLine(null)
    try {
      const made = await query<{ id: string }>('builtin/create', { project, title, status: place.status, milestone: place.milestone })
      setText('')
      drafts.delete(key)
      if (card) onCard(made.id)
    } catch (reason) {
      setLine({ tone: 'error', text: say(noticeOf(reason)) })
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void create(event.ctrlKey || event.metaKey)
    } else if (event.key === 'Escape') {
      // Only the field closes, not the panel or the page around it.
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  if (!open) {
    const button = (
      <button type="button" className="add-ghost" onClick={() => setOpen(true)}>
        <PlusIcon />
        <span className="add-ghost__label">{label}</span>
      </button>
    )
    return tip === null ? button : <Tipped tip={tip} className="add-ghost__tipped">{button}</Tipped>
  }
  return (
    <FieldStrip line={line} fold wide>
      <input
        className="add-ghost add-ghost--field"
        autoComplete="off"
        aria-label={t.chain.add.title}
        placeholder={t.chain.add.placeholder}
        value={text}
        autoFocus
        readOnly={busy}
        aria-busy={busy || undefined}
        aria-invalid={line?.tone === 'error' || undefined}
        onChange={(event) => {
          setText(event.target.value)
          if (line?.tone === 'plain') setLine(null)
        }}
        onKeyDown={keys}
        // Leaving an empty field closes it; one holding a title stays open.
        onBlur={() => text.trim() === '' && !busy && close()}
      />
    </FieldStrip>
  )
}
