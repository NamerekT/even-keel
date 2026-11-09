import { useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import type { SessionMail } from '../../../src/sessions/mail.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { SessionView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand, useHold } from '../live/useCommand.js'
import { SendIcon } from '../ui/icons.js'
import { FoldPresence } from '../ui/Fold.js'
import { Tipped } from '../ui/Tipped.js'
import { AskPanel } from './AskPanel.js'
import { askAnswers, NO_PICK, pickAnswer, type Pick } from './askPick.js'
import { holdKey, sendAhead, shownAsk } from './composerHold.js'
import { checkpointOffer, lockReason } from './composerLock.js'
import { ComposerBox, useChatDraft, type DraftOwner } from './ComposerBox.js'
import { FixButton } from './FixButtons.js'
import { ChatMail } from './ChatMail.js'
import { ColdReplyDialog } from './ColdReplyDialog.js'
import { coldReply } from './coldReply.js'
import type { CommandTextHandle } from './CommandText.js'

/** How long the composer stays shut after a reply went out, unless the session moves on sooner. */
const SENT_HOLD_MS = 90_000

/** What the chat window hands the composer: files dropped anywhere on it. */
export interface ComposerHandle {
  attach: (files: File[]) => void
}

interface Props {
  project: string
  task: string
  /** The task whose draft the field keeps, the same through a handoff and after the task closes. */
  owner: DraftOwner
  /** The task is closed: the field keeps what was typed, nothing is sent. */
  closed: boolean
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
  /** Questions the feed holds answers to: their panel is never offered again. */
  answered: ReadonlySet<string>
  /** `steered` — the message goes straight into the working session; called before the server answers, it gives what takes the line back. */
  onSent: (line: FeedLine, steered: boolean) => () => void
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
export function ChatComposer({ project, task, owner, closed, session, aside, renews, accepts, mail, queued, answered, onSent, handle, status }: Props) {
  const command = useRef<CommandTextHandle>(null)
  const { send, sending, failure } = useCommand()
  // The question being answered leaves at once; a refusal brings it back with its picks, which follow the session's
  // question rather than the shown one.
  const [pending, setPending] = useState<string | null>(null)
  // A reply that would resume a session whose cache went cold first asks how to send it (BTN-757).
  const [cold, setCold] = useState<{ since: string; tokens: number } | null>(null)
  // A handoff keeps the window and this composer with its draft; what belonged to the old session goes.
  const [shownSession, setShownSession] = useState(session.sessionId)
  if (shownSession !== session.sessionId) {
    setShownSession(session.sessionId)
    setPending(null)
    setCold(null)
  }
  const ask = shownAsk(session.ask, pending === null ? answered : new Set([...answered, pending]))
  const [asked, setAsked] = useState(session.ask?.id ?? null)
  const [picks, setPicks] = useState<Pick[]>(() => session.ask?.questions.map(() => NO_PICK) ?? [])
  if ((session.ask?.id ?? null) !== asked) {
    setAsked(session.ask?.id ?? null)
    setPicks(session.ask?.questions.map(() => NO_PICK) ?? [])
  }
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const draft = useChatDraft(owner, session.sessionId, { text, files }, (found) => {
    setText(found.text)
    setFiles(found.files)
  })
  // Files come in the same states as through the "+" button: any time but while a reply is being sent.
  const attach = (more: File[]) => {
    if (!sending) setFiles((now) => [...now, ...more])
  }
  useImperativeHandle(handle, () => ({ attach }))
  const sent = useHold(holdKey(session), SENT_HOLD_MS)
  // A message to a working session goes straight in when it steers, listed as queued and not held; otherwise it waits
  // in the mailbox, whose list below tells its fate, so nothing is held or echoed.
  // A closed task takes nothing more: what a message asks would land in the worktree of a merged task (BTN-558).
  const midTurn = !closed && session.lamp === 'working' && mail?.listens === true
  const steering = midTurn && mail.steers
  const mailing = midTurn && !steering
  const locked = closed ? t.session.chat.closed : midTurn ? (aside ? t.session.chat.aside : null) : lockReason(session, aside)
  const disabled = locked !== null || sending || sent.on
  // A working session that takes no message mid-turn: the project may lack the package that would let later ones (BTN-879).
  const offer = checkpointOffer(useLive().state?.packages ?? null, project)
  const left = ask === null ? 0 : ask.questions.filter((question, index) => pickAnswer(question, picks[index] ?? NO_PICK) === '').length
  // A question may be skipped: any answer, words or file is a reply.
  const ready = text.trim() !== '' || files.length > 0 || (ask !== null && left < ask.questions.length)
  const sendOff = disabled || !ready
  const hint = sent.on ? t.session.chat.sent : (locked ?? (session.lamp === 'error' ? t.session.chat.error : ''))

  const submit = async (renew = false) => {
    const answers = ask === null ? {} : askAnswers(ask, picks)
    const body = { project, task, sessionId: session.sessionId, ask: ask?.id ?? null, answers, text, files: await Promise.all(files.map(encoded)), renew }
    // The reply's card stands in the feed before the server answers, so the question's panel and card never come back
    // in between; a new session replaces this one on `renew` and never gets the reply in its transcript.
    const show = () => {
      if (ask !== null) setPending(ask.id)
      const retract = !mailing && !renew ? onSent(sentLine(ask === null ? null : ask.id, answers, text, files), steering) : () => {}
      return () => {
        setPending(null)
        retract()
      }
    }
    if (!(await sendAhead(show, () => send('session/answer', body)))) return
    // Also when the window was closed while the reply went out: its last save kept the reply as a draft.
    void draft.clear()
    if (!mailing && !renew && !steering) sent.begin()
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
      <FoldPresence className="chat__ask">
        {ask !== null && <AskPanel ask={ask} picks={picks} disabled={disabled} ready={ready} onPick={(index, pick) => setPicks((now) => now.map((each, at) => (at === index ? pick : each)))} />}
      </FoldPresence>
      {ask?.unsaved && <p className="chat__hint">{t.session.chat.unsaved}</p>}
      <ChatMail sessionId={session.sessionId} mail={mail?.mail ?? []} queued={queued} onReply={setText} />
      <ComposerBox
        command={command}
        text={text}
        files={files}
        sending={sending}
        rows={ask === null ? 2 : 1}
        onText={setText}
        onFiles={setFiles}
        send={
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
        }
      />
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
