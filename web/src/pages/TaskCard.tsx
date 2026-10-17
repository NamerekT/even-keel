import { useEffect, useRef, useState, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import { isTaskId } from '../../../src/stats/model.js'
import type { CardLabel, TaskCard as Card, TaskRef } from '../../../src/tracker/card.js'
import type { TaskStatus } from '../../../src/tracker/model.js'
import { formatMoment } from '../format.js'
import { localized, say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import '../ui/markdown.css'
import { PriorityIcon } from '../ui/Priority.js'
import { Attachments } from './Attachments.js'
import './card.css'

const DAY = localized((language) => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' }))

/** Labels whose meaning stops a session or keeps the task out of the chain get a callout above the description. */
const LOUD = new Set<CardLabel['role']>(['question', 'excluded'])

interface Props {
  task: string
  link: string | null
  tracker: string | null
  /** Why the task cannot be moved to Todo: the chain would lose its order. */
  refused: Notice | null
  onOpen: (task: string) => void
  onClose: () => void
}

export function TaskCard({ task, link, tracker, refused, onOpen, onClose }: Props) {
  const { card: load } = useLive()
  const [card, setCard] = useState<Card | null | undefined>(undefined)
  const [error, setError] = useState<Notice | null>(null)
  const [round, setRound] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const frame = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
    frame.current?.focus()
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
      <div ref={frame} className="task-card__frame" tabIndex={-1}>
        <header className="task-card__head">
          <span className="task-card__key">{task}</span>
          {card != null && <StatusPill status={card.status} />}
          <span className="task-card__spacer" />
          {link !== null && (
            <a href={link} className="task-card__link" target="_blank" rel="noreferrer">
              {t.card.openIn(tracker)} <span aria-hidden="true">↗</span>
            </a>
          )}
          <button type="button" className="task-card__close" aria-label={t.card.close} title={t.card.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="task-card__body">
          {error !== null && <p className="notice notice--error">{say(error)}</p>}
          {card === undefined && error === null && <Loading />}
          {card === null && <p className="placeholder task-card__empty">{t.card.none}</p>}
          {card != null && <CardBody card={card} refused={refused} onOpen={onOpen} onChanged={() => setRound((n) => n + 1)} />}
        </div>
      </div>
    </dialog>
  )
}

function Loading() {
  return (
    <div className="task-card__loading" aria-busy="true" aria-label={t.card.loading}>
      <span className="task-card__bone task-card__bone--title" />
      <span className="task-card__bone" />
      <span className="task-card__bone" />
      <span className="task-card__bone task-card__bone--short" />
    </div>
  )
}

function CardBody({ card, refused, onOpen, onChanged }: { card: Card; refused: Notice | null; onOpen: (task: string) => void; onChanged: () => void }) {
  const { send, sending, failure } = useCommand()
  const markdown = useMarkdown(onOpen)
  const loud = card.labels.filter((label) => LOUD.has(label.role))
  const quiet = card.labels.filter((label) => label.role !== null && !LOUD.has(label.role))
  const relations = card.blockedBy.length + card.blocks.length + card.related.length > 0

  return (
    <>
      <h2 className="task-card__title">{card.title}</h2>
      <div className="task-card__layout">
        <div className="task-card__main">
          {(loud.length > 0 || card.requires.length > 0) && (
            <div className="task-card__callouts">
              {loud.map((label) => (
                <p key={label.name} className={`task-card__callout task-card__callout--${label.role}`}>
                  <strong>{label.name}</strong>
                  <span>{t.card.roles[label.role!]}</span>
                </p>
              ))}
              {card.requires.length > 0 && (
                <p className="task-card__callout task-card__callout--question">
                  <span>{t.card.requires(card.requires.join(', '))}</span>
                </p>
              )}
            </div>
          )}
          <section className="task-card__section">
            <h3 className="task-card__heading">{t.card.description}</h3>
            {card.description.trim() === '' ? (
              <p className="placeholder">{t.card.noDescription}</p>
            ) : (
              <Text components={markdown}>{card.description}</Text>
            )}
          </section>
          {card.comments.length > 0 && (
            <section className="task-card__section">
              <h3 className="task-card__heading">{t.card.comments(card.comments.length)}</h3>
              <ol className="task-card__comments">
                {card.comments.map((comment, index) => (
                  <li key={index} className="task-card__comment">
                    <span className="task-card__avatar" aria-hidden="true">
                      {(comment.author ?? '·').trim().charAt(0).toLocaleUpperCase()}
                    </span>
                    <div className="task-card__bubble">
                      <div className="task-card__comment-head">
                        <strong>{comment.author ?? t.card.noAuthor}</strong>
                        <time dateTime={new Date(comment.at).toISOString()}>{formatMoment(new Date(comment.at).toISOString(), new Date())}</time>
                      </div>
                      <Text components={markdown}>{comment.text}</Text>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
        <aside className="task-card__side">
          {card.ready && (
            <div className="task-card__ready">
              <button
                type="button"
                className="button button--primary"
                disabled={sending || refused !== null}
                onClick={() => void send('task/ready', { task: card.id }).then((ok) => ok && onChanged())}
              >
                {t.card.ready}
              </button>
              <span className="task-card__hint">{refused === null ? t.card.readyHint : t.chain.readyRefused(say(refused))}</span>
            </div>
          )}
          {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
          <dl className="task-card__props">
            <Prop name={t.card.priority}>
              <span className={`task-card__priority task-card__priority--${card.priority}`}>
                <PriorityIcon priority={card.priority} />
                {t.card.priorities[card.priority]}
              </span>
            </Prop>
            <Prop name={t.card.milestone}>
              {card.milestone === null ? (
                <span className="task-card__none">{t.card.noMilestone}</span>
              ) : (
                <span className="task-card__milestone">
                  {card.milestone.label}
                  {card.milestone.targetDate ? <small>{t.card.due(DAY().format(card.milestone.targetDate))}</small> : null}
                </span>
              )}
            </Prop>
            {card.parent !== null && (
              <Prop name={t.card.parent}>
                <RefLink item={card.parent} onOpen={onOpen} />
              </Prop>
            )}
            {card.labels.length > 0 && (
              <Prop name={t.card.labels}>
                <ul className="task-card__chips">
                  {card.labels.map((label) => (
                    <li
                      key={label.name}
                      className={label.role === null || label.role === 'model' ? 'tag' : `chip task-card__chip--${label.role}`}
                      title={label.role === null ? undefined : t.card.roles[label.role]}
                    >
                      {label.name}
                    </li>
                  ))}
                </ul>
                {quiet.length > 0 && (
                  <ul className="task-card__roles">
                    {quiet.map((label) => (
                      <li key={label.name}>
                        <strong>{label.name}</strong> — {t.card.roles[label.role!]}
                      </li>
                    ))}
                  </ul>
                )}
              </Prop>
            )}
          </dl>
          {card.attachments.length > 0 && <Attachments items={card.attachments} />}
          {relations && (
            <div className="task-card__relations">
              <Refs title={t.card.blockedBy} items={card.blockedBy} onOpen={onOpen} />
              <Refs title={t.card.blocks} items={card.blocks} onOpen={onOpen} />
              <Refs title={t.card.related} items={card.related} onOpen={onOpen} />
            </div>
          )}
        </aside>
      </div>
    </>
  )
}

function Text({ children, components }: { children: string; components: Components }) {
  return (
    <div className="markdown task-card__markdown">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={components}>
        {children}
      </Markdown>
    </div>
  )
}

function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <span className={`task-card__status task-card__status--${status.category}`}>
      <span className="task-card__dot" />
      {status.name}
    </span>
  )
}

function Prop({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="task-card__prop">
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function Refs({ title, items, onOpen }: { title: string; items: TaskRef[]; onOpen: (task: string) => void }) {
  if (items.length === 0) return null
  return (
    <section className="task-card__group">
      <h3 className="task-card__heading">
        {title} <span className="task-card__count">{items.length}</span>
      </h3>
      <ul className="task-card__refs">
        {items.map((item) => (
          <li key={item.id}>
            <RefLink item={item} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function RefLink({ item, onOpen }: { item: TaskRef; onOpen: (task: string) => void }) {
  return (
    <button
      type="button"
      className={`task-card__ref task-card__ref--${item.status.category}`}
      title={item.status.name}
      onClick={() => onOpen(item.id)}
    >
      <span className={`task-card__status task-card__status--${item.status.category} task-card__status--bare`}>
        <span className="task-card__dot" />
      </span>
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
          <button type="button" className="task-card__inline-ref" onClick={() => onOpen(children)}>
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
