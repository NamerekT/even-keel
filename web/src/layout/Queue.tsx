import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Link } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { cardTask, chainStatus, projectName, projectSlot } from '../state.js'
import { dragShift, dropIndex, moveItem } from '../ui/drag.js'
import { QueueIcon } from '../ui/icons.js'
import { Lamp } from '../ui/Lamp.js'
import { seriesStyle } from '../ui/series.js'
import { StatusChip } from '../ui/StatusChip.js'
import { usePopover } from './usePopover.js'

export function QueueMenu({ state }: { state: EvenKeelState }) {
  const { open, setOpen, rootRef } = usePopover()
  const { active, queue } = state.chain
  const kind = active.length === 0 ? 'idle' : active.every((chain) => chain.paused) ? 'paused' : 'running'

  return (
    <div className="queue-menu" ref={rootRef}>
      <button
        type="button"
        className={`queue-toggle queue-toggle--${kind}`}
        aria-expanded={open}
        aria-controls="queue-panel"
        title={t.queue.title}
        onClick={() => setOpen(!open)}
      >
        <span className="queue-toggle__dot" aria-hidden="true" />
        <QueueIcon />
        <span className="queue-toggle__label">
          {active.length === 0
            ? t.queue.chain
            : active.map(({ project }, index) => {
                const name = projectName(state, project)
                return (
                  <span key={project} className={name === null ? 'queue-toggle__key' : 'queue-toggle__name'}>
                    {index > 0 && ' · '}
                    {name ?? project}
                  </span>
                )
              })}
        </span>
        {queue.length > 0 && (
          <span className="queue-toggle__count" aria-label={t.queue.count(queue.length)}>
            +{queue.length}
          </span>
        )}
      </button>
      {open && <QueuePanel state={state} />}
    </div>
  )
}

function QueuePanel({ state }: { state: EvenKeelState }) {
  const { send, sending, failure } = useCommand()
  const [pending, setPending] = useState<string[] | null>(null)
  const served = state.chain.queue
  const active = state.chain.active

  useEffect(() => setPending(null), [served.join(',')])

  const move = async (order: string[]) => {
    setPending(order)
    if (!(await send('chain/queue', { order }))) setPending(null)
  }

  return (
    <div id="queue-panel" className="queue" role="dialog" aria-label={t.queue.title}>
      <section className="queue__section">
        <h2 className="queue__heading">{t.queue.now}</h2>
        {active.length === 0 && <p className="queue__empty">{t.queue.idle}</p>}
        {active.map(({ project }) => (
          <div key={project} className="queue__row queue__row--active" style={seriesStyle(projectSlot(state.projects, project))}>
            <span className="card__swatch" aria-hidden="true" />
            <ProjectLink state={state} project={project} />
            <StatusChip status={chainStatus(state.chain, project)} />
            <TaskLine state={state} project={project} />
          </div>
        ))}
      </section>

      {served.length > 0 && (
        <section className="queue__section">
          <h2 className="queue__heading">{t.queue.heading}</h2>
          <QueueList
            state={state}
            queue={pending ?? served}
            disabled={sending}
            onMove={(order) => void move(order)}
            onRemove={(project) => void send('chain/dequeue', { project })}
          />
          {served.length > 1 && <p className="queue__hint">{t.queue.dragHint}</p>}
        </section>
      )}

      {failure !== null && <p className="notice notice--error queue__error">{say(failure)}</p>}
    </div>
  )
}

interface Drag {
  pointer: number
  from: number
  startY: number
  dy: number
  mids: number[]
  step: number
}

interface ListProps {
  state: EvenKeelState
  queue: string[]
  disabled: boolean
  onMove: (order: string[]) => void
  onRemove: (project: string) => void
}

function QueueList({ state, queue, disabled, onMove, onRemove }: ListProps) {
  const listRef = useRef<HTMLOListElement>(null)
  const refocus = useRef<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [landing, setLanding] = useState<{ project: string; offset: number } | null>(null)
  const target = drag === null ? null : dropIndex(drag.mids, drag.mids[drag.from]! + drag.dy)

  useEffect(() => {
    if (landing === null) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setLanding(null))
    })
    return () => cancelAnimationFrame(frame)
  }, [landing])

  useLayoutEffect(() => {
    if (refocus.current === null) return
    listRef.current?.querySelector<HTMLElement>(`[data-handle="${refocus.current}"]`)?.focus()
    refocus.current = null
  })

  const grab = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || disabled || listRef.current === null) return
    const rects = [...listRef.current.children].map((row) => row.getBoundingClientRect())
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      pointer: event.pointerId,
      from: index,
      startY: event.clientY,
      dy: 0,
      mids: rects.map((rect) => rect.top + rect.height / 2),
      step: rects.length > 1 ? rects[1]!.top - rects[0]!.top : rects[0]!.height,
    })
  }

  const follow = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag?.pointer === event.pointerId) setDrag({ ...drag, dy: event.clientY - drag.startY })
  }

  const drop = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag?.pointer !== event.pointerId) return
    setDrag(null)
    if (target === null || target === drag.from) return
    setLanding({ project: queue[drag.from]!, offset: drag.dy - (target - drag.from) * drag.step })
    onMove(moveItem(queue, drag.from, target))
  }

  const nudge = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null
    if (to === null) return
    event.preventDefault()
    if (disabled || to < 0 || to >= queue.length) return
    refocus.current = queue[index]!
    onMove(moveItem(queue, index, to))
  }

  return (
    <ol ref={listRef} className={listClass(drag !== null, landing !== null)}>
      {queue.map((project, index) => {
        const dragged = drag?.from === index
        let offset = landing?.project === project ? landing.offset : 0
        if (drag !== null) offset = dragged ? drag.dy : dragShift(index, drag.from, target!, drag.step)
        return (
          <li
            key={project}
            className={dragged ? 'queue__row queue__row--dragged' : 'queue__row'}
            style={{
              ...seriesStyle(projectSlot(state.projects, project)),
              transform: offset === 0 ? undefined : `translateY(${offset}px)`,
            }}
          >
            <button
              type="button"
              className="queue__handle"
              data-handle={project}
              aria-label={t.queue.move(project)}
              disabled={queue.length < 2}
              onPointerDown={grab(index)}
              onPointerMove={follow}
              onPointerUp={drop}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={nudge(index)}
            >
              ⠿
            </button>
            <span className="queue__place">{index + 1}</span>
            <span className="card__swatch" aria-hidden="true" />
            <ProjectLink state={state} project={project} />
            <button
              type="button"
              className="queue__remove"
              aria-label={t.queue.remove(project)}
              title={t.queue.removeTitle}
              disabled={disabled}
              onClick={() => onRemove(project)}
            >
              ×
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
  const name = projectName(state, project)
  return (
    <Link to={`/p/${project}`} className="queue__key">
      {project}
      {name !== null && <span className="queue__name">{name}</span>}
    </Link>
  )
}

function TaskLine({ state, project }: { state: EvenKeelState; project: string }) {
  const task = cardTask(state, project)
  if (task === null) return <p className="queue__task queue__task--empty">{t.queue.noTasks}</p>
  return (
    <p className="queue__task">
      <Lamp lamp={task.lamp} />
      <span className="queue__task-id">{task.id}</span>
      {task.title !== null && <span className="queue__task-title">{task.title}</span>}
    </p>
  )
}
