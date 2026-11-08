import { useEffect, useState } from 'react'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { TaskCard as Card } from '../../../src/tracker/card.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Loader } from '../ui/Loader.js'
import { stillMotion } from '../ui/landing.js'
import { useLoader } from '../ui/loaderPhase.js'
import { Tipped } from '../ui/Tipped.js'
import { Attachments } from './Attachments.js'
import { recallCard, rememberCard } from './cardMemory.js'
import { CardJournal } from './CardJournal.js'
import { StatusPill, Text, useMarkdown } from './CardText.js'
import './card.css'
import './cardMain.css'
import './cardSide.css'
import './chatTask.css'

const OPEN_KEY = 'even-keel.chat.taskPanel'

export interface TaskPanelOpen {
  open: boolean
  /** Closed but still sliding out: the panel stays on the page until `left`. */
  leaving: boolean
  /** Opened or closed by a press in this window: it slides; a chat that opens with its panel shows it at once. */
  moved: boolean
  choose: (open: boolean) => void
  left: () => void
}

/** Whether the chat opens with its task panel, remembered in the browser: the chat opens as it was last left. */
export function useTaskPanelOpen(): TaskPanelOpen {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === 'open'
    } catch {
      return false
    }
  })
  const [leaving, setLeaving] = useState(false)
  const [moved, setMoved] = useState(false)
  const choose = (next: boolean) => {
    setOpen(next)
    setMoved(true)
    // Without motion no transition ends to take the panel off the page.
    setLeaving(!next && !stillMotion())
    try {
      localStorage.setItem(OPEN_KEY, next ? 'open' : 'closed')
    } catch {}
  }
  return { open, leaving, moved, choose, left: () => setLeaving(false) }
}

interface Props {
  /** The task's project GUID: the card is remembered by it, as the full card's. */
  project: string
  task: string
  /** Changes when the session's turn moves on: a session that wrote to its task is read anew. */
  beat: string
  /** Closes the chat and opens the full card of `task`, or of a task the text links to. */
  onCard: (task: string) => void
  /** Slides in as it appears. */
  slide: boolean
  /** Closed and sliding out; `onLeft` once it is out. */
  leaving: boolean
  onLeft: () => void
}

/**
 * The chat window's task panel (BTN-891): the card's title, status, description, attachments and comments, read only —
 * the task is edited and commented on in its full card, the button at the bottom.
 */
export function ChatTaskPanel({ project, task, beat, onCard, slide, leaving, onLeft }: Props) {
  const { card: load, state } = useLive()
  const [card, setCard] = useState<Card | null | undefined>(() => recallCard(project, task))
  const [error, setError] = useState<Notice | null>(null)
  // Read anew as the full card is: when the poll brings the task changed, and when the session's turn moves on.
  const row = JSON.stringify(state?.tasks.find((each) => each.project === project && each.id === task) ?? null)
  const phase = useLoader(card === undefined && error === null)
  const markdown = useMarkdown(onCard, card?.attachments ?? [])

  useEffect(() => {
    let live = true
    load(task).then(
      (answer) => {
        rememberCard(project, task, answer)
        if (!live) return
        setCard(answer)
        setError(null)
      },
      (reason: unknown) => live && setError(noticeOf(reason)),
    )
    return () => {
      live = false
    }
  }, [project, task, row, beat])

  return (
    <aside
      className={`chat-task${slide ? ' chat-task--slide' : ''}${leaving ? ' chat-task--leaving' : ''}`}
      aria-label={t.session.chat.task.panel(task)}
      inert={leaving}
      onTransitionEnd={(event) => {
        if (leaving && event.target === event.currentTarget && event.propertyName === 'width') onLeft()
      }}
    >
      <div className="chat-task__scroll">
        {phase !== 'done' ? (
          <Loader phase={phase} label={t.card.loading} fit="fill" />
        ) : (
          <>
            {error !== null && <p className="notice notice--error">{say(error)}</p>}
            {card === null && <p className="placeholder">{t.card.none}</p>}
            {card != null && (
              <>
                <header className="chat-task__head">
                  <StatusPill status={card.status} />
                  <h3 className="chat-task__title">{card.title}</h3>
                </header>
                <section className="task-card__section">
                  <h4 className="task-card__heading">{t.card.description}</h4>
                  {card.description.trim() === '' ? <p className="placeholder">{t.card.noDescription}</p> : <Text components={markdown}>{card.description}</Text>}
                </section>
                {card.attachments.length > 0 && <Attachments task={card.id} items={card.attachments} editor={null} />}
                <CardJournal task={card.id} comments={card.comments} editor={null} render={(text) => <Text components={markdown}>{text}</Text>} onDraft={() => {}} />
              </>
            )}
          </>
        )}
      </div>
      <footer className="chat-task__foot">
        <Tipped tip={t.session.chat.task.openCardTip} align="start">
          <button type="button" className="button" onClick={() => onCard(task)}>
            {t.session.chat.task.openCard}
          </button>
        </Tipped>
      </footer>
    </aside>
  )
}
