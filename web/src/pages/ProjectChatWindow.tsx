import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ChatCard, ChatChoice } from '../../../src/chats/model.js'
import type { SessionView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { FoldPresence } from '../ui/Fold.js'
import { SendIcon } from '../ui/icons.js'
import { AskPanel } from './AskPanel.js'
import { askAnswers, NO_PICK, pickAnswer, type Pick } from './askPick.js'
import { encoded, sentLine } from './ChatComposer.js'
import { chatRenewal, renewalChoice, type ChatRenewal } from './chatRenewal.js'
import { ChatRenewDialog } from './ChatRenewDialog.js'
import { sendAhead, shownAsk } from './composerHold.js'
import { ComposerBox, useChatDraft } from './ComposerBox.js'
import type { CommandTextHandle } from './CommandText.js'
import { TranscriptWindow, type WindowFoot } from './TranscriptWindow.js'

interface Props {
  chat: ChatCard
  /** The project's last choice of a new chat, offered first when the chat goes on in a new session. */
  choice: ChatChoice | null
  onClose: () => void
  /** "Continue in a new session" of an archived chat: the window of a new session. */
  onContinue: () => void
  /** A message went out: the list reads the chats again. */
  onChanged: () => void
  /** Opens another chat in place of this one: the one it goes on from, or the one it went on in (BTN-1232). */
  onOpen: (chat: ChatCard) => void
}

/**
 * A project chat's window (BTN-1231): the transcript window with a field of its own that sends to the chat, no commands
 * menu. A chat with no message yet has no session: the window shows an empty feed until the first one goes out. An
 * archived chat is only read. A message to a chat whose cache went cold or whose account is at a limit asks first whether
 * to go on in a new session (BTN-1232).
 */
export function ProjectChatWindow({ chat, choice, onClose, onContinue, onChanged, onOpen }: Props) {
  const { state } = useLive()
  const { send } = useCommand()
  const archived = chat.archivedAt !== null
  const session = chat.sessionId === null ? undefined : state?.sessions.find((each) => each.sessionId === chat.sessionId)
  // Opening the chat reads its answer; one that comes while it is open is read too.
  useEffect(() => {
    if (!archived && chat.unread) void send('chats/read', { id: chat.id })
  }, [chat.id, chat.unread, archived])
  return (
    <TranscriptWindow
      sessionId={chat.sessionId}
      account={chat.account}
      live={!archived && chat.sessionId !== null}
      task={{ key: t.chats.window.key, title: chat.title ?? t.chats.untitled }}
      known={{ agent: chat.agent, model: chat.model, effort: chat.effort }}
      blank={chat.sessionId === null ? t.chats.window.blank : undefined}
      lead={chat.previous === null ? undefined : <Continued previous={chat.previous} onOpen={onOpen} />}
      onClose={onClose}
      foot={(parts) =>
        archived ? (
          <div className="chat chat--archived">
            {parts.status}
            <p className="chat__hint">{t.chats.window.archived}</p>
            <button type="button" className="button button--primary chat__continue" onClick={onContinue}>
              {t.chats.window.continue}
            </button>
          </div>
        ) : (
          <ChatField chat={chat} choice={choice} session={session} parts={parts} onChanged={onChanged} onRenewed={onOpen} />
        )
      }
    />
  )
}

/** "Continued from …" over the feed: the chat this one goes on from, its title read once, opened on a press. */
function Continued({ previous, onOpen }: { previous: string; onOpen: (chat: ChatCard) => void }) {
  const { query } = useLive()
  const [found, setFound] = useState<ChatCard | null>(null)
  useEffect(() => {
    let alive = true
    query<ChatCard>('chats/chat', { id: previous }).then(
      (card) => alive && setFound(card),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [previous])
  return (
    <p className="chat-continued">
      {t.chats.renew.continued}{' '}
      <button type="button" className="link-button chat-continued__link" disabled={found === null} onClick={() => found !== null && onOpen(found)}>
        {found?.title ?? t.chats.renew.previous}
      </button>
    </p>
  )
}

interface FieldProps {
  chat: ChatCard
  choice: ChatChoice | null
  session: SessionView | undefined
  parts: WindowFoot
  onChanged: () => void
  onRenewed: (chat: ChatCard) => void
}

/** The field of a project chat: the open question's options or a free message, with files; shut while the chat works. */
function ChatField({ chat, choice, session, parts, onChanged, onRenewed }: FieldProps) {
  const command = useRef<CommandTextHandle>(null)
  const { state, query } = useLive()
  const { send, sending, failure } = useCommand()
  const [renewal, setRenewal] = useState<ChatRenewal | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const ask = shownAsk(session?.ask ?? null, pending === null ? parts.answered : new Set([...parts.answered, pending]))
  const [asked, setAsked] = useState(session?.ask?.id ?? null)
  const [picks, setPicks] = useState<Pick[]>(() => session?.ask?.questions.map(() => NO_PICK) ?? [])
  if ((session?.ask?.id ?? null) !== asked) {
    setAsked(session?.ask?.id ?? null)
    setPicks(session?.ask?.questions.map(() => NO_PICK) ?? [])
  }
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const draft = useChatDraft({ project: chat.project, task: chat.id }, chat.sessionId ?? chat.id, { text, files }, (found) => {
    setText(found.text)
    setFiles(found.files)
  })
  useImperativeHandle(parts.handle, () => ({ attach: (more: File[]) => !sending && setFiles((now) => [...now, ...more]) }))
  // The server takes no message while the chat's session starts or works (BTN-1230).
  const locked = chat.state === 'starting' ? t.chats.window.starting : chat.state === 'working' ? t.session.chat.working : null
  const left = ask === null ? 0 : ask.questions.filter((question, index) => pickAnswer(question, picks[index] ?? NO_PICK) === '').length
  const ready = text.trim() !== '' || files.length > 0 || (ask !== null && left < ask.questions.length)
  const off = locked !== null || sending || !ready

  const submit = async () => {
    const answers = ask === null ? {} : askAnswers(ask, picks)
    const body = { id: chat.id, text, answers, files: await Promise.all(files.map(encoded)) }
    const show = () => {
      if (ask !== null) setPending(ask.id)
      const retract = parts.onSent(sentLine(ask === null ? null : ask.id, answers, text, files))
      return () => {
        setPending(null)
        retract()
      }
    }
    if (!(await sendAhead(show, () => send('chats/send', body)))) return
    void draft.clear()
    setText('')
    setFiles([])
    onChanged()
  }

  // Rejects with why the new chat did not start: the window keeps the text and the files and shows it.
  const renew = async (picked: ChatChoice) => {
    const answers = ask === null ? {} : askAnswers(ask, picks)
    const next = await query<ChatCard>('chats/renew', { id: chat.id, text, answers, files: await Promise.all(files.map(encoded)), ...picked })
    setRenewal(null)
    void draft.clear()
    setText('')
    setFiles([])
    onChanged()
    onRenewed(next)
  }

  const accounts = state?.account.accounts ?? []
  // The window stands beside the field's form, not in it: a form holds no other form.
  return (
    <>
      {renewal !== null && (
        <ChatRenewDialog
          chat={chat}
          renewal={renewal}
          message={text.trim() !== '' ? text.trim() : files.map((file) => file.name).join(', ')}
          choice={renewalChoice(chat, renewal, choice, accounts)}
          onClose={() => setRenewal(null)}
          onReply={() => {
            setRenewal(null)
            void submit()
          }}
          onRenew={renew}
        />
      )}
      <form
        className="chat"
        onSubmit={(event) => {
          event.preventDefault()
          if (off) return
          const found = chatRenewal(chat, session, accounts.find((each) => each.key === chat.account), new Date())
          if (found === null) void submit()
          else setRenewal(found)
        }}
      >
      <FoldPresence className="chat__ask">
        {ask !== null && (
          <AskPanel
            ask={ask}
            picks={picks}
            disabled={locked !== null || sending}
            ready={ready}
            onPick={(index, pick) => setPicks((now) => now.map((each, at) => (at === index ? pick : each)))}
          />
        )}
      </FoldPresence>
      <ComposerBox
        command={command}
        commands={false}
        text={text}
        files={files}
        sending={sending}
        rows={ask === null ? 2 : 1}
        onText={setText}
        onFiles={setFiles}
        send={
          <button type="submit" className="chat__icon chat__send" disabled={off} aria-busy={sending ? true : undefined} aria-label={t.session.chat.send}>
            <SendIcon />
          </button>
        }
      />
      {parts.status}
      {failure !== null ? <p className="notice notice--error">{say(failure)}</p> : locked !== null && <p className="chat__hint">{locked}</p>}
      </form>
    </>
  )
}
