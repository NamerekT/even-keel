import { useState } from 'react'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { BuiltinField } from '../../../src/notice/en.js'
import type { QueryOptions } from '../live/connection.js'
import { useLive } from '../live/context.js'
import { dropDraft, writeDraft, type DraftField } from './cardDrafts.js'
import { conflictOf, type Conflict } from './cardEdit.js'

export interface CardConflict extends Conflict {
  task: string
  /** The edit is one of the browser's drafts: "Take the new one" drops it. */
  kept: boolean
  /** Send the edit again over what the field holds now. */
  keep: () => void
}

export type EditOutcome = 'landed' | 'conflict' | 'refused'

export interface EditOptions extends QueryOptions {
  /** A typed field: the edit stays in the browser's drafts until it lands or the person drops it (BTN-1027). */
  kept?: boolean
  /** The task the field belongs to, when it may be sent after the card turned to another one. */
  task?: string
}

/** The writes of a card the built-in tracker keeps (BTN-771); after each that lands the card is read anew. */
export interface CardEditor {
  /** The task's project GUID: the drafts are keyed by it. */
  project: string
  busy: boolean
  /** The last refusal no field shows under itself. */
  failure: Notice | null
  conflict: CardConflict | null
  /** A command or a query of the service; the refusal, `null` when it landed. Shown by the caller. */
  run: (kind: 'command' | 'query', name: string, body: Record<string, unknown>, options?: QueryOptions) => Promise<Notice | null>
  /** `run` whose refusal is the card's `failure`. */
  call: (kind: 'command' | 'query', name: string, body: Record<string, unknown>) => Promise<boolean>
  /** A field from the value shown when the edit began: the service refuses only when the field holds another by now. */
  edit: (field: BuiltinField, from: string | null, to: string | null, options?: EditOptions) => Promise<EditOutcome>
  /** "Take the new one": drop the conflict, and the draft it kept, and read the card. */
  settle: () => void
  /** Read the card anew after a write that went by another way (an upload). */
  reload: () => void
}

export function useCardEdit(project: string, task: string, onChanged: () => void): CardEditor {
  const { command, query } = useLive()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Notice | null>(null)
  const [conflict, setConflict] = useState<CardConflict | null>(null)

  const run: CardEditor['run'] = async (kind, name, body, options) => {
    setBusy(true)
    try {
      await (kind === 'command' ? command(name, body) : query(name, body, options))
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

  const edit: CardEditor['edit'] = async (field, from, to, options = {}) => {
    setFailure(null)
    const of = options.task ?? task
    const draft = options.kept === true ? (field as DraftField) : null
    if (draft !== null) writeDraft(project, of, draft, { from: from ?? '', to: to ?? '' })
    const refused = await run('query', 'builtin/edit', { task: of, field, from, to }, { keepalive: options.keepalive })
    if (refused === null) {
      if (draft !== null) dropDraft(project, of, draft)
      return 'landed'
    }
    // Any other refusal keeps the draft too: the next open of the card sends it again.
    const found = conflictOf(refused, to)
    if (found === null) {
      setFailure(refused)
      return 'refused'
    }
    setConflict({
      ...found,
      task: of,
      kept: draft !== null,
      keep: () => {
        setConflict(null)
        void edit(field, found.theirs, to, { kept: draft !== null, task: of })
      },
    })
    return 'conflict'
  }

  const settle = () => {
    if (conflict?.kept === true) dropDraft(project, conflict.task, conflict.field as DraftField)
    setConflict(null)
    onChanged()
  }

  return { project, busy, failure, conflict, run, call, edit, settle, reload: onChanged }
}
