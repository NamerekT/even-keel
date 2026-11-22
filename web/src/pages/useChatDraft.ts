import type { Mail, SessionMail } from '../../../src/sessions/mail.js'
import { recoverMail, rememberUpload } from './mailRecovery.js'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
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

  settle = async (session: string, mail: Mail[]) => {
    await this.loading
    const draft = recoverMail(this.state.draft, session, mail)
    if (draft !== this.state.draft) {
      this.edit(draft)
      this.flush()
    }
  }

  send = async (post: (message: Draft) => Promise<unknown>, mailbox?: { session: string; mail: Mail[] }): Promise<boolean> => {
    if (this.state.sending) return false
    const message = this.state.draft
    this.dirty = true
    const recovery = mailbox && message.files.length ? rememberUpload(message, mailbox.session, mailbox.mail) : message.recovery
    this.update(recovery ? { ...empty, recovery } : empty, true)
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
        ...(next.recovery && { recovery: {
          ...next.recovery, uploads: next.recovery.uploads.filter(each => each.files !== message.files),
        } }),
        failure: noticeOf(reason),
      }, false)
      this.flush()
      return false
    } finally {
      this.release()
    }
  }
}

export function useChatDraft({ project, task }: DraftOwner, session: string, mailbox?: SessionMail) {
  const key = draftKey(project, task)
  // The session only locates a legacy draft on first open. A handoff keeps the same owner.
  const entry = useMemo(() => open.get(key) ?? new ChatDraft(key, task, session), [key])
  const { draft, sending } = useSyncExternalStore(entry.subscribe, entry.snapshot, entry.snapshot)
  useEffect(() => {
    if (mailbox?.mail.length) void entry.settle(session, mailbox.mail)
  }, [entry, session, mailbox?.mail])
  return { ...draft, sending, setText: entry.setText, setFiles: entry.setFiles, dismissFailure: entry.dismissFailure, send: (post: (message: Draft) => Promise<unknown>, mailing = false) =>
    entry.send(post, mailing && mailbox ? { session, mail: mailbox.mail } : undefined) }
}
