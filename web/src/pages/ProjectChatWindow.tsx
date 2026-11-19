import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ChatCard } from '../../../src/chats/model.js'
import type { SessionView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { FoldPresence } from '../ui/Fold.js'
import { SendIcon } from '../ui/icons.js'
import { AskPanel } from './AskPanel.js'
import { askAnswers, NO_PICK, pickAnswer, type Pick } from './askPick.js'
import { encoded, sentLine } from './ChatComposer.js'
import { sendAhead, shownAsk } from './composerHold.js'
import { ComposerBox, useChatDraft } from './ComposerBox.js'
import type { CommandTextHandle } from './CommandText.js'
import { TranscriptWindow, type WindowFoot } from './TranscriptWindow.js'

interface Props {
  chat: ChatCard
  onClose: () => void
  /** "Continue in a new session" of an archived chat: the window of a new session. */
  onContinue: () => void
  /** A message went out: the list reads the chats again. */
  onChanged: () => void
}

/**
 * A project chat's window (BTN-1231): the transcript window with a field of its own that sends to the chat, no commands
 * menu. A chat with no message yet has no session: the window shows an empty feed until the first one goes out. An
 * archived chat is only read.
 */
export function ProjectChatWindow({ chat, onClose, onContinue, onChanged }: Props) {
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
          <ChatField chat={chat} session={session} parts={parts} onChanged={onChanged} />
        )
      }
    />
  )
}

interface FieldProps {
  chat: ChatCard
  session: SessionView | undefined
  parts: WindowFoot
  onChanged: () => void
}

/** The field of a project chat: the open question's options or a free message, with files; shut while the chat works. */
function ChatField({ chat, session, parts, onChanged }: FieldProps) {
  const command = useRef<CommandTextHandle>(null)
  const { send, sending, failure } = useCommand()
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

  return (
    <form
      className="chat"
      onSubmit={(event) => {
        event.preventDefault()
        if (!off) void submit()
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
  )
}
