import { useState } from 'react'
import { t } from '../i18n/index.js'
import { Tipped } from '../ui/Tipped.js'
import { useHeld } from './useHeld.js'
import { usePlaceEdit } from './usePlaceEdit.js'

/** A project chat's key in the window's head (BTN-1774): a press copies the session's id, which its tip shows. */
export function ChatKey({ label, sessionId }: { label: string; sessionId: string }) {
  const [copied, setCopied] = useState(false)
  if (sessionId === '') return <span className="panel__key">{label}</span>
  const tip = [t.session.chat.head.session(sessionId), copied ? t.session.chat.head.copied : t.session.chat.head.copy]
  return (
    <Tipped inline align="start" className="transcript__key-tip" tip={tip.map((line) => <span key={line} className="transcript__tip-line">{line}</span>)}>
      <button
        type="button"
        className="panel__key chat__task-key"
        onClick={() => void navigator.clipboard?.writeText(sessionId).then(() => setCopied(true), () => {})}
        onBlur={() => setCopied(false)}
      >
        {label}
      </button>
    </Tipped>
  )
}

/**
 * A project chat's title in the window's head, renamed in place as a built-in task's title is (`usePlaceEdit`,
 * BTN-1774): an empty one brings back the automatic title. `rename` answers with the title the chat shows now; what was
 * typed stands until then, and a refusal brings the old one back.
 */
export function ChatTitle({ title, rename }: { title: string | null; rename: (name: string) => Promise<string | null> }) {
  const held = useHeld(title ?? '')
  const { draft, show, input } = usePlaceEdit(async (to) => {
    if (to === held.shown) return
    if (to !== '') held.hold(to)
    try {
      held.hold((await rename(to)) ?? '')
    } catch {
      held.release()
    }
  })
  const shown = held.shown === '' ? t.chats.untitled : held.shown
  if (draft === null) {
    return (
      <Tipped inline align="start" className="transcript__title-tip" tip={[shown, t.chats.window.rename].map((line) => <span key={line} className="transcript__tip-line">{line}</span>)}>
        <button type="button" className="panel__title transcript__title transcript__title--edit" onClick={() => show(held.shown)}>
          {shown}
        </button>
      </Tipped>
    )
  }
  return (
    <input
      className="transcript__title-input"
      autoComplete="off"
      aria-label={t.chats.window.name}
      placeholder={t.chats.window.automatic}
      value={draft}
      autoFocus
      {...input}
    />
  )
}
