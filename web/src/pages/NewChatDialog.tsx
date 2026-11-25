import { useEffect, useId, useRef, useState } from 'react'
import type { ChatCard, ChatChoice } from '../../../src/chats/model.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import '../tools/addPackage.css'
import { useBackdropClose } from '../ui/backdrop.js'
import { CloseIcon } from '../ui/icons.js'
import { ChatChoiceForm, useChatChoice } from './ChatChoiceForm.js'
import { ChatExtrasDialog } from './ChatExtrasDialog.js'
import { ownCount, type OwnPackages } from './chatPackages.js'
import './chats.css'

interface Props {
  project: string
  /** The project's last choice, offered first. */
  choice: ChatChoice | null
  onClose: () => void
  /** The chat is made: its window opens with an empty field. */
  onStarted: (chat: ChatCard) => void
}

/**
 * The window of a new project chat (BTN-1231): the machine, the accounts by agent with their limits, then the model and
 * the effort, which stay for the whole chat (`ChatChoiceForm`). "Start chat" makes the chat; its session starts with the
 * first message.
 */
export function NewChatDialog({ project, choice, onClose, onStarted }: Props) {
  const { query } = useLive()
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const form = useChatChoice(project, choice)
  const { pick } = form
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Notice | null>(null)
  const [packages, setPackages] = useState<OwnPackages>(choice?.packages ?? {})
  const [extras, setExtras] = useState(false)

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  const start = async () => {
    if (pick.account === undefined) return
    setBusy(true)
    setFailure(null)
    try {
      const chat = await query<ChatCard>('chats/create', {
        project,
        account: pick.account.key,
        model: pick.model === '' ? null : pick.model,
        effort: pick.effort === '' ? null : pick.effort,
        ...(pick.machine !== null && { machine: pick.machine }),
        ...(ownCount(packages) > 0 && { packages }),
      })
      onStarted(chat)
    } catch (reason) {
      setFailure(noticeOf(reason))
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      className="add-package new-chat"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onClick={(event) => event.stopPropagation()}
      {...backdrop}
    >
      <form
        className="add-package__frame"
        onSubmit={(event) => {
          event.preventDefault()
          void start()
        }}
      >
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">
            {t.chats.dialog.title}
          </h2>
          <button type="button" className="panel__close" aria-label={t.chats.dialog.cancel} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <ChatChoiceForm project={project} state={form} />
        {failure !== null && <p role="alert" className="notice notice--error add-package__failure">{say(failure)}</p>}
        <footer className="add-package__foot">
          <button type="button" className="button" aria-haspopup="dialog" onClick={() => setExtras(true)}>
            {t.chats.dialog.more}
            {ownCount(packages) > 0 && (
              <span className="new-chat__more-count" title={t.chats.dialog.moreOwn(ownCount(packages))}>
                {ownCount(packages)}
              </span>
            )}
          </button>
          <span className="add-package__spacer" />
          <button type="button" className="button" onClick={onClose}>
            {t.chats.dialog.cancel}
          </button>
          <button type="submit" className="button button--primary" disabled={pick.account === undefined || busy} aria-busy={busy ? true : undefined}>
            {t.chats.dialog.start}
          </button>
        </footer>
      </form>
      {extras && <ChatExtrasDialog project={project} own={packages} onChange={setPackages} onClose={() => setExtras(false)} />}
    </dialog>
  )
}
