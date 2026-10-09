import { useEffect, useRef, useState, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import { isTaskId } from '../../../src/stats/model.js'
import type { TaskCard as Card, TaskRef } from '../../../src/tracker/card.js'
import { formatMoment } from '../format.js'
import { localized, say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import '../ui/markdown.css'
import './card.css'

const DAY = localized((language) => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' }))

interface Props {
  task: string
  link: string | null
  tracker: string | null
  onOpen: (task: string) => void
  onClose: () => void
}

export function TaskCard({ task, link, tracker, onOpen, onClose }: Props) {
  const { card: load } = useLive()
  const [card, setCard] = useState<Card | null | undefined>(undefined)
  const [error, setError] = useState<Notice | null>(null)
  const [round, setRound] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  useEffect(() => setCard(undefined), [task])

  useEffect(() => {
    let live = true
    setError(null)
    load(task).then(
      (answer) => live && setCard(answer),
      (reason: unknown) => live && setError(noticeOf(reason)),
    )
    return () => {
      live = false
    }
  }, [task, round])

  return (
    <dialog
      ref={dialog}
      className="task-card"
      aria-label={task}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => event.target === dialog.current && onClose()}
    >
      <div className="task-card__frame">
        <header className="task-card__head">
          <span className="task-card__key">{task}</span>
          {card != null && <span className="block__status">{card.status.name}</span>}
          <span className="task-card__spacer" />
          {link !== null && (
            <a href={link} className="button task-card__link" target="_blank" rel="noreferrer">
              {t.card.openIn(tracker)} ↗
            </a>
          )}
          <button type="button" className="task-card__close" aria-label={t.card.close} title={t.card.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="task-card__body">
          {error !== null && <p className="notice notice--error">{say(error)}</p>}
          {card === undefined && error === null && <p className="placeholder">{t.card.loading}</p>}
          {card === null && <p className="placeholder">{t.card.none}</p>}
          {card != null && <CardBody card={card} onOpen={onOpen} onChanged={() => setRound((n) => n + 1)} />}
        </div>
      </div>
    </dialog>
  )
}

function CardBody({ card, onOpen, onChanged }: { card: Card; onOpen: (task: string) => void; onChanged: () => void }) {
  const { send, sending, failure } = useCommand()
  const roles = card.labels.filter((label) => label.role !== null)
  const markdown = useMarkdown(onOpen)

  return (
    <>
      <h2 className="task-card__title">{card.title}</h2>
      <dl className="task-card__facts">
        <Fact name={t.card.priority}>
          <span className={`task-card__priority task-card__priority--${card.priority}`}>{t.card.priorities[card.priority]}</span>
        </Fact>
        <Fact name={t.card.milestone}>
          {card.milestone === null
            ? t.card.noMilestone
            : card.milestone.targetDate
              ? `${card.milestone.label} · ${t.card.due(DAY().format(card.milestone.targetDate))}`
              : card.milestone.label}
        </Fact>
        {card.parent !== null && (
          <Fact name={t.card.parent}>
            <RefLink item={card.parent} onOpen={onOpen} />
          </Fact>
        )}
      </dl>
      {card.labels.length > 0 && (
        <div className="task-card__labels">
          <ul className="task-card__chips" aria-label={t.card.labels}>
            {card.labels.map((label) => (
              <li key={label.name} className={`task-card__chip task-card__chip--${label.role ?? 'plain'}`}>
                {label.name}
              </li>
            ))}
          </ul>
          {roles.length > 0 && (
            <ul className="task-card__roles">
              {roles.map((label) => (
                <li key={label.name}>
                  <strong>{label.name}</strong> — {t.card.roles[label.role!]}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {card.requires.length > 0 && <p className="notice notice--warn">{t.card.requires(card.requires.join(', '))}</p>}
      {card.ready && (
        <div className="task-card__ready">
          <button
            type="button"
            className="button button--primary"
            disabled={sending}
            onClick={() => void send('task/ready', { task: card.id }).then((ok) => ok && onChanged())}
          >
            {t.card.ready}
          </button>
          <span className="task-card__hint">{t.card.readyHint}</span>
        </div>
      )}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      <Refs title={t.card.blockedBy} items={card.blockedBy} onOpen={onOpen} />
      <Refs title={t.card.blocks} items={card.blocks} onOpen={onOpen} />
      <Refs title={t.card.related} items={card.related} onOpen={onOpen} />
      <section className="task-card__section">
        <h3 className="task-card__heading">{t.card.description}</h3>
        {card.description.trim() === '' ? (
          <p className="placeholder">{t.card.noDescription}</p>
        ) : (
          <div className="markdown">
            <Markdown remarkPlugins={[remarkGfm]} components={markdown}>
              {card.description}
            </Markdown>
          </div>
        )}
      </section>
      {card.comments.length > 0 && (
        <section className="task-card__section">
          <h3 className="task-card__heading">{t.card.comments(card.comments.length)}</h3>
          <ol className="task-card__comments">
            {card.comments.map((comment, index) => (
              <li key={index} className="task-card__comment">
                <div className="task-card__comment-head">
                  <strong>{comment.author ?? t.card.noAuthor}</strong>
                  <time dateTime={new Date(comment.at).toISOString()}>{formatMoment(new Date(comment.at).toISOString(), new Date())}</time>
                </div>
                <div className="markdown">
                  <Markdown remarkPlugins={[remarkGfm]} components={markdown}>
                    {comment.text}
                  </Markdown>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  )
}

function Fact({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="task-card__fact">
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function Refs({ title, items, onOpen }: { title: string; items: TaskRef[]; onOpen: (task: string) => void }) {
  if (items.length === 0) return null
  return (
    <section className="task-card__section">
      <h3 className="task-card__heading">{title}</h3>
      <ul className="task-card__refs">
        {items.map((item) => (
          <li key={item.id} className={`task-card__ref task-card__ref--${item.status.category}`}>
            <RefLink item={item} onOpen={onOpen} />
            <span className="block__status">{item.status.name}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RefLink({ item, onOpen }: { item: TaskRef; onOpen: (task: string) => void }) {
  return (
    <button type="button" className="task-card__ref-link" onClick={() => onOpen(item.id)}>
      <span className="task-card__ref-key">{item.id}</span>
      <span className="task-card__ref-title">{item.title}</span>
    </button>
  )
}

// A link to a task opens its card; a web link opens in a new tab; a link the tracker keeps to itself stays text.
function useMarkdown(onOpen: (task: string) => void): Components {
  return {
    a: ({ href, children }) => {
      if (typeof children === 'string' && isTaskId(children) && !/^https?:/i.test(href ?? '')) {
        return (
          <button type="button" className="task-card__ref-link task-card__ref-link--inline" onClick={() => onOpen(children)}>
            {children}
          </button>
        )
      }
      if (href !== undefined && /^(https?|mailto):/i.test(href)) {
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        )
      }
      return <span>{children}</span>
    },
    img: ({ alt }) => (alt ? <span className="markdown__image">[{alt}]</span> : null),
  }
}
