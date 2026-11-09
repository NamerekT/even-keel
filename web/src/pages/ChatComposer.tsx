import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import type { SessionMail } from '../../../src/sessions/mail.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { SessionView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCoarsePointer } from '../layout/useCoarsePointer.js'
import { useLive } from '../live/context.js'
import { useCommand, useHold } from '../live/useCommand.js'
import { PlusIcon, SendIcon, SlashIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { AskPanel } from './AskPanel.js'
import { askAnswers, NO_PICK, pickAnswer, type Pick } from './askPick.js'
import { isBlank, readDraft, writeDraft, type Draft } from './chatDraft.js'
import { takenFiles } from './chatFiles.js'
import { sendsReply } from './chatKeys.js'
import { holdKey, shownAsk } from './composerHold.js'
import { checkpointOffer, lockReason } from './composerLock.js'
import { FixButton } from './FixButtons.js'
import { ChatMail } from './ChatMail.js'
import { ColdReplyDialog } from './ColdReplyDialog.js'
import { coldReply } from './coldReply.js'
import { CommandText, type CommandTextHandle } from './CommandText.js'

/** How long the composer stays shut after a reply went out, unless the session moves on sooner. */
const SENT_HOLD_MS = 90_000
/** How long after the last change the draft is written: a file kept on every keystroke would be copied each time. */
const DRAFT_SAVE_MS = 400

/** What the chat window hands the composer: files dropped anywhere on it. */
export interface ComposerHandle {
  attach: (files: File[]) => void
}

interface Props {
  project: string
  task: string
  session: SessionView
  aside: boolean
  /** The chain runs the task, so a reply may go to a new session instead (BTN-757); `false` — a session left after its chain stopped. */
  renews: boolean
  /** "Accept as answer" is offered (BTN-885): the session's last message may close the task. */
  accepts: boolean
  /** The session's mailbox; `listens` — it takes a message mid-turn, `steers` — straight in, not by the mailbox. */
  mail: SessionMail | undefined
  /** Messages the working session has queued and not taken yet. */
  queued: FeedLine[]
  /** `steered` — the message went straight into the working session. */
  onSent: (line: FeedLine, steered: boolean) => void
  handle?: Ref<ComposerHandle>
  /** The session's status line, under the field. */
  status?: ReactNode
}

/**
 * The bottom of the chat window: the options of the open question or a free reply, with files. A reply can be typed
 * at any time and is sent while the session waits, or mid-turn straight in when it steers and into its mailbox when
 * its hooks listen; the draft
 * outlives a new question.
 */
export function ChatComposer({ project, task, session, aside, renews, accepts, mail, queued, onSent, handle, status }: Props) {
  const command = useRef<CommandTextHandle>(null)
  const coarsePointer = useCoarsePointer()
  const { send, sending, failure } = useCommand()
  const [answered, setAnswered] = useState<string | null>(null)
  const ask = shownAsk(session.ask, answered)
  const [asked, setAsked] = useState(ask?.id ?? null)
  const [picks, setPicks] = useState<Pick[]>(() => ask?.questions.map(() => NO_PICK) ?? [])
  if ((ask?.id ?? null) !== asked) {
    setAsked(ask?.id ?? null)
    setPicks(ask?.questions.map(() => NO_PICK) ?? [])
  }
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  useChatDraft(session.sessionId, { text, files }, (draft) => {
    setText(draft.text)
    setFiles(draft.files)
  })
  // Files come in the same states as through the "+" button: any time but while a reply is being sent.
  const attach = (more: File[]) => {
    if (!sending) setFiles((now) => [...now, ...more])
  }
  useImperativeHandle(handle, () => ({ attach }))
  const sent = useHold(holdKey(session), SENT_HOLD_MS)
  // A message to a working session goes straight in when it steers, listed as queued and not held; otherwise it waits
  // in the mailbox, whose list below tells its fate, so nothing is held or echoed.
  const midTurn = session.lamp === 'working' && mail?.listens === true
  const steering = midTurn && mail.steers
  const mailing = midTurn && !steering
  const locked = midTurn ? (aside ? t.session.chat.aside : null) : lockReason(session, aside)
  const disabled = locked !== null || sending || sent.on
  // A working session that takes no message mid-turn: the project may lack the package that would let later ones (BTN-879).
  const offer = checkpointOffer(useLive().state?.packages ?? null, project)
  const left = ask === null ? 0 : ask.questions.filter((question, index) => pickAnswer(question, picks[index] ?? NO_PICK) === '').length
  // A question may be skipped: any answer, words or file is a reply.
  const ready = text.trim() !== '' || files.length > 0 || (ask !== null && left < ask.questions.length)
  const sendOff = disabled || !ready
  // A command goes only at the start of the message, so the button inserts one into an empty field only.
  const slashFree = text.trim() === '' && !sending
  const hint = sent.on ? t.session.chat.sent : (locked ?? (session.lamp === 'error' ? t.session.chat.error : ''))

  // A reply that would resume a session whose cache went cold first asks how to send it (BTN-757).
  const [cold, setCold] = useState<{ since: string; tokens: number } | null>(null)

  const submit = async (renew = false) => {
    const answers = ask === null ? {} : askAnswers(ask, picks)
    const body = { project, task, sessionId: session.sessionId, ask: ask?.id ?? null, answers, text, files: await Promise.all(files.map(encoded)), renew }
    if (!(await send('session/answer', body))) return
    // Also when the window was closed while the reply went out: its last save kept the reply as a draft.
    void writeDraft(session.sessionId, { text: '', files: [] })
    if (ask !== null) setAnswered(ask.id)
    // A new session replaces this one: its transcript never gets the reply, the panel shows the new session instead.
    if (!mailing && !renew) {
      if (!steering) sent.begin()
      onSent(sentLine(ask === null ? null : ask.id, answers, text, files), steering)
    }
    setText('')
    setFiles([])
  }

  return (
    <form
      className="chat"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready || disabled) return
        const found = midTurn ? null : coldReply(session, new Date())
        if (found === null) void submit()
        else setCold(found)
      }}
    >
      {cold !== null && (
        <ColdReplyDialog
          agent={session.agent}
          cold={cold}
          renews={renews}
          onClose={() => setCold(null)}
          onReply={() => {
            setCold(null)
            void submit()
          }}
          onRenew={() => {
            setCold(null)
            void submit(true)
          }}
        />
      )}
      {ask !== null && <AskPanel ask={ask} picks={picks} disabled={disabled} ready={ready} onPick={(index, pick) => setPicks((now) => now.map((each, at) => (at === index ? pick : each)))} />}
      {ask?.unsaved && <p className="chat__hint">{t.session.chat.unsaved}</p>}
      <ChatMail sessionId={session.sessionId} mail={mail?.mail ?? []} queued={queued} onReply={setText} />
      <div className="chat__box">
        {files.length > 0 && (
          <ul className="chat__files">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="chat__file">
                {file.name}
                <button
                  type="button"
                  className="chat__unfile"
                  aria-label={t.session.chat.removeFile(file.name)}
                  disabled={sending}
                  onClick={() => setFiles((now) => now.filter((_, at) => at !== index))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="chat__row">
          <Tipped inline align="start" tip={t.session.chat.attach}>
            <label className={`chat__icon chat__attach${sending ? ' chat__attach--off' : ''}`}>
              <PlusIcon />
              <input
                type="file"
                multiple
                disabled={sending}
                aria-label={t.session.chat.attach}
                onChange={(event) => {
                  attach([...(event.target.files ?? [])])
                  event.target.value = ''
                }}
              />
            </label>
          </Tipped>
          {/* A field already starting with a command keeps the plain tip: the press that put it there leaves the tip open. */}
          <Tipped inline align="start" tip={slashFree || text.startsWith('/') ? t.session.chat.slash : t.session.chat.slashTaken}>
            <button
              type="button"
              className="chat__icon chat__slash"
              aria-label={t.session.chat.slash}
              aria-disabled={slashFree ? undefined : true}
              onClick={() => {
                if (slashFree) command.current?.startCommand()
              }}
            >
              <SlashIcon />
            </button>
          </Tipped>
          <CommandText
            handle={command}
            rows={ask === null ? 2 : 1}
            value={text}
            disabled={sending}
            placeholder={t.session.chat.placeholder}
            onChange={setText}
            onPaste={(event) => {
              // Text goes into the field as usual; a picture or files copied in Explorer go into the list.
              const pasted = takenFiles(event.clipboardData.items, new Date())
              if (pasted.length > 0) attach(pasted)
            }}
            onKeyDown={(event) => {
              if (!sendsReply(event.nativeEvent, coarsePointer)) return
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }}
          />
          <Tipped inline tip={mailing ? t.session.chat.mailbox : t.session.chat.steers} off={!midTurn}>
            <button
              type="submit"
              className="chat__icon chat__send"
              // Mid-turn the button keeps its pointer events for the tip; the form's submit checks readiness itself.
              disabled={sendOff && !midTurn}
              aria-disabled={sendOff && midTurn ? true : undefined}
              aria-busy={sending ? true : undefined}
              aria-label={t.session.chat.send}
            >
              <SendIcon />
            </button>
          </Tipped>
        </div>
      </div>
      {status}
      {failure !== null ? (
        <p className="notice notice--error">{say(failure)}</p>
      ) : !sent.on && locked === t.session.chat.working && offer !== null ? (
        <div className="chat__hint chat__hint--fix">
          <p>
            {locked} {t.session.chat.workingCheckpoint(offer)}
          </p>
          <FixButton project={project} fix={{ to: 'packages', plugin: offer }} className="button button--small" />
        </div>
      ) : (
        hint !== '' && <p className="chat__hint">{hint}</p>
      )}
      {accepts && !sent.on && (
        <div className="chat__hint chat__hint--fix">
          <p>{t.session.acceptHint}</p>
          <Tipped inline tip={t.session.acceptTitle}>
            <button
              type="button"
              className="button button--small"
              disabled={sending}
              onClick={() => void send('chain/accept', { project, task, sessionId: session.sessionId })}
            >
              {t.session.accept}
            </button>
          </Tipped>
        </div>
      )}
    </form>
  )
}

/**
 * Keeps the unsent text and files of each session's chat across closing the window and reloading the page: read once
 * the composer opens, written a moment after each change and when it closes.
 */
function useChatDraft(sessionId: string, draft: Draft, restore: (draft: Draft) => void) {
  const read = useRef(false)
  const latest = useRef(draft)
  latest.current = draft
  useEffect(() => {
    let alive = true
    void readDraft(sessionId).then((found) => {
      if (!alive) return
      // What was typed before the read finished wins over the stored draft.
      if (found !== null && isBlank(latest.current)) restore(found)
      read.current = true
    })
    return () => {
      alive = false
      if (read.current) void writeDraft(sessionId, latest.current)
    }
  }, [sessionId])
  useEffect(() => {
    if (!read.current) return
    const timer = setTimeout(() => void writeDraft(sessionId, latest.current), DRAFT_SAVE_MS)
    return () => clearTimeout(timer)
  }, [sessionId, draft.text, draft.files])
}

async function encoded(file: File): Promise<{ name: string; data: string }> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error(`cannot read ${file.name}`))
    reader.readAsDataURL(file)
  })
  return { name: file.name, data: url.slice(url.indexOf(',') + 1) }
}

/** The reply as the transcript will show it, put into the feed before the session reads it. */
function sentLine(ask: string | null, answers: Record<string, string>, text: string, files: File[]): FeedLine {
  const given = Object.fromEntries(Object.entries(answers).filter(([, answer]) => answer.trim() !== ''))
  return {
    at: new Date().toISOString(),
    kind: ask === null ? 'prompt' : 'answer',
    text: text.trim(),
    ...(ask === null ? {} : { answers: { ask, answers: given } }),
    ...(files.length === 0 ? {} : { files: files.map((file) => file.name) }),
  }
}
