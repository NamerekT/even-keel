import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ChatCard, ChatChoice } from '../../../src/chats/model.js'
import type { SessionView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { FoldPresence } from '../ui/Fold.js'
import { AskPanel } from './AskPanel.js'
import { askAnswers, NO_PICK, pickAnswer, type Pick } from './askPick.js'
import { encoded, sentLine } from './ChatComposer.js'
import { chatRenewal, renewalChoice, type ChatRenewal } from './chatRenewal.js'
import { ChatRenewDialog } from './ChatRenewDialog.js'
import { shownAsk } from './composerHold.js'
import { useChatDraft } from './useChatDraft.js'
import { ComposerBanner } from './ComposerBanner.js'
import { ComposerBox } from './ComposerBox.js'
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
  const project = state?.config.projects[chat.project]
  const branch = state?.branchDrift[chat.project]
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
      known={{ agent: chat.agent, model: chat.model, effort: chat.effort, branch: project?.git ? (branch === undefined ? project.branch : branch.current) : null }}
      blank={chat.sessionId === null ? t.chats.window.blank : undefined}
      initialPrompt={(chat.state === 'starting' || chat.state === 'working') && chat.last?.from === 'user' ?
        { kind: 'prompt', at: chat.last.at, text: chat.last.text } : undefined}
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
  const { state, query, command: post } = useLive()
  const { text, files, setText, setFiles, sending, failure, dismissFailure, send } = useChatDraft({ project: chat.project, task: chat.id }, chat.sessionId ?? chat.id)
  const [renewal, setRenewal] = useState<ChatRenewal | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const ask = shownAsk(session?.ask ?? null, pending === null ? parts.answered : new Set([...parts.answered, pending]))
  const [asked, setAsked] = useState(session?.ask?.id ?? null)
  const [picks, setPicks] = useState<Pick[]>(() => session?.ask?.questions.map(() => NO_PICK) ?? [])
  if ((session?.ask?.id ?? null) !== asked) {
    setAsked(session?.ask?.id ?? null)
    setPicks(session?.ask?.questions.map(() => NO_PICK) ?? [])
  }
  useImperativeHandle(parts.handle, () => ({ attach: (more: File[]) => setFiles((now) => [...now, ...more]) }))
  // The server takes no message while the chat's session starts or works (BTN-1230).
  const starting = chat.state === 'starting' || (parts.awaitingFirstPrompt && chat.state !== 'error' && chat.state !== 'cold')
  const locked = chat.state === 'working' ? t.session.chat.working : starting ? t.chats.window.starting : null
  const left = ask === null ? 0 : ask.questions.filter((question, index) => pickAnswer(question, picks[index] ?? NO_PICK) === '').length
  const ready = text.trim() !== '' || files.length > 0 || (ask !== null && left < ask.questions.length)
  const off = locked !== null || sending || !ready

  const submit = async () => {
    const answers = ask === null ? {} : askAnswers(ask, picks)
    const retract = parts.onSent(sentLine(ask?.id ?? null, answers, text, files), files)
    if (ask !== null) setPending(ask.id)
    const ok = await send(async (message) => post('chats/send', { id: chat.id, text: message.text, answers, files: await Promise.all(message.files.map(encoded)) }))
    if (ok) onChanged()
    else {
      retract()
      setPending(null)
    }
  }

  const renew = async (picked: ChatChoice) => {
    const answers = ask === null ? {} : askAnswers(ask, picks)
    const ok = await send(async (message) => {
      const next = await query<ChatCard>('chats/renew', { id: chat.id, text: message.text, answers, files: await Promise.all(message.files.map(encoded)), ...picked })
      onChanged()
      onRenewed(next)
    })
    if (ok) setRenewal(null)
  }

  const accounts = state?.account.accounts ?? []
  // The window stands beside the field's form, not in it: a form holds no other form.
  return (
    <>
      {renewal !== null && (
        <ChatRenewDialog
          chat={chat}
          renewal={renewal}
          busy={sending}
          failure={failure}
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
      <FoldPresence className="chat__banner">
        {failure && (
          <ComposerBanner tone="error" onClose={dismissFailure}>
            {say(failure)}
          </ComposerBanner>
        )}
      </FoldPresence>
      <ComposerBox
        command={command}
        commands={false}
        text={text}
        files={files}
        sending={false}
        rows={ask === null ? 2 : 1}
        onText={setText}
        onFiles={setFiles}
        sendOff={off}
        busy={sending}
        reason={locked ?? (sending ? t.session.chat.sending : null)}
      />
      {parts.status}
      </form>
    </>
  )
}
