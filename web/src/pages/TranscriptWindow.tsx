import { FoldBody, FoldToggle } from '../ui/Fold.js'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReviewView } from '../../../src/chain/dispatcher.js'
import type { Ask } from '../../../src/sessions/ask.js'
import type { SessionMail } from '../../../src/sessions/mail.js'
import type { FeedLine, Turn } from '../../../src/sessions/transcript.js'
import { isOwnName } from '../../../src/chain/fix.js'
import type { ContextScale, SessionView } from '../../../src/state.js'
import { formatElapsed } from '../format.js'
import { formatCombo } from '../hotkeys/combo.js'
import { useDialogHotkey, useHotkeyLayout } from '../hotkeys/useHotkeys.js'
import { localized, say, t } from '../i18n/index.js'
import { useNarrow } from '../layout/useNarrow.js'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { Loader } from '../ui/Loader.js'
import { useLoader } from '../ui/loaderPhase.js'
import { PullButton } from '../ui/PullChip.js'
import { SidebarIcon } from '../ui/icons.js'
import { SessionMarkdown } from '../ui/SessionMarkdown.js'
import { Tipped } from '../ui/Tipped.js'
import { AnswerCard, AskCard } from './AskPanel.js'
import { ChatComposer, type ComposerHandle } from './ChatComposer.js'
import { ShutComposer, type DraftOwner } from './ComposerBox.js'
import { ChatStatus, useStatusFacts } from './ChatStatus.js'
import { ChatTaskPanel, useTaskPanelOpen } from './ChatTaskPanel.js'
import { answeredAsks } from './composerHold.js'
import { fileName } from './feedLine.js'
import { MediaViewer } from './MediaViewer.js'
import { ShareCard } from './ShareCard.js'
import { Thumb, Thumbs } from './Thumbs.js'
import { ToolGroup } from './ToolCalls.js'
import { editTotals, feedEntries } from './toolGroups.js'
import { transcriptMedia, type TranscriptMedia } from './transcriptMedia.js'
import { turnPhase, type TurnFacts } from './turnPhase.js'
import { useFileDrop } from './useFileDrop.js'
import './transcript.css'

const LINE_TIME = localized((language) => new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }))
const FULL_TIME = localized((language) => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }))
const POLL_MS = 5_000
const TICK_MS = 1_000
const PINNED_SLACK = 24
/** A user's message longer than this is folded, like the task prompt a session starts with. */
const FOLD_LINES = 8
const FOLD_CHARS = 600

/** The current session of a chain task: the window becomes a chat that answers it. */
export interface ChatTarget {
  project: string
  task: string
  session: SessionView
  /** The task made way for the fix of a red main: the chat shows its question and takes no answer until the chain is back. */
  aside: boolean
  /** The session is the current one of a running chain: a reply to it may go to a new session instead (BTN-757). */
  renews: boolean
  /** "Accept as answer" is offered under the field (BTN-885, `offersAccept`). */
  accepts?: boolean
  /** For the status line's ring of the session's context. */
  scale: ContextScale
  /** When the service began delivering the last answer to the session, for the turn line; `null` without one. */
  answeredAt: string | null
  /** The service is delivering that answer now. */
  delivering: boolean
  /** The session's chat mailbox: messages sent to it mid-turn and whether its hooks take them. */
  mail?: SessionMail
  /** The task's pull request in PR mode: the head links to it. */
  review?: ReviewView
}

export interface WindowTask {
  key: string
  title: string | null
  project?: string
  closed?: boolean
}

interface Props {
  sessionId: string
  account: string | null
  /** The session still runs: new lines are fetched every few seconds. */
  live: boolean
  chat?: ChatTarget
  /**
   * The session's task, for the head: its key and title; without it the head shows the session's id. With `project` the
   * window has the task's field and draft; without a chat it is shut, `closed` — because the task is.
   */
  task?: WindowTask
  /** Opens the full card of a task; with it a chat of a tracker task gets its task panel (BTN-891). */
  onCard?: (task: string) => void
  onClose: () => void
}

/**
 * A reply sent from this window, shown until the transcript has a prompt or an answer after the line it was sent at;
 * `steered` — it went straight into the working session, which is not respawned with it, and shows as queued, not in the feed.
 */
interface SentLine {
  line: FeedLine
  after: number
  steered: boolean
}

/** The whole transcript of a session: prompts, texts uncut, tool calls with their shell commands; with `chat`, a reply box under it. */
export function TranscriptWindow({ sessionId, account, live, chat, task, onCard, onClose }: Props) {
  const { transcript, onTranscript, imageUrl, sentFileUrl, sharedUrl, state } = useLive()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialogRef, () => dialogRef.current?.close())
  const listRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const composerRef = useRef<ComposerHandle>(null)
  const pinned = useRef(true)
  /** How many lines of the session's transcript are read. */
  const count = useRef(0)
  const [lines, setLines] = useState<FeedLine[] | null | undefined>(undefined)
  const [turn, setTurn] = useState<Turn | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<SentLine[]>([])
  const [viewing, setViewing] = useState<number | null>(null)
  const unread = lines == null ? [] : sent.filter((each) => !lines.slice(each.after).some(isReply))
  const all = lines == null ? null : [...lines, ...unread.filter((each) => !each.steered).map((each) => each.line)]
  // A message steered into a working session waits in the CLI's queue until its current tool call ends; the queue is
  // read from the transcript, so it outlives closing the window, and this window's own send shows until it is there.
  const inQueue = chat?.session.lamp === 'working' ? (turn?.queued ?? []) : []
  const queued = [...inQueue, ...unread.filter((each) => each.steered && !inQueue.some((line) => line.text === each.line.text)).map((each) => each.line)]
  const remoteUrl = chat?.session.remoteUrl
  // A reply sent from here counts after the transcript took over too: a late view of the session never brings its question back.
  const answered = answeredAsks([...(all ?? []), ...sent.map((each) => each.line)])
  const asks = new Map<string, Ask>((all ?? []).flatMap((line) => (line.ask === undefined ? [] : [[line.ask.id, line.ask]])))
  const shared = (tool: string, index: number) => sharedUrl(sessionId, tool, index)
  const media = transcriptMedia(
    all ?? [],
    { image: (tool, index) => imageUrl(sessionId, tool, index), file: (name) => sentFileUrl(sessionId, name), shared },
    t.session.chat.picture,
  )
  // An answered question shows as the card of its answer, the one the session waits on — in the panel under the chat.
  const entries =
    all == null
      ? null
      : feedEntries(all.filter((line) => line.ask === undefined || !(answered.has(line.ask.id) || (chat !== undefined && chat.session.ask?.id === line.ask.id))))
  const edits = editTotals(all ?? [])
  // Files dropped anywhere on the chat window join the composer's list, not only on its small field.
  const drop = useFileDrop(chat !== undefined, (files) => composerRef.current?.attach(files))
  const loader = useLoader(error === null && lines === undefined)
  // The list mounts once the loader has left, so the effects that pin it to its end wait for that too.
  const listed = entries != null && loader === 'done'
  const facts = useStatusFacts(sessionId, account, chat?.session ?? state?.sessions.find((session) => session.sessionId === sessionId) ?? null)
  const status = <ChatStatus facts={facts} scale={chat?.scale ?? state?.context ?? null} edits={edits} />
  // The task panel at the left of the feed; a fix of main has no card, and on a phone the button opens the full card
  // over the chat, which shows again when it closes.
  const narrow = useNarrow()
  const taskPanel = useTaskPanelOpen()
  const cardTask = chat !== undefined && onCard !== undefined && task !== undefined && !isOwnName(task.key) ? task.key : null
  const panel = cardTask !== null && taskPanel.open && !narrow
  const panelShown = panel || (cardTask !== null && taskPanel.leaving && !narrow)
  const toggleTask = () => {
    if (cardTask === null) return
    if (narrow) onCard?.(cardTask)
    else taskPanel.choose(!taskPanel.open)
  }
  const leaveForCard = (key: string) => {
    dialogRef.current?.close()
    onCard?.(key)
  }
  const onHotkey = useDialogHotkey('chatTask', toggleTask)
  const owner: DraftOwner | null = task?.project === undefined ? null : { project: task.project, task: task.key }

  useEffect(() => {
    // Otherwise the dialog focuses its first focusable element, the head's title, and its tip opens at once.
    // React's `autoFocus` sets no attribute, and the dialog looks only at the attribute.
    closeRef.current?.setAttribute('autofocus', '')
    dialogRef.current?.showModal()
  }, [])

  // A handoff keeps the window open and swaps only its feed for the new session's.
  useEffect(() => {
    count.current = 0
    pinned.current = true
    setLines(undefined)
    setTurn(null)
    setSent([])
    setViewing(null)
  }, [sessionId])

  // Delivering an answer stops the session for a while: the lines read so far stay, reading goes on from them.
  // A live transcript is read when the service says its file changed; the poll only covers a missed word.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let reading = false
    let again = false
    const read = async () => {
      if (reading) {
        again = true
        return
      }
      reading = true
      clearTimeout(timer)
      const from = count.current
      try {
        const found = await transcript(sessionId, from)
        if (!alive) return
        setError(null)
        setTurn(found?.turn ?? null)
        if (found === null) {
          if (from === 0) setLines(null)
        } else if (from === 0 || found.lines.length > 0) {
          count.current = from + found.lines.length
          setLines((current) => (from === 0 || current == null ? found.lines : [...current, ...found.lines]))
        }
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason))
      }
      reading = false
      if (!alive) return
      if (again) {
        again = false
        void read()
      } else if (live) timer = setTimeout(() => void read(), POLL_MS)
    }
    const off = live ? onTranscript(sessionId, () => void read()) : undefined
    void read()
    return () => {
      alive = false
      clearTimeout(timer)
      off?.()
    }
  }, [sessionId, live])

  useLayoutEffect(() => {
    const list = listRef.current
    if (list !== null && pinned.current) list.scrollTop = list.scrollHeight
  }, [lines, sent, listed])

  // The feed also changes size without new lines — a message joins the mail list, the composer grows, images and late layout
  // stretch the content after the first scroll: keep a pinned feed at its end.
  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    const observer = new ResizeObserver(() => {
      if (pinned.current) list.scrollTop = list.scrollHeight
    })
    observer.observe(list)
    if (list.firstElementChild !== null) observer.observe(list.firstElementChild)
    return () => observer.disconnect()
  }, [listed])

  const onScroll = () => {
    const list = listRef.current
    if (list !== null) pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < PINNED_SLACK
  }

  return (
    <dialog
      ref={dialogRef}
      className={`session-window transcript${chat === undefined ? '' : ' transcript--chat'}${panel ? ' transcript--task' : ''}`}
      aria-label={t.session.transcriptDialog(sessionId.slice(0, 8))}
      onClose={(event) => {
        event.stopPropagation()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation()
        onHotkey(event)
      }}
      onClick={(event) => event.stopPropagation()}
      {...backdrop}
    >
      <div className="transcript__frame">
        {panelShown && chat !== undefined && cardTask !== null && (
          <ChatTaskPanel project={chat.project} task={cardTask} beat={chat.session.lamp} onCard={leaveForCard} slide={taskPanel.moved} leaving={!panel} onLeft={taskPanel.left} />
        )}
        <div className="session-window__body" {...drop.handlers}>
          {drop.over && (
            <div className="chat__drop" aria-hidden="true">
              {t.session.chat.drop}
            </div>
          )}
          <header className="panel__head">
            {cardTask !== null && <TaskToggle open={panel} narrow={narrow} onToggle={toggleTask} />}
            <h2 className="panel__task">
              {cardTask !== null ? (
                <button type="button" className="panel__key chat__task-key" aria-expanded={narrow ? undefined : panel} onClick={toggleTask}>
                  {cardTask}
                </button>
              ) : (
                <span className="panel__key">{task?.key ?? chat?.task ?? sessionId.slice(0, 8)}</span>
              )}
              <WindowTitle sessionId={sessionId} title={task?.title ?? (chat === undefined ? t.session.transcriptTitle : t.session.chat.title)} />
            </h2>
            {chat?.review !== undefined && <PullButton review={chat.review} compact />}
            {remoteUrl != null && (
              <a
                className="panel__remote"
                href={remoteUrl}
                target="_blank"
                rel="noreferrer"
                title={`${t.session.openRemote}${account === null ? '' : t.session.onlyIn(account)}`}
                aria-label={t.session.openRemote}
              >
                ↗
              </a>
            )}
            <button ref={closeRef} type="button" className="panel__close" aria-label={t.session.closeTranscript} onClick={() => dialogRef.current?.close()}>
              ×
            </button>
          </header>
          {error !== null && <p className="notice notice--error">{error}</p>}
          {loader !== 'done' && <Loader phase={loader} label={t.common.reading} fit="fill" />}
          {loader === 'done' && lines === null && <p className="placeholder">{t.session.notFound}</p>}
          {entries != null && listed && (
            <div ref={listRef} className="transcript__scroll" onScroll={onScroll}>
              <ol className="transcript__lines">
                {entries.map((entry, index) =>
                  entry.kind === 'gap' ? (
                    <li key={index} className="transcript__gap">
                      <LineTime at={entry.at} />
                    </li>
                  ) : entry.kind === 'tools' ? (
                    <li key={index} className="transcript__entry transcript__entry--tools">
                      <LineTime at={entry.calls[0]!.line.at} hover />
                      <ToolGroup calls={entry.calls} media={media} onOpen={setViewing} />
                    </li>
                  ) : (
                    <li key={index} className={`transcript__entry transcript__entry--${entry.line.kind}`}>
                      <LineTime at={entry.line.at} hover={!isReply(entry.line)} />
                      <Line line={entry.line} chat={chat} asks={asks} media={media} onOpen={setViewing} sharedUrl={shared} />
                    </li>
                  ),
                )}
              </ol>
            </div>
          )}
          {chat === undefined ? (
            <div className="transcript__foot">
              {owner === null ? (
                status
              ) : (
                <ShutComposer
                  owner={owner}
                  sessionId={sessionId}
                  reason={task?.closed === true ? t.session.chat.closed : live ? t.session.chat.elsewhere : t.session.chat.finished}
                  status={status}
                />
              )}
            </div>
          ) : (
            <div className="transcript__foot">
              {chat.session.lamp === 'working' && (
                <TurnLine
                  facts={{
                    working: true,
                    turn,
                    lastReplyAt: lines?.findLast(isReply)?.at ?? null,
                    answers: [chat.answeredAt, sent.findLast((each) => !each.steered)?.line.at ?? null].filter((at) => at !== null),
                    delivering: chat.delivering,
                    background: chat.session.background == null ? null : { command: chat.session.background.command, since: chat.session.lastActivityAt },
                  }}
                />
              )}
              <ChatComposer
                project={chat.project}
                task={chat.task}
                owner={owner ?? { project: chat.project, task: chat.task }}
                closed={task?.closed === true}
                session={chat.session}
                aside={chat.aside}
                renews={chat.renews}
                accepts={chat.accepts === true}
                mail={chat.mail}
                queued={queued}
                answered={answered}
                handle={composerRef}
                status={status}
                onSent={(line, steered) => {
                  pinned.current = true
                  const entry = { line, after: lines?.length ?? 0, steered }
                  setSent((now) => [...now, entry])
                  return () => setSent((now) => now.filter((each) => each !== entry))
                }}
              />
            </div>
          )}
        </div>
      </div>
      {viewing !== null && media.items[viewing] !== undefined && (
        <MediaViewer items={media.items} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </dialog>
  )
}

/**
 * The turn in progress, as the Claude app shows it: "23с · Думает" or "23с · Выполняет: Bash npm test", and while an
 * answer is on its way "3с · Передаю ответ…", the clock ticking every second.
 */
function TurnLine({ facts }: { facts: TurnFacts }) {
  const now = useNow(TICK_MS)
  const phase = turnPhase(facts, now.getTime())
  if (phase === null) return null
  const elapsed = phase.since === null ? null : formatElapsed(now.getTime() - Date.parse(phase.since))
  const doing =
    phase.kind === 'delivering'
      ? t.session.chat.delivering
      : phase.kind === 'background'
        ? t.session.chat.background(phase.command)
        : phase.kind === 'thinking'
          ? t.session.chat.thinking
          : t.session.chat.running(phase.tool)
  return (
    <span className="transcript__turn">
      <span className="lamp lamp--working" aria-hidden="true" />
      <span className="transcript__turn-text">
        {[elapsed, doing]
          .filter((part) => part !== null)
          .join(' · ')}
      </span>
    </span>
  )
}

interface LineProps {
  line: FeedLine
  chat: ChatTarget | undefined
  asks: Map<string, Ask>
  media: TranscriptMedia
  onOpen: (place: number) => void
  /** The address of file `index` the session sent the user by call `tool`. */
  sharedUrl: (tool: string, index: number) => string
}

/** A line that is no call: a text of the session, a reply of the user, a question, files the session sent, an error. */
function Line({ line, chat, asks, media, onOpen, sharedUrl }: LineProps) {
  if (line.ask !== undefined) return <AskCard ask={line.ask} answers={line.ask.id === chat?.session.ask?.id ? null : {}} />
  if (isReply(line)) {
    return (
      <>
        {line.answers !== undefined && Object.keys(line.answers.answers).length > 0 && (
          <AnswerCard answers={line.answers.answers} ask={line.answers.ask === undefined ? undefined : asks.get(line.answers.ask)} />
        )}
        {(line.text !== '' || (line.files?.length ?? 0) > 0) && <UserBubble text={line.text} files={line.files ?? []} media={media} onOpen={onOpen} />}
      </>
    )
  }
  if (line.share !== undefined && line.tool !== undefined) {
    const tool = line.tool
    return <ShareCard tool={tool} share={line.share} url={(index) => sharedUrl(tool, index)} media={media} onOpen={onOpen} />
  }
  if (line.kind === 'text') return <SessionMarkdown text={line.text} />
  if (line.kind === 'image') return <Thumbs places={media.byTool.get(line.tool ?? '') ?? []} items={media.items} onOpen={onOpen} />
  return <span className="transcript__plain">{line.notice === undefined ? line.text : say(line.notice)}</span>
}

/** The head's switch of the task panel, at the side the panel opens on; on a phone it opens the full card. */
function TaskToggle({ open, narrow, onToggle }: { open: boolean; narrow: boolean; onToggle: () => void }) {
  const { current, mac } = useHotkeyLayout()
  const label = narrow ? t.session.chat.task.card : open ? t.session.chat.task.hide : t.session.chat.task.show
  return (
    <Tipped inline align="start" tip={narrow ? label : `${label} · ${formatCombo(current.chatTask, mac)}`}>
      <button
        type="button"
        className={`chat__task-toggle${open ? ' chat__task-toggle--on' : ''}`}
        aria-label={label}
        aria-pressed={narrow ? undefined : open}
        onClick={onToggle}
      >
        <SidebarIcon />
      </button>
    </Tipped>
  )
}

/** The window's title cut to one line: the full one and the session's id in the tip, a press copies the id. */
function WindowTitle({ sessionId, title }: { sessionId: string; title: string }) {
  const [copied, setCopied] = useState(false)
  const tip = [title, t.session.chat.head.session(sessionId), copied ? t.session.chat.head.copied : t.session.chat.head.copy]
  return (
    <Tipped inline align="start" className="transcript__title-tip" tip={tip.map((line) => <span key={line} className="transcript__tip-line">{line}</span>)}>
      <button
        type="button"
        className="panel__title transcript__title"
        onClick={() => void navigator.clipboard?.writeText(sessionId).then(() => setCopied(true), () => {})}
        onBlur={() => setCopied(false)}
      >
        {title}
      </button>
    </Tipped>
  )
}

/** Hours and minutes, the date and the seconds in the tip; `hover` shows it only while the line is pointed at. */
function LineTime({ at, hover = false }: { at: string; hover?: boolean }) {
  if (at === '') return null
  const date = new Date(at)
  return (
    <Tipped inline align="start" className={`transcript__time${hover ? ' transcript__time--hover' : ''}`} tip={FULL_TIME().format(date)}>
      <time dateTime={at}>{LINE_TIME().format(date)}</time>
    </Tipped>
  )
}

interface BubbleProps {
  text: string
  files: string[]
  media: TranscriptMedia
  onOpen: (place: number) => void
}

/** A message of the user on the right: their words and the files they sent, pictures as thumbnails; a long one folds. */
function UserBubble({ text, files, media, onOpen }: BubbleProps) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const long = text.split('\n').length > FOLD_LINES || text.length > FOLD_CHARS
  return (
    <div className="bubble">
      {text !== '' && <FoldBody id={bodyId} open={!long || open} preview={long}><span className="transcript__plain bubble__text">{text}</span></FoldBody>}
      {files.length > 0 && (
        <ul className="bubble__files">
          {files.map((file, index) => {
            const place = media.byFile.get(file)
            const chip = <span className="chat__file">📎 {fileName(file)}</span>
            return (
              <li key={`${file}-${index}`}>
                {place === undefined ? chip : <Thumb item={media.items[place]!} onOpen={() => onOpen(place)} fallback={chip} />}
              </li>
            )
          })}
        </ul>
      )}
      {long && (
        <FoldToggle className="bubble__more" aria-controls={bodyId} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t.session.showLess : t.session.showMore}
        </FoldToggle>
      )}
    </div>
  )
}

function isReply(line: FeedLine): boolean {
  return line.kind === 'answer' || line.kind === 'prompt'
}
