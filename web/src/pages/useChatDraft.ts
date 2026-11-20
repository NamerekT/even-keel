import { useMemo, useSyncExternalStore } from 'react'
import { noticeOf } from '../../../src/notice/notice.js'
import { draftKey, readDraft, writeDraft, type Draft } from './chatDraft.js'

export interface DraftOwner {
  project: string
  task: string
}

const open = new Map<string, ChatDraft>()
const empty: Draft = { text: '', files: [] }

/** Shared by windows of the same chat, including the time a request spends without a window. */
class ChatDraft {
  private state = { draft: empty, sending: false }
  private listeners = new Set<() => void>()
  private timer?: ReturnType<typeof setTimeout>
  private loading?: Promise<void>
  private loaded = false
  private dirty = false

  constructor(private key: string, private task: string, private session: string) {}

  snapshot = () => this.state

  subscribe = (listener: () => void) => {
    open.set(this.key, this)
    this.listeners.add(listener)
    this.loading ??= readDraft(this.key, this.task, this.session).then(found => {
      this.loaded = true
      if (found && !this.dirty) this.update(found)
      if (this.dirty) this.flush()
      this.release()
    })
    return () => {
      this.listeners.delete(listener)
      if (!this.listeners.size) this.flush()
      this.release()
    }
  }

  private release() {
    if (this.loaded && !this.listeners.size && !this.state.sending && open.get(this.key) === this) open.delete(this.key)
  }

  private update(draft: Draft, sending = this.state.sending) {
    this.state = { draft, sending }
    for (const listener of this.listeners) listener()
  }

  private flush() {
    clearTimeout(this.timer)
    if (!this.loaded || !this.dirty) return
    this.dirty = false
    void writeDraft(this.key, this.task, this.state.draft)
  }

  private edit(draft: Draft) {
    this.dirty = true
    this.update(draft)
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 400)
  }

  setText = (text: string) => this.edit({ ...this.state.draft, text })
  setFiles = (change: (now: File[]) => File[]) => this.edit({ ...this.state.draft, files: change(this.state.draft.files) })
  /** The refusal of the last send is closed; the text it put back stays. */
  dismissFailure = () => {
    const { failure, ...rest } = this.state.draft
    if (failure !== undefined) this.edit(rest)
  }

  send = async (post: (message: Draft) => Promise<unknown>): Promise<boolean> => {
    if (this.state.sending) return false
    const message = this.state.draft
    this.dirty = true
    this.update(empty, true)
    this.flush()
    try {
      await post(message)
      this.update(this.state.draft, false)
      return true
    } catch (reason) {
      const next = this.state.draft
      this.dirty = true
      this.update({
        text: [message.text, next.text].filter(Boolean).join('\n\n'),
        files: [...message.files, ...next.files],
        failure: noticeOf(reason),
      }, false)
      this.flush()
      return false
    } finally {
      this.release()
    }
  }
}

export function useChatDraft({ project, task }: DraftOwner, session: string) {
  const key = draftKey(project, task)
  // The session only locates a legacy draft on first open. A handoff keeps the same owner.
  const entry = useMemo(() => open.get(key) ?? new ChatDraft(key, task, session), [key])
  const { draft, sending } = useSyncExternalStore(entry.subscribe, entry.snapshot, entry.snapshot)
  return { ...draft, sending, setText: entry.setText, setFiles: entry.setFiles, dismissFailure: entry.dismissFailure, send: entry.send }
}
