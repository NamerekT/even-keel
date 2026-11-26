import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { cardTask, chainStatus, projectLabel, projectName, projectPath, projectSlot, type CardTask } from '../state.js'
import { CloseIcon, ProjectsIcon } from '../ui/icons.js'
import { Lamp } from '../ui/Lamp.js'
import { ProjectLabel } from '../ui/ProjectLabel.js'
import { seriesStyle } from '../ui/series.js'
import { StatusChip } from '../ui/StatusChip.js'
import { useDragList } from '../ui/useDragList.js'
import { mergeQueue } from '../machineView.js'
import { chainWaits } from '../waits.js'
import { HelpTip } from '../pages/settingsParts.js'
import { activeProjects, chainKind, queueRows } from './queueRows.js'
import { usePopover, usePopoverRoom } from './usePopover.js'

/**
 * The header's chains block; `row` is the burger's row: the word at the left, the lamp and the count at the right (BTN-1162).
 * `queue` — the whole queue where `state` shows a machine's part of it (BTN-1279): a move keeps the other projects' places.
 */
export function QueueMenu({ state, row = false, queue: whole }: { state: EvenKeelState; row?: boolean; queue?: string[] }) {
  const { open, setOpen, rootRef } = usePopover()
  const { queue } = state.chain
  const kind = chainKind(state.chain)
  const names = activeProjects(state.chain).map((project) => projectName(state, project) ?? projectLabel(state, project))
  const tip = t.queue.toggle(names, queue.length)

  return (
    <div className="queue-menu" ref={rootRef}>
      <button
        type="button"
        className={row ? `gear__item queue-row queue-toggle--${kind}` : `queue-toggle queue-toggle--${kind}`}
        aria-expanded={open}
        aria-controls="queue-panel"
        aria-label={tip}
        title={tip}
        onClick={() => setOpen(!open)}
      >
        {row ? (
          <>
            {t.queue.row}
            <span className="gear__level">
              <QueueContents state={state} />
            </span>
            <span className={open ? 'sheet__chevron sheet__chevron--open' : 'sheet__chevron'} aria-hidden="true">
              ›
            </span>
          </>
        ) : (
          <QueueContents state={state} />
        )}
      </button>
      {open && <QueuePanel state={state} whole={whole} />}
    </div>
  )
}

/** Shared with the legend so the lamp and the count match the header. */
export function QueueContents({ state }: { state: EvenKeelState }) {
  return (
    <>
      <span className="queue-toggle__dot" aria-hidden="true" />
      <ProjectsIcon />
      <span className="queue-toggle__count">{activeProjects(state.chain).length}</span>
    </>
  )
}

function QueuePanel({ state, whole }: { state: EvenKeelState; whole: string[] | undefined }) {
  const { send, sending, failure } = useCommand()
  const [pending, setPending] = useState<string[] | null>(null)
  const served = state.chain.queue
  const active = queueRows(state)
  const panelRef = usePopoverRoom<HTMLDivElement>()

  useEffect(() => setPending(null), [served.join(',')])

  const move = async (order: string[]) => {
    setPending(order)
    if (!(await send('chain/queue', { order: whole === undefined ? order : mergeQueue(whole, order) }))) setPending(null)
  }

  return (
    <div id="queue-panel" ref={panelRef} className="queue" role="dialog" aria-label={t.queue.title}>
      <section className="queue__section">
        <h2 className="queue__heading">{t.queue.now}</h2>
        {active.length === 0 && <p className="queue__empty">{t.queue.idle}</p>}
        {active.map(({ project, tasks }) => (
          <div key={project} className="queue__row queue__row--active" style={seriesStyle(projectSlot(state, project))}>
            <span className="card__swatch" aria-hidden="true" />
            <ProjectLink state={state} project={project} />
            <StatusChip status={chainStatus(state.chain, project)} wait={chainWaits(state, project)[0]} />
            {tasks.length === 0 ? <TaskText task={null} /> : tasks.map((task) => <TaskText key={task.id} task={task} />)}
          </div>
        ))}
      </section>

      {served.length > 0 && (
        <section className="queue__section">
          <h2 className="queue__heading">
            {t.queue.heading}
            {served.length > 1 && <HelpTip text={t.queue.dragHint} align="start" />}
          </h2>
          <QueueList
            state={state}
            queue={pending ?? served}
            disabled={sending}
            onMove={(order) => void move(order)}
            onRemove={(project) => void send('chain/dequeue', { project })}
          />
        </section>
      )}

      {failure !== null && <p className="notice notice--error queue__error">{say(failure)}</p>}
    </div>
  )
}

interface ListProps {
  state: EvenKeelState
  queue: string[]
  disabled: boolean
  onMove: (order: string[]) => void
  onRemove: (project: string) => void
}

function QueueList({ state, queue, disabled, onMove, onRemove }: ListProps) {
  const list = useDragList<HTMLOListElement>(queue, disabled, onMove)

  return (
    <ol ref={list.listRef} className={listClass(list.dragging, list.landing)}>
      {queue.map((project, index) => {
        const dragged = list.isDragged(index)
        const offset = list.offsetOf(index)
        return (
          <li
            key={project}
            className={dragged ? 'queue__row queue__row--dragged' : 'queue__row'}
            style={{
              ...seriesStyle(projectSlot(state, project)),
              transform: offset === 0 ? undefined : `translateY(${offset}px)`,
            }}
          >
            <button
              type="button"
              className="queue__handle"
              aria-label={t.queue.move(projectLabel(state, project))}
              disabled={queue.length < 2}
              {...list.handle(index)}
            >
              ⠿
            </button>
            <span className="queue__place">{index + 1}</span>
            <span className="card__swatch" aria-hidden="true" />
            <ProjectLink state={state} project={project} />
            <button
              type="button"
              className="queue__remove"
              aria-label={t.queue.remove(projectLabel(state, project))}
              title={t.queue.removeTitle}
              disabled={disabled}
              onClick={() => onRemove(project)}
            >
              <CloseIcon />
            </button>
            <TaskLine state={state} project={project} />
          </li>
        )
      })}
    </ol>
  )
}

function listClass(dragging: boolean, landing: boolean): string {
  if (dragging) return 'queue__list queue__list--dragging'
  return landing ? 'queue__list queue__list--landing' : 'queue__list'
}

function ProjectLink({ state, project }: { state: EvenKeelState; project: string }) {
  return (
    <Link to={projectPath(project)} className="queue__key">
      <ProjectLabel project={project} nameClass="queue__name" />
    </Link>
  )
}

function TaskLine({ state, project }: { state: EvenKeelState; project: string }) {
  return <TaskText task={cardTask(state, project)} />
}

function TaskText({ task }: { task: CardTask | null }) {
  if (task === null) return <p className="queue__task queue__task--empty">{t.queue.noTasks}</p>
  return (
    <p className="queue__task">
      <Lamp lamp={task.lamp} />
      {task.held !== undefined && <span className="queue__task-held">{t.project.held[task.held]}</span>}
      <span className="queue__task-id">{task.id}</span>
      {task.title !== null && <span className="queue__task-title">{task.title}</span>}
    </p>
  )
}
