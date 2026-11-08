import { useEffect, useRef, useState, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { TaskWork } from '../../../src/state.js'
import { isTaskId } from '../../../src/stats/model.js'
import type { CardLabel, TaskCard as Card } from '../../../src/tracker/card.js'
import type { MilestonePick as MilestonePickView, TaskStatus } from '../../../src/tracker/model.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { Loader } from '../ui/Loader.js'
import { useLoader } from '../ui/loaderPhase.js'
import { useHeightGlide } from '../ui/useHeightGlide.js'
import '../ui/markdown.css'
import { MoreMenu } from '../ui/MoreMenu.js'
import { PriorityIcon } from '../ui/Priority.js'
import { Select } from '../ui/Select.js'
import { activeChain, taskProject } from '../state.js'
import { recallCard, rememberCard } from './cardMemory.js'
import { removeRefusal } from './cardEdit.js'
import { DAY, LabelsField, MilestoneField, PriorityPick, StatusPick, TitleEdit } from './CardFields.js'
import { RefLink, Relations } from './CardLinks.js'
import { AncestorPath, ParentField, Subtasks } from './CardTree.js'
import { runLabelsOn } from './runPick.js'
import { RunLabelTag } from '../ui/RunLabelTag.js'
import { TaskRunPick } from './TaskRunPick.js'
import { workLines } from '../ui/WorkChip.js'
import { Attachments } from './Attachments.js'
import { useCardEdit, type CardEditor } from './useCardEdit.js'
import { CardJournal } from './CardJournal.js'
import { CardDescription } from './CardDescription.js'
import './card.css'
import './cardMain.css'
import './cardSide.css'
import './cardNarrow.css'
import './cardEdit.css'

/** Labels whose meaning stops a session or keeps the task out of the chain get a callout above the description. */
const LOUD = new Set<CardLabel['role']>(['question', 'excluded'])

interface Props {
  task: string
  /** The task's project GUID: the remembered card is keyed by it, since project keys are not unique. */
  project: string
  link: string | null
  tracker: string | null
  /** Why the task cannot be moved to Todo: the chain would lose its order. */
  refused: Notice | null
  /** Work in the task's folder that main does not hold (BTN-298). */
  work: TaskWork | null
  /** A session of the task is live: no "To the backlog" (invariant 1). */
  live: boolean
  onOpen: (task: string) => void
  onClose: () => void
}

export function TaskCard({ task, project, link, tracker, refused, work, live, onOpen, onClose }: Props) {
  const { card: load, state } = useLive()
  const [card, setCard] = useState<Card | null | undefined>(() => recallCard(project, task))
  const [error, setError] = useState<Notice | null>(null)
  const [round, setRound] = useState(0)
  const [removing, setRemoving] = useState(false)
  const [leaving, setLeaving] = useState<Drafts | null>(null)
  // A note typed into the journal or an unsaved description is lost with the card: closing it asks first.
  const drafting = useRef<Drafts>({ note: false, description: false })
  const close = () => (drafting.current.note || drafting.current.description ? setLeaving({ ...drafting.current }) : onClose())
  const dialog = useRef<HTMLDialogElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const backdrop = useBackdropClose(dialog, close)
  const reread = () => setRound((n) => n + 1)
  const editor = useCardEdit(task, reread)
  const editable = card?.edit != null ? (card as Card & { edit: NonNullable<Card['edit']> }) : null
  const current = state !== null && activeChain(state.chain, project)?.current?.task === task
  // The card reads at its full height, so a long task does not move after it; a short one glides down to its content.
  // `busy` counts at once: the loader's phase turns a render later, and the empty body between would be painted.
  const busy = card === undefined && error === null
  const phase = useLoader(busy)
  const reading = busy || phase !== 'done'
  useHeightGlide(frame, reading ? null : (card?.id ?? task))

  // A card Even Keel keeps is read anew when the poll brings its task changed: fields without a draft follow it.
  const row = JSON.stringify(state?.tasks.filter((each) => each.project === project && (each.id === task || each.parent === task)) ?? null)
  const seen = useRef(row)
  useEffect(() => {
    if (seen.current === row) return
    seen.current = row
    if (editable !== null) reread()
  }, [row])

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
    frame.current?.focus()
  }, [])

  const shown = useRef({ project, task })
  useEffect(() => {
    if (shown.current.project === project && shown.current.task === task) return
    shown.current = { project, task }
    setCard(recallCard(project, task))
  }, [project, task])

  useEffect(() => {
    let live = true
    setError(null)
    load(task).then(
      (answer) => {
        rememberCard(project, task, answer)
        if (live) setCard(answer)
      },
      (reason: unknown) => live && setError(noticeOf(reason)),
    )
    return () => {
      live = false
    }
  }, [project, task, round])

  return (
    <dialog
      ref={dialog}
      className="task-card"
      data-restorable
      aria-label={task}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      {...backdrop}
    >
      <div ref={frame} className={`task-card__frame${reading ? ' task-card__frame--reading' : ''}`} tabIndex={-1}>
        <header className="task-card__head">
          <span className="task-card__key">{task}</span>
          {editable !== null ? (
            <StatusPick card={editable} editor={editor} refused={refused} live={live} />
          ) : (
            card != null && <StatusPill status={card.status} />
          )}
          <span className="task-card__spacer" />
          {editable !== null && (
            <MoreMenu
              label={t.card.edit.more}
              items={[{ label: t.card.edit.remove, danger: true, problem: maybeSay(removeRefusal(task, current, live)), pick: () => setRemoving(true) }]}
            />
          )}
          {link !== null && editable === null && (
            <a href={link} className="task-card__link" target="_blank" rel="noreferrer">
              {t.card.openIn(tracker)} <span aria-hidden="true">↗</span>
            </a>
          )}
          <button type="button" className="task-card__close" aria-label={t.card.close} title={t.card.close} onClick={close}>
            ×
          </button>
        </header>
        <div className="task-card__body">
          {reading ? (
            <Loader phase={phase === 'done' ? 'in' : phase} label={t.card.loading} fit="fill" />
          ) : (
            <>
              {error !== null && <p className="notice notice--error">{say(error)}</p>}
              {card === null && <p className="placeholder task-card__empty">{t.card.none}</p>}
              {card != null && (
                <CardBody
                  card={card}
                  project={project}
                  editor={editable === null ? null : editor}
                  inWork={current || live}
                  refused={refused}
                  work={work}
                  live={live}
                  onOpen={onOpen}
                  onChanged={reread}
                  onDraft={(kind, on) => {
                    drafting.current = { ...drafting.current, [kind]: on }
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
      {leaving !== null && (
        <ConfirmDialog
          title={t.card.leave.title}
          question={t.card.leave.question(leaving.note, leaving.description)}
          confirm={t.card.leave.confirm}
          cancel={t.card.leave.cancel}
          busy={false}
          onConfirm={() => {
            setLeaving(null)
            onClose()
          }}
          onClose={() => setLeaving(null)}
        />
      )}
      {editor.conflict !== null && <ConflictDialog editor={editor} conflict={editor.conflict} />}
      {removing && editable !== null && (
        <RemoveDialog
          card={editable}
          editor={editor}
          onClose={() => setRemoving(false)}
          onRemoved={() => {
            setRemoving(false)
            onClose()
          }}
        />
      )}
    </dialog>
  )
}

/** What the card holds unsaved. */
interface Drafts {
  note: boolean
  description: boolean
}

const maybeSay = (notice: Notice | null) => (notice === null ? undefined : say(notice))

function shownValue(field: string, value: string | null): string {
  if (value === null || value === '') return t.card.edit.empty
  return field === 'priority' && value in t.card.priorities ? t.card.priorities[value as keyof typeof t.card.priorities] : value
}

/** Only a real conflict: the same field changed otherwise while the person edited it. */
function ConflictDialog({ editor, conflict }: { editor: CardEditor; conflict: NonNullable<CardEditor['conflict']> }) {
  return (
    <ConfirmDialog
      title={t.card.edit.conflictTitle}
      question={t.card.edit.conflictQuestion(t.card.edit.fields[conflict.field] ?? conflict.field, shownValue(conflict.field, conflict.theirs), shownValue(conflict.field, conflict.mine))}
      confirm={t.card.edit.keepMine}
      cancel={t.card.edit.takeNew}
      busy={editor.busy}
      safe
      onConfirm={conflict.keep}
      onClose={editor.settle}
    />
  )
}

/** Its subtasks are not deleted: they become top-level, and the question names them. */
function RemoveDialog({ card, editor, onClose, onRemoved }: { card: Card & { edit: NonNullable<Card['edit']> }; editor: CardEditor; onClose: () => void; onRemoved: () => void }) {
  const [failure, setFailure] = useState<Notice | null>(null)
  return (
    <ConfirmDialog
      title={t.card.edit.removeTitle(card.id)}
      question={t.card.edit.removeQuestion(card.edit.subtasks.map((child) => child.id).join(', '))}
      confirm={t.card.edit.removeConfirm}
      cancel={t.card.edit.cancel}
      busy={editor.busy}
      failure={failure === null ? undefined : say(failure)}
      onConfirm={() =>
        void editor.run('query', 'builtin/delete', { task: card.id }).then((refused) => (refused === null ? onRemoved() : setFailure(refused)))
      }
      onClose={onClose}
    />
  )
}

interface BodyProps {
  card: Card
  project: string
  /** Only for a task Even Keel keeps itself: the card is where it is edited. */
  editor: CardEditor | null
  /** The chain's current task, or one a session of it is live on. */
  inWork: boolean
  refused: Notice | null
  work: TaskWork | null
  live: boolean
  onOpen: (task: string) => void
  onChanged: () => void
  onDraft: (kind: keyof Drafts, drafting: boolean) => void
}

function CardBody({ card, project, editor, inWork, refused, work, live, onOpen, onChanged, onDraft }: BodyProps) {
  const { send, sending, failure } = useCommand()
  const { state } = useLive()
  const labelsOn = runLabelsOn(state?.config, taskProject(state, card.id))
  const roleText = (role: NonNullable<Card['labels'][number]['role']>) => (role === 'model' && !labelsOn ? t.card.roles.modelOff : t.card.roles[role])
  const markdown = useMarkdown(onOpen, card.attachments)
  const loud = card.labels.filter((label) => LOUD.has(label.role))
  const quiet = card.labels.filter((label) => label.role !== null && !LOUD.has(label.role))
  const editable = editor !== null && card.edit !== null ? { card: card as Card & { edit: NonNullable<Card['edit']> }, editor } : null

  return (
    <>
      {editable !== null && <AncestorPath ancestors={editable.card.edit.ancestors} onOpen={onOpen} />}
      {editable !== null ? <TitleEdit card={card} editor={editable.editor} /> : <h2 className="task-card__title">{card.title}</h2>}
      <div className="task-card__layout">
        <div className="task-card__main">
          {(loud.length > 0 || card.requires.length > 0 || work !== null) && (
            <div className="task-card__callouts">
              {work !== null && (
                <div className="task-card__callout task-card__callout--work">
                  <strong>{t.card.work}</strong>
                  {workLines(work).map((line) => (
                    <span key={line} className="task-card__work-line">
                      {line}
                    </span>
                  ))}
                  <span className="task-card__work-fix">{t.chain.work.fix}</span>
                </div>
              )}
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
          {editable !== null ? (
            <CardDescription
              key={`description:${card.id}`}
              task={card.id}
              text={card.description}
              editor={editable.editor}
              render={(text) => <Text components={markdown}>{text}</Text>}
              onDraft={(on) => onDraft('description', on)}
            />
          ) : (
            <section className="task-card__section">
              <h3 className="task-card__heading">{t.card.description}</h3>
              {card.description.trim() === '' ? (
                <p className="placeholder">{t.card.noDescription}</p>
              ) : (
                <Text components={markdown}>{card.description}</Text>
              )}
            </section>
          )}
          {editable !== null && <Subtasks card={editable.card} project={project} editor={editable.editor} inWork={inWork} onOpen={onOpen} />}
          <CardJournal
            key={`journal:${card.id}`}
            task={card.id}
            comments={card.comments}
            editor={editable?.editor ?? null}
            render={(text) => <Text components={markdown}>{text}</Text>}
            onDraft={(on) => onDraft('note', on)}
          />
        </div>
        <aside className="task-card__side">
          {/* An edited card moves the task through its status pick, which takes these same actions. */}
          {card.ready && editable === null && (
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
          {card.unready && !live && editable === null && (
            <div className="task-card__ready">
              <button
                type="button"
                className="button"
                disabled={sending}
                onClick={() => void send('task/unready', { task: card.id }).then((ok) => ok && onChanged())}
              >
                {t.card.unready}
              </button>
              <span className="task-card__hint">{t.card.unreadyHint}</span>
            </div>
          )}
          {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
          {editable?.editor.failure != null && <p className="notice notice--error">{say(editable.editor.failure)}</p>}
          <dl className="task-card__props">
            <Prop name={t.card.priority}>
              {editable !== null ? (
                <PriorityPick card={card} editor={editable.editor} />
              ) : (
                <span className={`task-card__priority task-card__priority--${card.priority}`}>
                  <PriorityIcon priority={card.priority} />
                  {t.card.priorities[card.priority]}
                </span>
              )}
            </Prop>
            <Prop name={t.card.milestone}>
              {editable !== null ? (
                <MilestoneField card={editable.card} editor={editable.editor} />
              ) : card.milestones !== null ? (
                <MilestonePick task={card.id} pick={card.milestones} onChanged={onChanged} />
              ) : card.milestone === null ? (
                <span className="task-card__none">{t.card.noMilestone}</span>
              ) : (
                <span className="task-card__milestone">
                  {card.milestone.label}
                  {card.milestone.targetDate ? <small>{t.card.due(DAY().format(card.milestone.targetDate))}</small> : null}
                </span>
              )}
            </Prop>
            <Prop name={t.card.run.title} wide>
              <TaskRunPick task={card.id} labels={card.labels.map((label) => label.name)} relabel={card.relabel} live={live} onChanged={onChanged} />
            </Prop>
            {editable !== null ? (
              <Prop name={t.card.parent} wide={editable.card.parent !== null}>
                <ParentField card={editable.card} project={project} editor={editable.editor} onOpen={onOpen} />
              </Prop>
            ) : (
              card.parent !== null && (
                <Prop name={t.card.parent}>
                  <RefLink item={card.parent} onOpen={onOpen} />
                </Prop>
              )
            )}
            {(card.labels.length > 0 || editable !== null) && (
              <Prop name={t.card.labels} wide>
                {editable !== null ? (
                  <LabelsField card={editable.card} editor={editable.editor} labelsOn={labelsOn} roleText={roleText} />
                ) : (
                <ul className="task-card__chips">
                  {card.labels.map((label) => label.role === 'model' ? (
                    <RunLabelTag key={label.name} label={label.name} as="li" off={!labelsOn} />
                  ) : (
                    <li
                      key={label.name}
                      className={label.role === null ? 'tag' : `chip task-card__chip--${label.role}`}
                      title={label.role === null ? undefined : roleText(label.role)}
                    >
                      {label.name}
                    </li>
                  ))}
                </ul>
                )}
                {quiet.length > 0 && (
                  <ul className="task-card__roles">
                    {quiet.map((label) => (
                      <li key={label.name}>
                        <strong>{label.name}</strong> — {roleText(label.role!)}
                      </li>
                    ))}
                  </ul>
                )}
              </Prop>
            )}
          </dl>
          {card.attachments.length > 0 && <Attachments task={card.id} items={card.attachments} editor={editable?.editor ?? null} />}
          <Relations card={card} editor={editable?.editor ?? null} onOpen={onOpen} />
        </aside>
      </div>
    </>
  )
}

/** The milestone changes at once on a pick, with no confirmation; the card is read anew after the tracker took it. */
function MilestonePick({ task, pick, onChanged }: { task: string; pick: MilestonePickView; onChanged: () => void }) {
  const { send, sending, failure } = useCommand()
  const [value, setValue] = useState(pick.current ?? '')
  useEffect(() => setValue(pick.current ?? ''), [pick.current])
  const chosen = pick.choices.find((choice) => choice.id === value)
  const options = [{ value: '', label: t.card.noMilestone }, ...pick.choices.map((choice) => ({ value: choice.id, label: choice.label }))]

  return (
    <div className="task-card__milestone">
      <Select
        className="task-card__milestone-pick"
        label={t.card.milestone}
        value={value}
        options={options}
        disabled={sending}
        onChange={(next) => {
          setValue(next)
          void send('task/milestone', { task, milestone: next === '' ? null : next }).then((ok) => (ok ? onChanged() : setValue(pick.current ?? '')))
        }}
      />
      {chosen?.targetDate ? <small>{t.card.due(DAY().format(chosen.targetDate))}</small> : null}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </div>
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

function Prop({ name, children, wide = false }: { name: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`task-card__prop${wide ? ' task-card__prop--wide' : ''}`}>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  )
}

// A link to a task opens its card; a web link opens in a new tab; a link the tracker keeps to itself stays text.
function useMarkdown(onOpen: (task: string) => void, attachments: Card['attachments']): Components {
  const localFiles = new Set(attachments.map((file) => file.url).filter((url) => url.startsWith('/api/tasks/')))
  return {
    a: ({ href, children }) => {
      if (typeof children === 'string' && isTaskId(children) && !/^https?:/i.test(href ?? '')) {
        return (
          <button type="button" className="task-card__inline-ref" onClick={() => onOpen(children)}>
            {children}
          </button>
        )
      }
      if (href !== undefined && (/^(https?|mailto):/i.test(href) || localFiles.has(href))) {
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        )
      }
      return <span>{children}</span>
    },
    img: ({ src, alt }) => typeof src === 'string' && localFiles.has(src)
      ? <img src={src} alt={alt ?? ''} loading="lazy" style={{ maxWidth: '100%', height: 'auto' }} />
      : (alt ? <span className="markdown__image">[{alt}]</span> : null),
  }
}
