import { useState } from 'react'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { BuiltinField } from '../../../src/notice/en.js'
import { useLive } from '../live/context.js'
import { conflictOf, type Conflict } from './cardEdit.js'

export interface CardConflict extends Conflict {
  /** Send the edit again over what the field holds now. */
  keep: () => void
}

/** The writes of a card the built-in tracker keeps (BTN-771); after each that lands the card is read anew. */
export interface CardEditor {
  busy: boolean
  /** The last refusal no field shows under itself. */
  failure: Notice | null
  conflict: CardConflict | null
  /** A command or a query of the service; the refusal, `null` when it landed. Shown by the caller. */
  run: (kind: 'command' | 'query', name: string, body: Record<string, unknown>) => Promise<Notice | null>
  /** `run` whose refusal is the card's `failure`. */
  call: (kind: 'command' | 'query', name: string, body: Record<string, unknown>) => Promise<boolean>
  /** A field from the value shown when the edit began: the service refuses only when the field holds another by now. */
  edit: (field: BuiltinField, from: string | null, to: string | null) => Promise<boolean>
  /** "Take the new one": drop the conflict and read the card. */
  settle: () => void
}

export function useCardEdit(task: string, onChanged: () => void): CardEditor {
  const { command, query } = useLive()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Notice | null>(null)
  const [conflict, setConflict] = useState<CardConflict | null>(null)

  const run: CardEditor['run'] = async (kind, name, body) => {
    setBusy(true)
    try {
      await (kind === 'command' ? command(name, body) : query(name, body))
      onChanged()
      return null
    } catch (reason) {
      return noticeOf(reason)
    } finally {
      setBusy(false)
    }
  }

  const call: CardEditor['call'] = async (kind, name, body) => {
    setFailure(null)
    const refused = await run(kind, name, body)
    setFailure(refused)
    return refused === null
  }

  const edit: CardEditor['edit'] = async (field, from, to) => {
    setFailure(null)
    const refused = await run('query', 'builtin/edit', { task, field, from, to })
    if (refused === null) return true
    const found = conflictOf(refused, to)
    if (found === null) setFailure(refused)
    else
      setConflict({
        ...found,
        keep: () => {
          setConflict(null)
          void edit(field, found.theirs, to)
        },
      })
    return false
  }

  const settle = () => {
    setConflict(null)
    onChanged()
  }

  return { busy, failure, conflict, run, call, edit, settle }
}
